// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { immediate, one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import type { CardSet } from "../payments/cards/index.js";
import type { PaymentBackend } from "../payments/types.js";

export async function cancelPlayerBooking(
  db: Database.Database,
  config: AppConfig,
  payments: PaymentBackend,
  cards: CardSet,
  playerId: string,
  bookingId: string,
  now: Date,
  /** Lightning invoice from the player's wallet for the refund. Needed by LNbits. */
  refundBolt11: string | null = null,
): Promise<{ cancelled: true; refundStatus: string | null }> {
  if (config.cancelWindowHours <= 0) throw new AppError(403, "Self-cancel is turned off");
  const row = one<{
    id: string;
    slot_id: string;
    hold_id: string;
    confirmed_at: string;
    payment_ref: string;
    payment_method: string;
    amount_minor: number;
    currency: string;
    amount_sats: number | null;
    player_id: string | null;
    starts_at: string;
    invoice_id: string;
    payment_hash: string | null;
    bolt11: string | null;
  }>(
    db,
    `SELECT b.id, b.slot_id, b.hold_id, b.confirmed_at, b.payment_ref, b.payment_method,
            b.amount_minor, b.currency, b.amount_sats, b.player_id, s.starts_at,
            h.invoice_id, h.payment_hash, h.bolt11
     FROM bookings b
     JOIN slots s ON s.id = b.slot_id
     JOIN holds h ON h.id = b.hold_id
     WHERE b.id = ?`,
    bookingId,
  );
  if (!row || row.player_id !== playerId) throw new AppError(404, "Booking was not found");
  const deadline = Date.parse(row.starts_at) - config.cancelWindowHours * 3_600_000;
  if (now.getTime() > deadline) throw new AppError(409, "The cancellation window has closed.");
  let refundStatus: string | null = null;
  if (config.cancelRefund === "full") {
    const refunded = await refundCharge(payments, cards, { ...row, bolt11: refundBolt11 }, "Player cancelled inside the window");
    if (!refunded.supported) throw new AppError(409, refunded.reason);
    db.prepare(
      `INSERT INTO refunds (
         id, booking_id, invoice_id, amount_minor, currency, status, provider_refund_id, reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId("rfd"),
      row.id,
      row.invoice_id,
      row.amount_minor,
      row.currency,
      refunded.status,
      refunded.refundId,
      "Player cancelled inside the window",
      now.toISOString(),
    );
    refundStatus = refunded.status;
  }
  immediate(db, () => {
    db.prepare(
      `INSERT INTO cancelled_bookings (
         id, slot_id, hold_id, confirmed_at, cancelled_at, payment_ref, payment_method,
         amount_minor, currency, amount_sats, player_id, reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.slot_id,
      row.hold_id,
      row.confirmed_at,
      now.toISOString(),
      row.payment_ref,
      row.payment_method,
      row.amount_minor,
      row.currency,
      row.amount_sats,
      row.player_id,
      "player-cancel",
    );
    db.prepare("DELETE FROM bookings WHERE id = ?").run(row.id);
    db.prepare("UPDATE slots SET status = 'open' WHERE id = ? AND status = 'booked'").run(row.slot_id);
  });
  return { cancelled: true, refundStatus };
}

export async function refundCharge(
  payments: PaymentBackend,
  cards: CardSet,
  row: {
    payment_method: string;
    invoice_id: string;
    amount_minor: number;
    currency: string;
    payment_hash: string | null;
    /** Customer invoice to pay the refund to. Never the club's own (already paid) invoice. */
    bolt11: string | null;
    amount_sats?: number | null;
  },
  reason: string,
): Promise<{ supported: true; refundId: string; status: "recorded" | "submitted" } | { supported: false; reason: string }> {
  const method = row.payment_method || "lightning";
  switch (method) {
    case "lightning":
      return payments.refund({
        invoiceId: row.invoice_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        reason,
        bolt11: row.bolt11,
        paidSats: row.amount_sats ?? null,
      });
    case "stripe":
    case "square": {
      const provider = cards.get(method);
      if (!provider) return { supported: false, reason: "Not supported by this backend because that card provider is off." };
      return provider.refund({
        invoiceId: row.invoice_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        reason,
        bolt11: null,
        providerPaymentId: row.payment_hash,
      });
    }
    default:
      return { supported: false, reason: "Not supported by this backend." };
  }
}
