// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { immediate, one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import { zonedLocalToUtc } from "../time.js";
import type { CardSet } from "../payments/cards/index.js";
import { claimOpenSlot } from "./claim.js";
import { quotePrice } from "./prices.js";
import type { PaymentBackend, WebhookInterpretation } from "../payments/types.js";
import { attachPlayerMember, playerIsPayingMember } from "../player/service.js";

export type CourtView = {
  id: string;
  name: string;
  active: boolean;
};

export type SlotView = {
  id: string;
  courtId: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  priceMinor: number;
  guestPriceMinor: number;
  memberPriceMinor: number;
  currency: string;
  status: "open" | "held" | "booked" | "cancelled";
  holdId: string | null;
  /** True when an active imported booking already covers this court and time. */
  blocked: boolean;
};

export type HoldView = {
  id: string;
  slotId: string;
  courtId: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  status: "pending" | "paid" | "expired" | "released";
  amountMinor: number;
  currency: string;
  amountSats: number | null;
  bolt11: string;
  payable: boolean;
  expiresAt: string;
  bookingId: string | null;
  paymentMethod: "lightning" | "stripe" | "square";
  checkoutUrl: string | null;
};

export type BookingView = {
  id: string;
  slotId: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  amountMinor: number;
  currency: string;
  amountSats: number | null;
  paymentRef: string;
  confirmedAt: string;
};

export type PaymentApplyResult = {
  outcome: "confirmed" | "already-confirmed" | "expired" | "ignored" | "unknown";
  bookingId: string | null;
};

type SlotRow = {
  id: string;
  court_id: string;
  court_name: string;
  starts_at: string;
  ends_at: string;
  price_minor: number;
  currency: string;
  status: string;
  hold_id: string | null;
  court_active: number;
  blocked: number;
};

const BLOCKED_SQL = `EXISTS (
  SELECT 1 FROM external_bookings e
  WHERE e.court_id = s.court_id
    AND e.status = 'active'
    AND e.starts_at < s.ends_at
    AND e.ends_at > s.starts_at
) AS blocked`;

const SLOT_STATUSES = new Set(["open", "held", "booked", "cancelled"]);
const HOLD_STATUSES = new Set(["pending", "paid", "expired", "released"]);

export function createCourt(db: Database.Database, name: string, now: Date): CourtView {
  const id = newId("court");
  db.prepare("INSERT INTO courts (id, name, active, created_at) VALUES (?, ?, 1, ?)").run(
    id,
    name,
    now.toISOString(),
  );
  return { id, name, active: true };
}

export function listCourts(db: Database.Database, activeOnly: boolean): CourtView[] {
  const rows = db
    .prepare(
      `SELECT id, name, active FROM courts
       WHERE (? = 0 OR active = 1)
       ORDER BY name ASC`,
    )
    .all(activeOnly ? 1 : 0) as Array<{ id: string; name: string; active: number }>;
  return rows.map((row) => ({ id: row.id, name: row.name, active: row.active === 1 }));
}

export function deactivateCourt(db: Database.Database, courtId: string): void {
  const info = db.prepare("UPDATE courts SET active = 0 WHERE id = ? AND active = 1").run(courtId);
  if (info.changes !== 1) throw new AppError(404, "Court not found");
}

export type NewSlot = {
  courtId: string;
  startsAt: string;
  endsAt: string;
  priceMinor: number;
  currency: string;
};

export function createSlot(db: Database.Database, input: NewSlot, now: Date): SlotView {
  return immediate(db, () => insertSlot(db, input, now));
}

export function generateSlots(
  db: Database.Database,
  input: {
    courtId: string;
    date: string;
    startTime: string;
    endTime: string;
    slotMinutes: number;
    priceMinor: number;
    currency: string;
    timeZone: string;
  },
  now: Date,
): SlotView[] {
  let windowStart: Date;
  let windowEnd: Date;
  try {
    windowStart = zonedLocalToUtc(input.date, input.startTime, input.timeZone);
    windowEnd = zonedLocalToUtc(input.date, input.endTime, input.timeZone);
  } catch {
    throw new AppError(400, "date must be YYYY-MM-DD and times must be HH:MM");
  }
  if (windowEnd.getTime() <= windowStart.getTime()) {
    windowEnd = new Date(windowEnd.getTime() + 86_400_000);
  }
  const step = input.slotMinutes * 60_000;
  const count = Math.floor((windowEnd.getTime() - windowStart.getTime()) / step);
  if (count < 1) throw new AppError(400, "That window does not fit one slot");
  if (count > 48) throw new AppError(400, "That window would create more than 48 slots");
  return immediate(db, () => {
    const created: SlotView[] = [];
    for (let index = 0; index < count; index += 1) {
      const starts = new Date(windowStart.getTime() + index * step);
      const ends = new Date(starts.getTime() + step);
      created.push(
        insertSlot(
          db,
          {
            courtId: input.courtId,
            startsAt: starts.toISOString(),
            endsAt: ends.toISOString(),
            priceMinor: input.priceMinor,
            currency: input.currency,
          },
          now,
        ),
      );
    }
    return created;
  });
}

export function setSlotPrice(db: Database.Database, slotId: string, priceMinor: number): SlotView {
  return immediate(db, () => {
    const info = db
      .prepare("UPDATE slots SET price_minor = ? WHERE id = ? AND status = 'open'")
      .run(priceMinor, slotId);
    if (info.changes !== 1) throw new AppError(409, "Only an open slot can change price");
    const slot = loadSlot(db, slotId, true);
    if (!slot) throw new AppError(404, "Slot not found");
    return slot;
  });
}

export function cancelSlot(db: Database.Database, slotId: string): void {
  const info = db
    .prepare("UPDATE slots SET status = 'cancelled' WHERE id = ? AND status = 'open'")
    .run(slotId);
  if (info.changes !== 1) throw new AppError(409, "Only an open slot can be cancelled");
}

export function listSlots(
  db: Database.Database,
  filter: {
    courtId: string | null;
    from: string | null;
    to: string | null;
    includeInactiveCourts: boolean;
    includeCancelled: boolean;
    includeHoldId: boolean;
  },
  now: Date,
  timeZone?: string,
): SlotView[] {
  releaseExpired(db, now);
  const rows = db
    .prepare(
      `SELECT s.id, s.court_id, c.name AS court_name, s.starts_at, s.ends_at,
              s.price_minor, s.currency, s.status, c.active AS court_active,
              h.id AS hold_id, ${BLOCKED_SQL}
       FROM slots s
       JOIN courts c ON c.id = s.court_id
       LEFT JOIN holds h ON h.slot_id = s.id AND h.status = 'pending'
       WHERE (? IS NULL OR s.court_id = ?)
         AND (? IS NULL OR s.starts_at >= ?)
         AND (? IS NULL OR s.starts_at < ?)
         AND (? = 1 OR c.active = 1)
         AND (? = 1 OR s.status != 'cancelled')
       ORDER BY s.starts_at ASC
       LIMIT 500`,
    )
    .all(
      filter.courtId,
      filter.courtId,
      filter.from,
      filter.from,
      filter.to,
      filter.to,
      filter.includeInactiveCourts ? 1 : 0,
      filter.includeCancelled ? 1 : 0,
    ) as SlotRow[];
  return rows.map((row) => {
    const slot = toSlot(row, filter.includeHoldId);
    if (!timeZone) return slot;
    const quote = {
      courtId: slot.courtId,
      startsAt: slot.startsAt,
      priceMinor: slot.priceMinor,
    };
    return {
      ...slot,
      guestPriceMinor: quotePrice(db, quote, false, timeZone),
      memberPriceMinor: quotePrice(db, quote, true, timeZone),
    };
  });
}

export type HoldOptions = {
  receiptEmail?: string | null;
  method?: "lightning" | "stripe" | "square";
  playerId?: string | null;
  reminderEmail?: boolean;
  reminderSms?: boolean;
  reminderPhone?: string | null;
  cards?: CardSet | null;
};

export async function holdSlot(
  db: Database.Database,
  config: AppConfig,
  payments: PaymentBackend,
  slotId: string,
  now: Date,
  receiptEmail: string | null = null,
  options: HoldOptions = {},
): Promise<HoldView> {
  releaseExpired(db, now);
  const slot = loadSlot(db, slotId, false);
  if (!slot || slot.status !== "open" || !courtIsActive(db, slot.courtId)) {
    throw new AppError(409, "That slot is not open");
  }
  if (Date.parse(slot.startsAt) <= now.getTime()) {
    throw new AppError(400, "That slot has already started");
  }
  if (slot.blocked) {
    throw new AppError(409, "That time is already on the imported calendar.");
  }
  const method = options.method ?? "lightning";
  const member = options.playerId ? playerIsPayingMember(db, options.playerId) : false;
  const amountMinor = quotePrice(
    db,
    { courtId: slot.courtId, startsAt: slot.startsAt, priceMinor: slot.priceMinor },
    member,
    config.clubTimeZone,
  );
  const holdId = newId("hold");
  const expirySeconds = config.holdMinutes * 60;
  const invoice = await createCharge(config, payments, options.cards ?? null, method, {
    orderId: holdId,
    amountMinor,
    currency: slot.currency,
    currencyDecimals: config.currencyDecimals,
    memo: memoFor(slot),
    expirySeconds,
    nowIso: now.toISOString(),
    webhookUrl: method === "lightning" ? lnbitsWebhook(config) : config.publicBaseUrl,
  });
  const holdExpiry = new Date(now.getTime() + expirySeconds * 1000).toISOString();
  const expiresAt = invoice.expiresAt < holdExpiry ? invoice.expiresAt : holdExpiry;
  const claimed = claimOpenSlot(db, {
    slotId,
    holdId,
    invoiceId: invoice.invoiceId,
    paymentHash: invoice.paymentHash,
    bolt11: invoice.bolt11,
    amountSats: invoice.amountSats,
    amountMinor,
    currency: slot.currency,
    expiresAt,
    nowIso: now.toISOString(),
    timeZone: config.clubTimeZone,
    member,
  });
  if (!claimed.ok) {
    const message = holdRefusal(claimed.reason);
    throw new AppError(409, message);
  }
  db.prepare(
    `UPDATE holds
     SET receipt_email = ?, payment_method = ?, checkout_url = ?, player_id = ?,
         reminder_email = ?, reminder_sms = ?, reminder_phone = ?
     WHERE id = ?`,
  ).run(
    receiptEmail,
    method,
    invoice.checkoutUrl,
    options.playerId ?? null,
    options.reminderEmail ? 1 : 0,
    options.reminderSms ? 1 : 0,
    options.reminderPhone ?? null,
    holdId,
  );
  const hold = getHold(db, holdId, now);
  if (!hold) throw new Error("hold missing after it was created");
  return hold;
}

export function getHold(db: Database.Database, holdId: string, now: Date): HoldView | null {
  releaseExpired(db, now);
  const row = one<HoldJoin>(
    db,
    `SELECT h.id, h.slot_id, s.court_id, c.name AS court_name, s.starts_at, s.ends_at,
            h.status, h.amount_minor, h.currency, h.amount_sats, h.bolt11, h.expires_at,
            h.payment_method, h.checkout_url, b.id AS booking_id
     FROM holds h
     JOIN slots s ON s.id = h.slot_id
     JOIN courts c ON c.id = s.court_id
     LEFT JOIN bookings b ON b.hold_id = h.id
     WHERE h.id = ?`,
    holdId,
  );
  if (!row) return null;
  if (!HOLD_STATUSES.has(row.status)) throw new Error("hold status is invalid");
  const paymentMethod = paymentMethodOf(row.payment_method);
  return {
    id: row.id,
    slotId: row.slot_id,
    courtId: row.court_id,
    courtName: row.court_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as HoldView["status"],
    amountMinor: row.amount_minor,
    currency: row.currency,
    amountSats: row.amount_sats,
    bolt11: row.bolt11,
    payable:
      paymentMethod === "lightning" && row.status === "pending" && !row.bolt11.startsWith("mock-not-payable:"),
    expiresAt: row.expires_at,
    bookingId: row.booking_id,
    paymentMethod,
    checkoutUrl: row.checkout_url,
  };
}

export function holdBolt11(db: Database.Database, holdId: string, now: Date): string | null {
  const hold = getHold(db, holdId, now);
  if (!hold || hold.status === "expired" || hold.status === "released") return null;
  return hold.bolt11;
}

/**
 * Apply a settlement or expiry notice. Safe to call more than once:
 * a second settlement for the same invoice does not create a second booking,
 * and a late payment after the hold expired does not take the slot.
 */
export function applyPaymentEvent(
  db: Database.Database,
  event: WebhookInterpretation,
  now: Date,
): PaymentApplyResult {
  switch (event.kind) {
    case "ignore":
      return { outcome: "ignored", bookingId: null };
    case "expired":
      return expireByInvoice(db, event.invoiceId);
    case "settled":
      return confirmByInvoice(db, event, now);
    default: {
      const unknown: never = event;
      throw new Error(`Unhandled payment event: ${String(unknown)}`);
    }
  }
}

export function listBookings(db: Database.Database): BookingView[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.slot_id, c.name AS court_name, s.starts_at, s.ends_at,
              b.amount_minor, b.currency, b.amount_sats, b.payment_ref, b.confirmed_at
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       JOIN courts c ON c.id = s.court_id
       ORDER BY b.confirmed_at DESC
       LIMIT 500`,
    )
    .all() as Array<{
    id: string;
    slot_id: string;
    court_name: string;
    starts_at: string;
    ends_at: string;
    amount_minor: number;
    currency: string;
    amount_sats: number | null;
    payment_ref: string;
    confirmed_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    slotId: row.slot_id,
    courtName: row.court_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    amountMinor: row.amount_minor,
    currency: row.currency,
    amountSats: row.amount_sats,
    paymentRef: row.payment_ref,
    confirmedAt: row.confirmed_at,
  }));
}

export function bookingsCsv(rows: BookingView[]): string {
  const header = [
    "booking_id",
    "slot_id",
    "court",
    "starts_at",
    "ends_at",
    "amount_minor",
    "currency",
    "amount_sats",
    "payment_ref",
    "confirmed_at",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.slotId,
        csvCell(row.courtName),
        row.startsAt,
        row.endsAt,
        String(row.amountMinor),
        row.currency,
        row.amountSats == null ? "" : String(row.amountSats),
        row.paymentRef,
        row.confirmedAt,
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function releaseExpired(db: Database.Database, now: Date): number {
  const nowIso = now.toISOString();
  return immediate(db, () => {
    const expired = db
      .prepare("UPDATE holds SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?")
      .run(nowIso);
    db.prepare(
      `UPDATE slots SET status = 'open'
       WHERE status = 'held'
         AND NOT EXISTS (
           SELECT 1 FROM holds h WHERE h.slot_id = slots.id AND h.status = 'pending'
         )`,
    ).run();
    return expired.changes;
  });
}

function insertSlot(db: Database.Database, input: NewSlot, now: Date): SlotView {
  const startsMs = Date.parse(input.startsAt);
  const endsMs = Date.parse(input.endsAt);
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs) || endsMs <= startsMs) {
    throw new AppError(400, "Slot end must be after slot start");
  }
  const duration = endsMs - startsMs;
  if (duration < 60_000 || duration > 24 * 60 * 60 * 1000) {
    throw new AppError(400, "Slot length must be from 1 minute to 24 hours");
  }
  const court = one<{ active: number; id: string }>(
    db,
    "SELECT id, active FROM courts WHERE id = ?",
    input.courtId,
  );
  if (!court || court.active !== 1) throw new AppError(404, "Court not found");
  const overlap = one<{ id: string }>(
    db,
    `SELECT id FROM slots
     WHERE court_id = ?
       AND status != 'cancelled'
       AND starts_at < ?
       AND ends_at > ?
     LIMIT 1`,
    input.courtId,
    input.endsAt,
    input.startsAt,
  );
  if (overlap) throw new AppError(409, "That court already has a slot in that window");
  const id = newId("slot");
  db.prepare(
    `INSERT INTO slots (id, court_id, starts_at, ends_at, price_minor, currency, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(
    id,
    input.courtId,
    input.startsAt,
    input.endsAt,
    input.priceMinor,
    input.currency,
    now.toISOString(),
  );
  const slot = loadSlot(db, id, true);
  if (!slot) throw new Error("slot missing after insert");
  return slot;
}

function loadSlot(db: Database.Database, slotId: string, includeHoldId: boolean): SlotView | null {
  const row = one<SlotRow>(
    db,
    `SELECT s.id, s.court_id, c.name AS court_name, s.starts_at, s.ends_at,
            s.price_minor, s.currency, s.status, c.active AS court_active,
            h.id AS hold_id, ${BLOCKED_SQL}
     FROM slots s
     JOIN courts c ON c.id = s.court_id
     LEFT JOIN holds h ON h.slot_id = s.id AND h.status = 'pending'
     WHERE s.id = ?`,
    slotId,
  );
  if (!row) return null;
  return toSlot(row, includeHoldId);
}

function courtIsActive(db: Database.Database, courtId: string): boolean {
  const court = one<{ active: number }>(db, "SELECT active FROM courts WHERE id = ?", courtId);
  return court?.active === 1;
}

function toSlot(row: SlotRow, includeHoldId: boolean): SlotView {
  if (!SLOT_STATUSES.has(row.status)) throw new Error("slot status is invalid");
  return {
    id: row.id,
    courtId: row.court_id,
    courtName: row.court_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    priceMinor: row.price_minor,
    guestPriceMinor: row.price_minor,
    memberPriceMinor: row.price_minor,
    currency: row.currency,
    status: row.status as SlotView["status"],
    holdId: includeHoldId ? row.hold_id : null,
    blocked: row.blocked === 1,
  };
}

function holdRefusal(reason: "unavailable" | "price-changed" | "blocked"): string {
  switch (reason) {
    case "price-changed":
      return "The price changed. Refresh and try again.";
    case "blocked":
      return "That time is already on the imported calendar.";
    case "unavailable":
      return "That slot is no longer open";
    default: {
      const unknown: never = reason;
      throw new Error(`Unhandled claim reason: ${String(unknown)}`);
    }
  }
}

function memoFor(slot: SlotView): string {
  const name = slot.courtName.replace(/\s+/g, " ").slice(0, 40);
  return `Court booking ${name} ${slot.startsAt}`.slice(0, 140);
}

function lnbitsWebhook(config: AppConfig): string | null {
  if (config.paymentBackend !== "lnbits" || !config.lnbits) return null;
  return `${config.publicBaseUrl}/api/webhooks/lnbits/${config.lnbits.webhookSecret}`;
}

type HoldJoin = {
  id: string;
  slot_id: string;
  court_id: string;
  court_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  amount_minor: number;
  currency: string;
  amount_sats: number | null;
  bolt11: string;
  expires_at: string;
  booking_id: string | null;
  payment_method: string | null;
  checkout_url: string | null;
};

type HoldPayRow = {
  id: string;
  slot_id: string;
  status: string;
  payment_hash: string | null;
  amount_minor: number;
  currency: string;
  amount_sats: number | null;
  expires_at: string;
};

function confirmByInvoice(
  db: Database.Database,
  event: { invoiceId: string; paymentHash: string | null; settledAt: string },
  now: Date,
): PaymentApplyResult {
  return immediate(db, () => {
    const hold = one<HoldPayRow>(
      db,
      `SELECT id, slot_id, status, payment_hash, amount_minor, currency, amount_sats, expires_at
       FROM holds WHERE invoice_id = ?`,
      event.invoiceId,
    );
    if (!hold) return { outcome: "unknown", bookingId: null };
    const existing = one<{ id: string }>(db, "SELECT id FROM bookings WHERE hold_id = ?", hold.id);
    if (hold.status === "paid" && existing) return { outcome: "already-confirmed", bookingId: existing.id };
    if (hold.status !== "pending") return { outcome: "ignored", bookingId: null };
    const nowIso = now.toISOString();
    if (hold.expires_at <= nowIso) {
      db.prepare("UPDATE holds SET status = 'expired' WHERE id = ? AND status = 'pending'").run(hold.id);
      db.prepare("UPDATE slots SET status = 'open' WHERE id = ? AND status = 'held'").run(hold.slot_id);
      return { outcome: "expired", bookingId: null };
    }
    const slot = one<{ status: string }>(db, "SELECT status FROM slots WHERE id = ?", hold.slot_id);
    if (!slot || slot.status !== "held") return { outcome: "ignored", bookingId: null };
    const paid = db
      .prepare(
        `UPDATE holds
         SET status = 'paid', paid_at = ?, payment_hash = COALESCE(?, payment_hash)
         WHERE id = ? AND status = 'pending'`,
      )
      .run(event.settledAt, event.paymentHash ?? hold.payment_hash, hold.id);
    if (paid.changes !== 1) return { outcome: "ignored", bookingId: null };
    const bookingId = newId("bk");
    const holdMeta = one<{ payment_method: string | null; player_id: string | null }>(
      db,
      "SELECT payment_method, player_id FROM holds WHERE id = ?",
      hold.id,
    );
    db.prepare(
      `INSERT INTO bookings (
        id, slot_id, hold_id, confirmed_at, payment_ref, amount_minor, currency, amount_sats,
        payment_method, player_id, member_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      bookingId,
      hold.slot_id,
      hold.id,
      event.settledAt,
      event.invoiceId,
      hold.amount_minor,
      hold.currency,
      hold.amount_sats,
      holdMeta?.payment_method ?? "lightning",
      holdMeta?.player_id ?? null,
      holdMeta?.player_id ? linkedMemberId(db, holdMeta.player_id, now) : null,
    );
    const booked = db
      .prepare("UPDATE slots SET status = 'booked' WHERE id = ? AND status = 'held'")
      .run(hold.slot_id);
    if (booked.changes !== 1) throw new Error("slot changed while confirming payment");
    return { outcome: "confirmed", bookingId };
  });
}

function expireByInvoice(db: Database.Database, invoiceId: string): PaymentApplyResult {
  return immediate(db, () => {
    const hold = one<{ id: string; slot_id: string; status: string }>(
      db,
      "SELECT id, slot_id, status FROM holds WHERE invoice_id = ?",
      invoiceId,
    );
    if (!hold) return { outcome: "unknown", bookingId: null };
    if (hold.status !== "pending") return { outcome: "ignored", bookingId: null };
    db.prepare("UPDATE holds SET status = 'expired' WHERE id = ? AND status = 'pending'").run(hold.id);
    db.prepare("UPDATE slots SET status = 'open' WHERE id = ? AND status = 'held'").run(hold.slot_id);
    return { outcome: "expired", bookingId: null };
  });
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

type Charge = {
  invoiceId: string;
  paymentHash: string | null;
  bolt11: string;
  amountSats: number | null;
  expiresAt: string;
  checkoutUrl: string | null;
};

async function createCharge(
  config: AppConfig,
  payments: PaymentBackend,
  cards: CardSet | null,
  method: "lightning" | "stripe" | "square",
  input: {
    orderId: string;
    amountMinor: number;
    currency: string;
    currencyDecimals: number;
    memo: string;
    expirySeconds: number;
    nowIso: string;
    webhookUrl: string | null;
  },
): Promise<Charge> {
  switch (method) {
    case "lightning": {
      const invoice = await payments.createInvoice(input);
      return { ...invoice, checkoutUrl: null };
    }
    case "stripe":
    case "square": {
      const provider = cards?.get(method);
      if (!provider) throw new AppError(400, "That payment method is not enabled");
      const checkout = await provider.createCheckout(input);
      return {
        invoiceId: checkout.invoiceId,
        paymentHash: null,
        bolt11: `card:${method}:${checkout.invoiceId}`,
        amountSats: null,
        expiresAt: checkout.expiresAt,
        checkoutUrl: checkout.checkoutUrl,
      };
    }
    default: {
      const unknown: never = method;
      throw new AppError(400, `Unknown payment method ${String(unknown)}`);
    }
  }
}

function paymentMethodOf(value: string | null): "lightning" | "stripe" | "square" {
  switch (value) {
    case "stripe":
    case "square":
    case "lightning":
      return value;
    default:
      return "lightning";
  }
}

function linkedMemberId(db: Database.Database, playerId: string, now: Date): string | null {
  return attachPlayerMember(db, playerId, now);
}
