// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { immediate, isUniqueError, many, one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import { minorToMajorString } from "../money.js";
import type { PlayerView } from "../player/service.js";
import { isAllowancePeriod, periodKeyFor, type AllowancePeriod } from "./periods.js";

const EXPORT_CAP = 10_000;

export type LedgerKind = "charge" | "settlement" | "adjustment";
export type LedgerSource = "staff" | "vending" | "member" | "admin";
export type ChargeSource = "staff" | "vending";
export type AdjustmentDirection = "credit" | "debit";

export type PlanView = {
  membershipType: string;
  amountMinor: number;
  amountMajor: string;
  period: AllowancePeriod;
  currency: string;
  updatedAt: string;
  updatedBy: string;
};

export type LedgerEntryView = {
  id: string;
  memberId: string;
  at: string;
  kind: LedgerKind;
  source: LedgerSource;
  deviceId: string | null;
  requestId: string;
  description: string;
  currency: string;
  unit: "minor" | "sats";
  amountMinor: number;
  amountMajor: string;
  amountSats: number | null;
  allowanceMinor: number;
  tabMinor: number;
  periodKey: string | null;
  guestId: string | null;
  guestLabel: string | null;
  reason: string | null;
  actorLabel: string;
  settlementId: string | null;
};

export type PendingSettlementView = {
  id: string;
  amountMinor: number;
  amountMajor: string;
  currency: string;
  amountSats: number | null;
  paymentMethod: "lightning" | "stripe" | "square";
  expiresAt: string;
};

export type BalanceView = {
  memberId: string;
  currency: string;
  currencyDecimals: number;
  allowance: {
    membershipType: string;
    period: AllowancePeriod;
    periodKey: string | null;
    configuredMinor: number;
    configuredMajor: string;
    usedMinor: number;
    remainingMinor: number;
    remainingMajor: string;
  } | null;
  tab: {
    limitMinor: number;
    limitMajor: string;
    openMinor: number;
    openMajor: string;
    pendingMinor: number;
    pendingMajor: string;
    frozen: boolean;
    roomMinor: number;
  };
  pendingSettlements: PendingSettlementView[];
  recent: LedgerEntryView[];
};

export type ChargeResult = {
  entry: LedgerEntryView;
  balance: BalanceView;
  idempotentReplay: boolean;
};

type MemberRow = {
  id: string;
  status: string;
  membership_type: string;
  access_scope: string | null;
};

type PlanRow = {
  membership_type: string;
  amount_minor: number;
  period: string;
  currency: string;
  updated_at: string;
  updated_by: string;
};

type TabRow = {
  limit_minor: number;
  frozen: number;
  currency: string;
};

type EntryRow = {
  id: string;
  member_id: string;
  at: string;
  kind: string;
  source: string;
  device_id: string | null;
  request_id: string;
  description: string;
  currency: string;
  unit: string;
  amount_minor: number;
  amount_sats: number | null;
  allowance_minor: number;
  tab_minor: number;
  period_key: string | null;
  guest_id: string | null;
  guest_label: string | null;
  reason: string | null;
  actor_label: string;
  settlement_id: string | null;
};

export type ChargeInput = {
  memberId: string;
  source: ChargeSource;
  deviceId: string | null;
  requestId: string;
  description: string;
  unit: "minor" | "sats";
  amountMinor: number;
  amountSats: number | null;
  guestId: string | null;
  actorLabel: string;
  now: Date;
};

export function listPlans(db: Database.Database, config: AppConfig): PlanView[] {
  const rows = many<PlanRow>(
    db,
    `SELECT membership_type, amount_minor, period, currency, updated_at, updated_by
     FROM plan_allowances ORDER BY membership_type ASC`,
  );
  return rows.map((row) => planView(row, config.currencyDecimals));
}

export function setPlanAllowance(
  db: Database.Database,
  config: AppConfig,
  input: { membershipType: string; amountMinor: number; period: AllowancePeriod; actorLabel: string; now: Date },
): PlanView {
  if (!config.membershipTypes.includes(input.membershipType)) {
    throw new AppError(400, "Unknown membership type");
  }
  assertMinor(input.amountMinor, true);
  const nowIso = input.now.toISOString();
  db.prepare(
    `INSERT INTO plan_allowances (membership_type, amount_minor, period, currency, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(membership_type) DO UPDATE SET
       amount_minor = excluded.amount_minor,
       period = excluded.period,
       currency = excluded.currency,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(input.membershipType, input.amountMinor, input.period, config.currency, nowIso, input.actorLabel);
  const row = one<PlanRow>(
    db,
    `SELECT membership_type, amount_minor, period, currency, updated_at, updated_by
     FROM plan_allowances WHERE membership_type = ?`,
    input.membershipType,
  );
  if (!row) throw new Error("allowance plan missing after save");
  return planView(row, config.currencyDecimals);
}

export function setTabLimit(
  db: Database.Database,
  config: AppConfig,
  memberId: string,
  limitMinor: number,
  actorLabel: string,
  now: Date,
): { limitMinor: number; frozen: boolean } {
  assertMemberExists(db, memberId);
  assertMinor(limitMinor, true);
  const nowIso = now.toISOString();
  db.prepare(
    `INSERT INTO member_tabs (member_id, limit_minor, frozen, currency, updated_at, updated_by)
     VALUES (?, ?, 0, ?, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET
       limit_minor = excluded.limit_minor,
       currency = excluded.currency,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(memberId, limitMinor, config.currency, nowIso, actorLabel);
  const tab = loadTab(db, memberId, config.currency);
  return { limitMinor: tab.limit_minor, frozen: tab.frozen === 1 };
}

export function setTabFrozen(
  db: Database.Database,
  config: AppConfig,
  memberId: string,
  frozen: boolean,
  actorLabel: string,
  now: Date,
): { limitMinor: number; frozen: boolean } {
  assertMemberExists(db, memberId);
  const nowIso = now.toISOString();
  const flag = frozen ? 1 : 0;
  db.prepare(
    `INSERT INTO member_tabs (member_id, limit_minor, frozen, currency, updated_at, updated_by)
     VALUES (?, 0, ?, ?, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET
       frozen = excluded.frozen,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(memberId, flag, config.currency, nowIso, actorLabel);
  const tab = loadTab(db, memberId, config.currency);
  return { limitMinor: tab.limit_minor, frozen: tab.frozen === 1 };
}

export function readBalance(db: Database.Database, config: AppConfig, memberId: string, now: Date): BalanceView {
  expireDueTabSettlements(db, now);
  const member = loadMember(db, memberId);
  if (!member) throw new AppError(404, "Membership was not found");
  return balanceFor(db, config, member, now);
}

export function readMemberForPlayer(db: Database.Database, player: PlayerView): MemberRow | null {
  if (player.memberId) {
    const linked = loadMember(db, player.memberId);
    if (linked) return linked;
  }
  return (
    one<MemberRow>(
      db,
      `SELECT id, status, membership_type, access_scope FROM members
       WHERE lower(email) = ?
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      player.email,
    ) ?? null
  );
}

/** Return the stored charge when this request id was already posted. Does not authenticate a card. */
export function readIdempotentCharge(
  db: Database.Database,
  config: AppConfig,
  input: ChargeInput,
  checkMember: boolean,
): ChargeResult | null {
  const existing = entryByRequest(db, input.requestId);
  if (!existing) return null;
  assertReplay(existing, input, checkMember);
  const member = requiredMember(db, existing.member_id);
  return {
    entry: toEntry(existing, config.currencyDecimals),
    balance: balanceFor(db, config, member, input.now),
    idempotentReplay: true,
  };
}

export function postCharge(
  db: Database.Database,
  config: AppConfig,
  input: ChargeInput,
  claim?: () => void,
): ChargeResult {
  return immediate(db, () => {
    const existing = entryByRequest(db, input.requestId);
    if (existing) {
      assertReplay(existing, input, true);
      return {
        entry: toEntry(existing, config.currencyDecimals),
        balance: balanceFor(db, config, requiredMember(db, input.memberId), input.now),
        idempotentReplay: true,
      };
    }
    const member = requiredMember(db, input.memberId);
    if (member.status !== "active") throw new AppError(403, "Membership is not active");
    if ((member.access_scope ?? "member") === "booking") {
      throw new AppError(403, "That account is a booking contact, not a club membership");
    }
    const guest = guestSnapshot(db, member.id, input.guestId);
    const split = splitCharge(db, config, member, input.amountMinor, input.now);
    const open = sumTab(db, member.id);
    const tab = loadTab(db, member.id, config.currency);
    if (split.tabMinor > 0 && tab.frozen === 1) throw new AppError(409, "Tab is frozen");
    if (open + split.tabMinor > tab.limit_minor) throw new AppError(409, "That is over the tab limit");
    claim?.();
    const nowIso = input.now.toISOString();
    const id = newId("led");
    try {
      db.prepare(
        `INSERT INTO ledger_entries (
           id, member_id, at, kind, source, device_id, request_id, description, currency, unit,
           amount_minor, amount_sats, allowance_minor, tab_minor, period_key, guest_id, guest_label,
           reason, actor_label, settlement_id, created_at
         ) VALUES (?, ?, ?, 'charge', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
      ).run(
        id,
        member.id,
        nowIso,
        input.source,
        input.deviceId,
        input.requestId,
        input.description,
        config.currency,
        input.unit,
        input.amountMinor,
        input.amountSats,
        split.allowanceMinor,
        split.tabMinor,
        split.periodKey,
        guest.guestId,
        guest.guestLabel,
        input.actorLabel,
        nowIso,
      );
    } catch (error) {
      if (isUniqueError(error)) throw new AppError(409, "requestId was already used");
      throw error;
    }
    const row = entryByRequest(db, input.requestId);
    if (!row) throw new Error("ledger charge missing after insert");
    return {
      entry: toEntry(row, config.currencyDecimals),
      balance: balanceFor(db, config, member, input.now),
      idempotentReplay: false,
    };
  });
}

export function postAdjustment(
  db: Database.Database,
  config: AppConfig,
  input: {
    memberId: string;
    direction: AdjustmentDirection;
    amountMinor: number;
    reason: string;
    requestId: string;
    actorLabel: string;
    now: Date;
  },
): ChargeResult {
  assertMinor(input.amountMinor, false);
  return immediate(db, () => {
    const existing = entryByRequest(db, input.requestId);
    if (existing) {
      if (
        existing.kind !== "adjustment" ||
        existing.member_id !== input.memberId ||
        existing.amount_minor !== input.amountMinor ||
        existing.reason !== input.reason
      ) {
        throw new AppError(409, "requestId was already used");
      }
      return {
        entry: toEntry(existing, config.currencyDecimals),
        balance: balanceFor(db, config, requiredMember(db, input.memberId), input.now),
        idempotentReplay: true,
      };
    }
    const member = requiredMember(db, input.memberId);
    const open = sumTab(db, member.id);
    const tab = loadTab(db, member.id, config.currency);
    const tabMinor = signedAdjustment(input.direction, input.amountMinor, open, tab);
    const nowIso = input.now.toISOString();
    const id = newId("led");
    db.prepare(
      `INSERT INTO ledger_entries (
         id, member_id, at, kind, source, device_id, request_id, description, currency, unit,
         amount_minor, amount_sats, allowance_minor, tab_minor, period_key, guest_id, guest_label,
         reason, actor_label, settlement_id, created_at
       ) VALUES (?, ?, ?, 'adjustment', 'admin', NULL, ?, ?, ?, 'minor', ?, NULL, 0, ?, NULL, NULL, NULL, ?, ?, NULL, ?)`,
    ).run(
      id,
      member.id,
      nowIso,
      input.requestId,
      input.reason,
      config.currency,
      input.amountMinor,
      tabMinor,
      input.reason,
      input.actorLabel,
      nowIso,
    );
    const row = entryByRequest(db, input.requestId);
    if (!row) throw new Error("ledger adjustment missing after insert");
    return {
      entry: toEntry(row, config.currencyDecimals),
      balance: balanceFor(db, config, member, input.now),
      idempotentReplay: false,
    };
  });
}

export function listLedger(
  db: Database.Database,
  config: AppConfig,
  memberId: string | null,
  limit: number,
): { entries: LedgerEntryView[]; truncated: boolean } {
  const cap = Math.min(limit, EXPORT_CAP);
  const rows = many<EntryRow>(
    db,
    `SELECT ${ENTRY_COLUMNS}
     FROM ledger_entries
     WHERE (? IS NULL OR member_id = ?)
     ORDER BY at DESC, id DESC
     LIMIT ?`,
    memberId,
    memberId,
    cap + 1,
  );
  const truncated = rows.length > cap;
  return {
    entries: rows.slice(0, cap).map((row) => toEntry(row, config.currencyDecimals)),
    truncated,
  };
}

export function ledgerCsv(db: Database.Database, config: AppConfig, memberId: string | null): string {
  const rows = many<EntryRow>(
    db,
    `SELECT ${ENTRY_COLUMNS}
     FROM ledger_entries
     WHERE (? IS NULL OR member_id = ?)
     ORDER BY at ASC, id ASC
     LIMIT ?`,
    memberId,
    memberId,
    EXPORT_CAP + 1,
  );
  const truncated = rows.length > EXPORT_CAP;
  const body = rows.slice(0, EXPORT_CAP).map((row) => toEntry(row, config.currencyDecimals));
  const header = [
    "id",
    "at",
    "member_id",
    "kind",
    "source",
    "device_id",
    "request_id",
    "description",
    "currency",
    "unit",
    "amount_minor",
    "amount_sats",
    "allowance_minor",
    "tab_minor",
    "period_key",
    "guest_id",
    "guest_label",
    "reason",
    "actor_label",
    "settlement_id",
  ];
  const lines = [header.join(",")];
  if (truncated) {
    lines.push("# export stopped at 10000 rows; filter by memberId for one membership");
  }
  for (const entry of body) {
    lines.push(
      [
        entry.id,
        entry.at,
        entry.memberId,
        entry.kind,
        entry.source,
        entry.deviceId ?? "",
        entry.requestId,
        entry.description,
        entry.currency,
        entry.unit,
        String(entry.amountMinor),
        entry.amountSats == null ? "" : String(entry.amountSats),
        String(entry.allowanceMinor),
        String(entry.tabMinor),
        entry.periodKey ?? "",
        entry.guestId ?? "",
        entry.guestLabel ?? "",
        entry.reason ?? "",
        entry.actorLabel,
        entry.settlementId ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function sumTab(db: Database.Database, memberId: string): number {
  const row = one<{ total: number | bigint | null }>(
    db,
    "SELECT COALESCE(SUM(tab_minor), 0) AS total FROM ledger_entries WHERE member_id = ?",
    memberId,
  );
  return asInt(row?.total ?? 0, "tab total");
}

export function sumPending(db: Database.Database, memberId: string): number {
  const row = one<{ total: number | bigint | null }>(
    db,
    `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM tab_settlements
     WHERE member_id = ? AND status = 'pending'`,
    memberId,
  );
  return asInt(row?.total ?? 0, "pending total");
}

export function expireDueTabSettlements(db: Database.Database, now: Date): number {
  const info = db
    .prepare("UPDATE tab_settlements SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?")
    .run(now.toISOString());
  return info.changes;
}

export function appendSettlementEntry(
  db: Database.Database,
  input: {
    settlementId: string;
    memberId: string;
    amountMinor: number;
    amountSats: number | null;
    currency: string;
    at: string;
  },
): void {
  const existing = one<{ id: string }>(
    db,
    "SELECT id FROM ledger_entries WHERE settlement_id = ?",
    input.settlementId,
  );
  if (existing) return;
  db.prepare(
    `INSERT INTO ledger_entries (
       id, member_id, at, kind, source, device_id, request_id, description, currency, unit,
       amount_minor, amount_sats, allowance_minor, tab_minor, period_key, guest_id, guest_label,
       reason, actor_label, settlement_id, created_at
     ) VALUES (?, ?, ?, 'settlement', 'member', NULL, ?, 'Tab payment', ?, 'minor', ?, ?, 0, ?, NULL, NULL, NULL, NULL, 'member', ?, ?)`,
  ).run(
    newId("led"),
    input.memberId,
    input.at,
    `tab-settlement:${input.settlementId}`,
    input.currency,
    input.amountMinor,
    input.amountSats,
    -input.amountMinor,
    input.settlementId,
    input.at,
  );
}

function splitCharge(
  db: Database.Database,
  config: AppConfig,
  member: MemberRow,
  amountMinor: number,
  now: Date,
): { allowanceMinor: number; tabMinor: number; periodKey: string | null } {
  const plan = loadPlan(db, member.membership_type);
  if (!plan || plan.currency !== config.currency) {
    return { allowanceMinor: 0, tabMinor: amountMinor, periodKey: null };
  }
  const period = periodOf(plan.period);
  const periodKey = periodKeyFor(
    db,
    period,
    member.id,
    now,
    config.clubTimeZone,
    config.checkinStaleMinutes,
  );
  if (!periodKey) return { allowanceMinor: 0, tabMinor: amountMinor, periodKey: null };
  const used = sumAllowance(db, member.id, periodKey);
  const remaining = Math.max(0, plan.amount_minor - used);
  const allowanceMinor = Math.min(remaining, amountMinor);
  return { allowanceMinor, tabMinor: amountMinor - allowanceMinor, periodKey };
}

function signedAdjustment(
  direction: AdjustmentDirection,
  amountMinor: number,
  open: number,
  tab: TabRow,
): number {
  switch (direction) {
    case "credit":
      if (amountMinor > open) {
        throw new AppError(400, "A credit cannot be larger than the amount owed.");
      }
      return -amountMinor;
    case "debit":
      if (tab.frozen === 1) throw new AppError(409, "Tab is frozen");
      if (open + amountMinor > tab.limit_minor) throw new AppError(409, "That is over the tab limit");
      return amountMinor;
    default: {
      const unknown: never = direction;
      throw new AppError(400, `Unknown adjustment ${String(unknown)}`);
    }
  }
}

function balanceFor(db: Database.Database, config: AppConfig, member: MemberRow, now: Date): BalanceView {
  expireDueTabSettlements(db, now);
  const plan = loadPlan(db, member.membership_type);
  const tab = loadTab(db, member.id, config.currency);
  const open = sumTab(db, member.id);
  const pending = sumPending(db, member.id);
  const recent = many<EntryRow>(
    db,
    `SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE member_id = ? ORDER BY at DESC, id DESC LIMIT 20`,
    member.id,
  );
  const waiting = many<{
    id: string;
    amount_minor: number;
    currency: string;
    amount_sats: number | null;
    payment_method: string;
    expires_at: string;
  }>(
    db,
    `SELECT id, amount_minor, currency, amount_sats, payment_method, expires_at
     FROM tab_settlements WHERE member_id = ? AND status = 'pending' ORDER BY created_at ASC`,
    member.id,
  );
  let allowance: BalanceView["allowance"] = null;
  const clubMember = (member.access_scope ?? "member") !== "booking";
  if (plan && plan.currency === config.currency && clubMember) {
    const period = periodOf(plan.period);
    const periodKey = periodKeyFor(
      db,
      period,
      member.id,
      now,
      config.clubTimeZone,
      config.checkinStaleMinutes,
    );
    const used = periodKey ? sumAllowance(db, member.id, periodKey) : 0;
    const remaining = Math.max(0, plan.amount_minor - used);
    allowance = {
      membershipType: plan.membership_type,
      period,
      periodKey,
      configuredMinor: plan.amount_minor,
      configuredMajor: major(plan.amount_minor, config),
      usedMinor: used,
      remainingMinor: remaining,
      remainingMajor: major(remaining, config),
    };
  }
  const room = Math.max(0, tab.limit_minor - open);
  return {
    memberId: member.id,
    currency: config.currency,
    currencyDecimals: config.currencyDecimals,
    allowance,
    tab: {
      limitMinor: tab.limit_minor,
      limitMajor: major(tab.limit_minor, config),
      openMinor: open,
      openMajor: major(Math.max(0, open), config),
      pendingMinor: pending,
      pendingMajor: major(pending, config),
      frozen: tab.frozen === 1,
      roomMinor: room,
    },
    pendingSettlements: waiting.map((row) => ({
      id: row.id,
      amountMinor: row.amount_minor,
      amountMajor: major(row.amount_minor, config),
      currency: row.currency,
      amountSats: row.amount_sats,
      paymentMethod: methodOf(row.payment_method),
      expiresAt: row.expires_at,
    })),
    recent: recent.map((row) => toEntry(row, config.currencyDecimals)),
  };
}

function sumAllowance(db: Database.Database, memberId: string, periodKey: string): number {
  const row = one<{ total: number | bigint | null }>(
    db,
    `SELECT COALESCE(SUM(allowance_minor), 0) AS total FROM ledger_entries
     WHERE member_id = ? AND period_key = ?`,
    memberId,
    periodKey,
  );
  return asInt(row?.total ?? 0, "allowance total");
}

function guestSnapshot(
  db: Database.Database,
  memberId: string,
  guestId: string | null,
): { guestId: string | null; guestLabel: string | null } {
  if (!guestId) return { guestId: null, guestLabel: null };
  const guest = one<{ host_member_id: string; display_name: string | null; deleted_at: string | null }>(
    db,
    "SELECT host_member_id, display_name, deleted_at FROM guests WHERE id = ?",
    guestId,
  );
  if (!guest) throw new AppError(404, "Guest was not found");
  if (guest.deleted_at) throw new AppError(409, "That guest record is closed");
  if (guest.host_member_id !== memberId) throw new AppError(403, "That guest is not with this member");
  const label = guest.display_name?.trim() || "guest";
  return { guestId, guestLabel: label };
}

function assertReplay(existing: EntryRow, input: ChargeInput, checkMember: boolean): void {
  const same =
    existing.kind === "charge" &&
    existing.source === input.source &&
    (!checkMember || existing.member_id === input.memberId) &&
    (existing.device_id ?? null) === input.deviceId &&
    existing.description === input.description &&
    existing.unit === input.unit &&
    existing.amount_minor === input.amountMinor &&
    (existing.amount_sats ?? null) === input.amountSats &&
    (existing.guest_id ?? null) === input.guestId;
  if (!same) throw new AppError(409, "requestId was already used");
}

function requiredMember(db: Database.Database, memberId: string): MemberRow {
  const member = loadMember(db, memberId);
  if (!member) throw new AppError(404, "Membership was not found");
  return member;
}

function assertMemberExists(db: Database.Database, memberId: string): void {
  requiredMember(db, memberId);
}

function loadMember(db: Database.Database, memberId: string): MemberRow | undefined {
  return one<MemberRow>(
    db,
    "SELECT id, status, membership_type, access_scope FROM members WHERE id = ?",
    memberId,
  );
}

function loadPlan(db: Database.Database, membershipType: string): PlanRow | undefined {
  return one<PlanRow>(
    db,
    `SELECT membership_type, amount_minor, period, currency, updated_at, updated_by
     FROM plan_allowances WHERE membership_type = ?`,
    membershipType,
  );
}

function loadTab(db: Database.Database, memberId: string, currency: string): TabRow {
  const row = one<TabRow>(
    db,
    "SELECT limit_minor, frozen, currency FROM member_tabs WHERE member_id = ?",
    memberId,
  );
  if (!row) return { limit_minor: 0, frozen: 0, currency };
  return row;
}

function entryByRequest(db: Database.Database, requestId: string): EntryRow | undefined {
  return one<EntryRow>(db, `SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE request_id = ?`, requestId);
}

function planView(row: PlanRow, decimals: number): PlanView {
  const period = periodOf(row.period);
  return {
    membershipType: row.membership_type,
    amountMinor: row.amount_minor,
    amountMajor: minorToMajorString(row.amount_minor, decimals),
    period,
    currency: row.currency,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function periodOf(value: string): AllowancePeriod {
  if (!isAllowancePeriod(value)) throw new Error(`Unknown allowance period: ${value}`);
  return value;
}

function methodOf(value: string): "lightning" | "stripe" | "square" {
  switch (value) {
    case "lightning":
    case "stripe":
    case "square":
      return value;
    default:
      throw new Error(`Unknown payment method: ${value}`);
  }
}

function toEntry(row: EntryRow, decimals: number): LedgerEntryView {
  const kind = kindOf(row.kind);
  const source = sourceOf(row.source);
  const unit = row.unit === "sats" ? "sats" : "minor";
  if (row.unit !== "minor" && row.unit !== "sats") throw new Error("ledger unit is invalid");
  return {
    id: row.id,
    memberId: row.member_id,
    at: row.at,
    kind,
    source,
    deviceId: row.device_id,
    requestId: row.request_id,
    description: row.description,
    currency: row.currency,
    unit,
    amountMinor: row.amount_minor,
    amountMajor: minorToMajorString(row.amount_minor, decimals),
    amountSats: row.amount_sats,
    allowanceMinor: row.allowance_minor,
    tabMinor: row.tab_minor,
    periodKey: row.period_key,
    guestId: row.guest_id,
    guestLabel: row.guest_label,
    reason: row.reason,
    actorLabel: row.actor_label,
    settlementId: row.settlement_id,
  };
}

function kindOf(value: string): LedgerKind {
  switch (value) {
    case "charge":
    case "settlement":
    case "adjustment":
      return value;
    default:
      throw new Error(`Unknown ledger kind: ${value}`);
  }
}

function sourceOf(value: string): LedgerSource {
  switch (value) {
    case "staff":
    case "vending":
    case "member":
    case "admin":
      return value;
    default:
      throw new Error(`Unknown ledger source: ${value}`);
  }
}

function major(amountMinor: number, config: AppConfig): string {
  return minorToMajorString(amountMinor, config.currencyDecimals);
}

function assertMinor(value: number, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new AppError(400, "Amount must be an integer of minor units");
  }
}

function asInt(value: number | bigint | null, label: string): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`${label} is outside safe integer range`);
    }
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} was not an integer`);
  }
  return value;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

const ENTRY_COLUMNS = `id, member_id, at, kind, source, device_id, request_id, description, currency, unit,
  amount_minor, amount_sats, allowance_minor, tab_minor, period_key, guest_id, guest_label,
  reason, actor_label, settlement_id`;
