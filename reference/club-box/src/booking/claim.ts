import type Database from "better-sqlite3";
import { immediate, isUniqueError, one } from "../db.js";

export type ClaimInput = {
  slotId: string;
  holdId: string;
  invoiceId: string;
  paymentHash: string | null;
  bolt11: string;
  amountSats: number | null;
  amountMinor: number;
  currency: string;
  expiresAt: string;
  nowIso: string;
};

export type ClaimResult =
  | { ok: true; holdId: string }
  | { ok: false; reason: "unavailable" | "price-changed" | "blocked" };

type SlotLock = {
  status: string;
  price_minor: number;
  currency: string;
  court_id: string;
  starts_at: string;
  ends_at: string;
};

/**
 * Mark one open slot held and insert its pending hold.
 * `BEGIN IMMEDIATE` plus the conditional update is what stops two players
 * from booking the same court time. The partial unique index is the backup.
 */
export function claimOpenSlot(db: Database.Database, input: ClaimInput): ClaimResult {
  try {
    return immediate(db, () => {
      const slot = one<SlotLock>(
        db,
        "SELECT status, price_minor, currency, court_id, starts_at, ends_at FROM slots WHERE id = ?",
        input.slotId,
      );
      if (!slot || slot.status !== "open") return { ok: false, reason: "unavailable" };
      if (slot.price_minor !== input.amountMinor || slot.currency !== input.currency) {
        return { ok: false, reason: "price-changed" };
      }
      const imported = one<{ id: string }>(
        db,
        `SELECT id FROM external_bookings
         WHERE court_id = ? AND status = 'active' AND starts_at < ? AND ends_at > ?
         LIMIT 1`,
        slot.court_id,
        slot.ends_at,
        slot.starts_at,
      );
      if (imported) return { ok: false, reason: "blocked" };
      const updated = db
        .prepare("UPDATE slots SET status = 'held' WHERE id = ? AND status = 'open'")
        .run(input.slotId);
      if (updated.changes !== 1) return { ok: false, reason: "unavailable" };
      db.prepare(
        `INSERT INTO holds (
          id, slot_id, status, invoice_id, payment_hash, bolt11, amount_sats,
          amount_minor, currency, expires_at, created_at
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.holdId,
        input.slotId,
        input.invoiceId,
        input.paymentHash,
        input.bolt11,
        input.amountSats,
        input.amountMinor,
        input.currency,
        input.expiresAt,
        input.nowIso,
      );
      return { ok: true, holdId: input.holdId };
    });
  } catch (error) {
    if (isUniqueError(error)) return { ok: false, reason: "unavailable" };
    throw error;
  }
}
