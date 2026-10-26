// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { AccessDeps } from "./access/service.js";
import type { AppDeps } from "./deps.js";
import { one } from "./db.js";
import { AppError } from "./errors.js";
import { readJson, requireAdmin, requireStaff, sendBytes, sendJson, sendText, type HttpReq, type Route } from "./http.js";
import { newId } from "./ids.js";
import {
  consumeVendChallenge,
  handleVendLogin,
  memberFromCard,
  memberFromVendChallenge,
  mintVendChallenge,
  vendChallengeStatus,
  vendLnurlDocument,
} from "./ledger/device.js";
import { exactMinorFromSats, type MoneyUnit } from "./ledger/money.js";
import { isAllowancePeriod, type AllowancePeriod } from "./ledger/periods.js";
import {
  ledgerCsv,
  expireDueTabSettlements,
  listLedger,
  listPlans,
  postAdjustment,
  postCharge,
  readBalance,
  readIdempotentCharge,
  readMemberForPlayer,
  setPlanAllowance,
  setTabFrozen,
  setTabLimit,
  type AdjustmentDirection,
  type ChargeInput,
} from "./ledger/service.js";
import { applyIncomingPayment, openTabSettlement, settlementById, settlementForMember, type PayMethod } from "./ledger/settle.js";
import { pngQr } from "./qr.js";
import { playerFromRequest, type PlayerView } from "./player/service.js";
import { safeEqual } from "./security.js";
import { describeActor } from "./staff/audit.js";
import { resolveActor } from "./staff/gate.js";
import { asObject, requiredInt, requiredString } from "./validate.js";
import type { CardProof } from "./nfc/entry.js";

const AMOUNT_CAP = Number.MAX_SAFE_INTEGER;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;

export function ledgerRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "GET", pattern: "/api/admin/allowances", handler: (req) => adminPlans(req, ctx) },
    { method: "POST", pattern: "/api/admin/allowances", handler: (req) => adminSetPlan(req, ctx) },
    { method: "GET", pattern: "/api/admin/members/:id/tab", handler: (req) => adminBalance(req, ctx) },
    { method: "POST", pattern: "/api/admin/members/:id/tab", handler: (req) => adminTabLimit(req, ctx) },
    { method: "POST", pattern: "/api/admin/members/:id/tab/freeze", handler: (req) => adminFreeze(req, ctx, true) },
    { method: "POST", pattern: "/api/admin/members/:id/tab/unfreeze", handler: (req) => adminFreeze(req, ctx, false) },
    { method: "POST", pattern: "/api/admin/members/:id/tab/adjust", handler: (req) => adminAdjust(req, ctx) },
    { method: "GET", pattern: "/api/admin/ledger", handler: (req) => adminLedger(req, ctx) },
    { method: "GET", pattern: "/api/admin/ledger.csv", handler: (req) => adminLedgerCsv(req, ctx) },
    { method: "POST", pattern: "/api/admin/tab-settlements/:id/simulate-payment", handler: (req) => simulateSettlement(req, ctx) },
    { method: "GET", pattern: "/api/staff/members/:id/tab", handler: (req) => staffBalance(req, ctx) },
    { method: "POST", pattern: "/api/staff/tabs/charges", handler: (req) => staffCharge(req, ctx) },
    { method: "GET", pattern: "/api/player/tab", handler: (req) => playerTab(req, ctx) },
    { method: "POST", pattern: "/api/player/tab/settle", handler: (req) => playerSettle(req, ctx) },
    { method: "GET", pattern: "/api/player/tab/settlements/:id", handler: (req) => playerSettlement(req, ctx) },
    { method: "POST", pattern: "/api/devices/vending/challenges", handler: (req) => vendChallenge(req, ctx) },
    { method: "GET", pattern: "/api/devices/vending/challenges/:k1", handler: (req) => vendStatus(req, ctx) },
    { method: "GET", pattern: "/api/devices/vending/challenges/:k1/qr.png", handler: (req) => vendQr(req, ctx) },
    { method: "GET", pattern: "/api/devices/vending/lnurl", handler: (req) => vendLnurl(req, ctx) },
    { method: "GET", pattern: "/api/devices/vending/callback", handler: (req) => vendCallback(req, ctx) },
    { method: "POST", pattern: "/api/devices/vending/charges", handler: (req) => vendCharge(req, ctx) },
  ];
}

function adminPlans(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendJson(req.res, 200, { allowances: listPlans(ctx.db, ctx.config) });
  return Promise.resolve();
}

function adminSetPlan(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const allowance = setPlanAllowance(ctx.db, ctx.config, {
    membershipType: requiredString(body, "membershipType", 40).toLowerCase(),
    amountMinor: requiredInt(body, "amountMinor", 0, AMOUNT_CAP),
    period: periodFrom(body),
    actorLabel: actorLabel(req, ctx),
    now: ctx.now(),
  });
  sendJson(req.res, 200, { allowance });
  return Promise.resolve();
}

function adminBalance(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendJson(req.res, 200, { balance: readBalance(ctx.db, ctx.config, req.params.id ?? "", ctx.now()) });
  return Promise.resolve();
}

function adminTabLimit(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const tab = setTabLimit(
    ctx.db,
    ctx.config,
    req.params.id ?? "",
    requiredInt(body, "limitMinor", 0, AMOUNT_CAP),
    actorLabel(req, ctx),
    ctx.now(),
  );
  sendJson(req.res, 200, { tab });
  return Promise.resolve();
}

function adminFreeze(req: HttpReq, ctx: AppDeps, frozen: boolean): Promise<void> {
  requireAdmin(req, ctx);
  const tab = setTabFrozen(ctx.db, ctx.config, req.params.id ?? "", frozen, actorLabel(req, ctx), ctx.now());
  sendJson(req.res, 200, { tab });
  return Promise.resolve();
}

function adminAdjust(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const result = postAdjustment(ctx.db, ctx.config, {
    memberId: req.params.id ?? "",
    direction: directionFrom(body),
    amountMinor: requiredInt(body, "amountMinor", 1, AMOUNT_CAP),
    reason: requiredString(body, "reason", 200),
    requestId: optionalRequestId(body) ?? newId("req"),
    actorLabel: actorLabel(req, ctx),
    now: ctx.now(),
  });
  sendJson(req.res, 200, result);
  return Promise.resolve();
}

function adminLedger(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const limit = queryLimit(req, 100);
  const memberId = optionalQuery(req, "memberId");
  sendJson(req.res, 200, listLedger(ctx.db, ctx.config, memberId, limit));
  return Promise.resolve();
}

function adminLedgerCsv(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendText(req.res, 200, ledgerCsv(ctx.db, ctx.config, optionalQuery(req, "memberId")), "text/csv; charset=utf-8", {
    "content-disposition": "attachment; filename=\"ledger.csv\"",
  });
  return Promise.resolve();
}

function simulateSettlement(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  if (ctx.config.paymentBackend !== "mock") {
    throw new AppError(404, "Mock settlement is only available when PAYMENT_BACKEND=mock");
  }
  const row = one<{ invoice_id: string; payment_hash: string | null; bolt11: string }>(
    ctx.db,
    "SELECT invoice_id, payment_hash, bolt11 FROM tab_settlements WHERE id = ?",
    req.params.id ?? "",
  );
  if (!row) throw new AppError(404, "Settlement was not found");
  if (row.invoice_id.startsWith("pending:") || row.bolt11 === "pending") {
    throw new AppError(409, "The invoice is not ready");
  }
  const result = applyIncomingPayment(
    ctx.db,
    {
      kind: "settled",
      invoiceId: row.invoice_id,
      paymentHash: row.payment_hash,
      settledAt: ctx.now().toISOString(),
    },
    ctx.now(),
  );
  const settlement = settlementById(ctx.db, req.params.id ?? "");
  sendJson(req.res, 200, { ...result, settlement });
  return Promise.resolve();
}

function staffBalance(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  sendJson(req.res, 200, { balance: readBalance(ctx.db, ctx.config, req.params.id ?? "", ctx.now()) });
  return Promise.resolve();
}

function staffCharge(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  const body = asObject(readJson(req));
  assertCurrency(body, ctx);
  const money = chargeMoney(body, ctx);
  const input: ChargeInput = {
    memberId: requiredString(body, "memberId", 80),
    source: "staff",
    deviceId: null,
    requestId: optionalRequestId(body) ?? newId("req"),
    description: requiredString(body, "description", 80),
    unit: money.unit,
    amountMinor: money.amountMinor,
    amountSats: money.amountSats,
    guestId: optionalBodyId(body, "guestId"),
    actorLabel: actorLabel(req, ctx),
    now: ctx.now(),
  };
  const replay = readIdempotentCharge(ctx.db, ctx.config, input, true);
  if (replay) {
    sendJson(req.res, 200, replay);
    return Promise.resolve();
  }
  const result = postCharge(ctx.db, ctx.config, input);
  sendJson(req.res, 201, result);
  return Promise.resolve();
}

function playerTab(req: HttpReq, ctx: AppDeps): Promise<void> {
  const member = linkedMember(req, ctx);
  sendJson(req.res, 200, { balance: readBalance(ctx.db, ctx.config, member.id, ctx.now()) });
  return Promise.resolve();
}

async function playerSettle(req: HttpReq, ctx: AppDeps): Promise<void> {
  const member = linkedMember(req, ctx);
  const body = asObject(readJson(req));
  const amountMinor = body.amountMinor === undefined ? null : requiredInt(body, "amountMinor", 1, AMOUNT_CAP);
  const settlement = await openTabSettlement(ctx.db, ctx.config, ctx.payments, ctx.cards, {
    memberId: member.id,
    method: methodFrom(body, ctx),
    amountMinor,
    now: ctx.now(),
  });
  sendJson(req.res, 201, { settlement });
}

async function playerSettlement(req: HttpReq, ctx: AppDeps): Promise<void> {
  const member = linkedMember(req, ctx);
  const id = req.params.id ?? "";
  let settlement = settlementForMember(ctx.db, id, member.id);
  if (!settlement) throw new AppError(404, "Settlement was not found");
  expireDueTabSettlements(ctx.db, ctx.now());
  if (
    settlement.status === "pending" &&
    settlement.paymentMethod === "lightning" &&
    ctx.payments.lookupInvoice &&
    ctx.limiters.callbacks.allow(`tab-lookup:${id}`)
  ) {
    const invoiceId = one<{ invoice_id: string }>(ctx.db, "SELECT invoice_id FROM tab_settlements WHERE id = ?", id);
    if (invoiceId && !invoiceId.invoice_id.startsWith("pending:")) {
      try {
        const event = await ctx.payments.lookupInvoice(invoiceId.invoice_id, ctx.now().toISOString());
        applyIncomingPayment(ctx.db, event, ctx.now());
      } catch {
        // The webhook can still arrive. A lookup failure leaves the settlement pending.
      }
    }
  }
  settlement = settlementForMember(ctx.db, id, member.id);
  if (!settlement) throw new AppError(404, "Settlement was not found");
  sendJson(req.res, 200, { settlement });
}

function vendChallenge(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireDevice(req, ctx);
  if (!ctx.limiters.challenges.allow(`vend:${req.ip}`)) throw new AppError(429, "Too many codes. Wait a moment.");
  const body = asObject(readJson(req));
  const challenge = mintVendChallenge(accessDeps(ctx), deviceIdFrom(body));
  sendJson(req.res, 201, { challenge });
  return Promise.resolve();
}

function vendStatus(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireDevice(req, ctx);
  const challenge = vendChallengeStatus(accessDeps(ctx), req.params.k1 ?? "", null);
  if (!challenge) throw new AppError(404, "Code not found");
  sendJson(req.res, 200, { challenge });
  return Promise.resolve();
}

async function vendQr(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireDevice(req, ctx);
  const challenge = vendChallengeStatus(accessDeps(ctx), req.params.k1 ?? "", null);
  if (!challenge) throw new AppError(404, "Code not found");
  sendBytes(req.res, 200, await pngQr(challenge.lnurl), "image/png");
}

function vendLnurl(req: HttpReq, ctx: AppDeps): Promise<void> {
  sendJson(req.res, 200, vendLnurlDocument(accessDeps(ctx), req.url.searchParams.get("k1") ?? ""));
  return Promise.resolve();
}

function vendCallback(req: HttpReq, ctx: AppDeps): Promise<void> {
  const result = handleVendLogin(accessDeps(ctx), {
    k1: req.url.searchParams.get("k1") ?? "",
    sig: req.url.searchParams.get("sig") ?? "",
    key: req.url.searchParams.get("key") ?? req.url.searchParams.get("pubkey") ?? "",
    ip: req.ip,
  });
  sendJson(req.res, 200, result);
  return Promise.resolve();
}

function vendCharge(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireDevice(req, ctx);
  const body = asObject(readJson(req));
  assertCurrency(body, ctx);
  const deviceId = deviceIdFrom(body);
  const money = chargeMoney(body, ctx);
  const input: ChargeInput = {
    memberId: "",
    source: "vending",
    deviceId,
    requestId: requestIdFrom(requiredString(body, "requestId", 80)),
    description: requiredString(body, "description", 80),
    unit: money.unit,
    amountMinor: money.amountMinor,
    amountSats: money.amountSats,
    guestId: optionalBodyId(body, "guestId"),
    actorLabel: `vending:${deviceId}`,
    now: ctx.now(),
  };
  const replay = readIdempotentCharge(ctx.db, ctx.config, input, false);
  if (replay) {
    sendJson(req.res, 200, replay);
    return Promise.resolve();
  }
  if (!ctx.limiters.callbacks.allow(`vend-charge:${deviceId}`)) {
    throw new AppError(429, "Too many charges. Wait a moment.");
  }
  const identity = identityFrom(body);
  const deps = accessDeps(ctx);
  const memberId = identity.type === "card" ? memberFromCard(deps, identity.proof) : memberFromVendChallenge(deps, identity.k1, deviceId);
  const charged = postCharge(ctx.db, ctx.config, { ...input, memberId }, () => {
    if (identity.type === "lnurl") consumeVendChallenge(deps, identity.k1, deviceId, memberId);
  });
  sendJson(req.res, 201, charged);
  return Promise.resolve();
}

function linkedMember(req: HttpReq, ctx: AppDeps): { id: string } {
  const player = requirePlayer(req, ctx);
  const member = readMemberForPlayer(ctx.db, player);
  if (!member) throw new AppError(404, "No membership is linked to this login");
  return member;
}

function requirePlayer(req: HttpReq, ctx: AppDeps): PlayerView {
  const player = playerFromRequest(ctx.db, req.headers, ctx.now());
  if (!player) throw new AppError(401, "Log in to see this tab");
  return player;
}

function requireDevice(req: HttpReq, ctx: AppDeps): void {
  const expected = ctx.config.vendingDeviceToken;
  if (!expected) throw new AppError(503, "Vending devices are not configured");
  const header = req.headers.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token || !safeEqual(token, expected)) throw new AppError(401, "Device token required");
}

function actorLabel(req: HttpReq, ctx: AppDeps): string {
  return describeActor(resolveActor(req, ctx.config, ctx.db, ctx.now()));
}

function accessDeps(ctx: AppDeps): AccessDeps {
  return {
    config: ctx.config,
    db: ctx.db,
    door: ctx.door,
    now: ctx.now,
    callbacks: ctx.limiters.callbacks,
    notifier: ctx.notifier,
  };
}

function periodFrom(body: Record<string, unknown>): AllowancePeriod {
  const period = requiredString(body, "period", 16);
  if (!isAllowancePeriod(period)) throw new AppError(400, "period must be visit, day, week, or month");
  return period;
}

function directionFrom(body: Record<string, unknown>): AdjustmentDirection {
  const direction = requiredString(body, "direction", 16);
  switch (direction) {
    case "credit":
    case "debit":
      return direction;
    default:
      throw new AppError(400, "direction must be credit or debit");
  }
}

function methodFrom(body: Record<string, unknown>, ctx: AppDeps): PayMethod {
  const method = body.method === undefined || body.method === "" ? "lightning" : body.method;
  if (method === "lightning") return "lightning";
  if (method === "stripe" || method === "square") {
    if (!ctx.config.cardProviders.includes(method)) throw new AppError(400, "That payment method is not enabled");
    return method;
  }
  throw new AppError(400, "method must be lightning, stripe, or square");
}

function chargeMoney(
  body: Record<string, unknown>,
  ctx: AppDeps,
): { unit: MoneyUnit; amountMinor: number; amountSats: number | null } {
  const raw = body.unit === undefined || body.unit === "" ? "minor" : body.unit;
  if (raw !== "minor" && raw !== "sats") throw new AppError(400, "unit must be minor or sats");
  const unitRaw: MoneyUnit = raw;
  switch (unitRaw) {
    case "minor":
      if (body.amountSats !== undefined) throw new AppError(400, "Send amountMinor or amountSats, not both");
      return { unit: "minor", amountMinor: requiredInt(body, "amountMinor", 1, AMOUNT_CAP), amountSats: null };
    case "sats":
      if (body.amountMinor !== undefined) throw new AppError(400, "Send amountMinor or amountSats, not both");
      {
        const amountSats = requiredInt(body, "amountSats", 1, AMOUNT_CAP);
        return { unit: "sats", amountMinor: exactMinorFromSats(amountSats, ctx.config.satsPerMinorUnit), amountSats };
      }
    default: {
      const unknown: never = unitRaw;
      throw new AppError(400, `Unknown unit ${String(unknown)}`);
    }
  }
}

type Identity =
  | { type: "card"; proof: CardProof }
  | { type: "lnurl"; k1: string };

function identityFrom(body: Record<string, unknown>): Identity {
  const identity = asObject(body.identity);
  const kind = requiredString(identity, "kind", 32);
  switch (kind) {
    case "nfc-sun":
      return {
        type: "card",
        proof: {
          kind: "sun",
          piccDataHex: requiredString(identity, "piccData", 512),
          cmacHex: requiredString(identity, "cmac", 64),
        },
      };
    case "nfc-desfire":
      return {
        type: "card",
        proof: {
          kind: "desfire",
          uidHex: requiredString(identity, "uid", 32),
          counter: requiredInt(identity, "counter", 0, 0xffffff),
          cmacHex: requiredString(identity, "cmac", 64),
        },
      };
    case "nfc-uid":
      return { type: "card", proof: { kind: "uid-insecure", uidHex: requiredString(identity, "uid", 32) } };
    case "lnurl":
      return { type: "lnurl", k1: requiredString(identity, "k1", 80).toLowerCase() };
    default:
      throw new AppError(400, "identity.kind must be nfc-sun, nfc-desfire, nfc-uid, or lnurl");
  }
}

function deviceIdFrom(body: Record<string, unknown>): string {
  const deviceId = requiredString(body, "deviceId", 41);
  if (!DEVICE_ID.test(deviceId)) throw new AppError(400, "deviceId must be letters, numbers, _ or -");
  return deviceId;
}

function optionalRequestId(body: Record<string, unknown>): string | null {
  if (body.requestId === undefined || body.requestId === null || body.requestId === "") return null;
  return requestIdFrom(requiredString(body, "requestId", 80));
}

function requestIdFrom(value: string): string {
  if (!REQUEST_ID.test(value)) {
    throw new AppError(400, "requestId must be 1-80 letters, numbers, or . _ : -");
  }
  return value;
}

function optionalBodyId(body: Record<string, unknown>, key: string): string | null {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null;
  return requiredString(body, key, 80);
}

function optionalQuery(req: HttpReq, key: string): string | null {
  const value = req.url.searchParams.get(key);
  if (!value) return null;
  if (value.length > 80) throw new AppError(400, `${key} is too long`);
  return value;
}

function queryLimit(req: HttpReq, fallback: number): number {
  const raw = req.url.searchParams.get("limit");
  if (raw === null || raw === "") return fallback;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError(400, "limit must be an integer from 1 to 500");
  }
  return limit;
}

function assertCurrency(body: Record<string, unknown>, ctx: AppDeps): void {
  if (body.currency === undefined || body.currency === null || body.currency === "") return;
  if (body.currency !== ctx.config.currency) throw new AppError(400, "currency must match the club currency");
}
