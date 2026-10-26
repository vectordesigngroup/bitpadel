// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { applyPaymentEvent, type PaymentApplyResult } from "../booking/service.js";
import { immediate, one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import type { CardSet } from "../payments/cards/index.js";
import type { PaymentBackend, WebhookInterpretation } from "../payments/types.js";
import {
  appendSettlementEntry,
  expireDueTabSettlements,
  sumPending,
  sumTab,
} from "./service.js";

export type PayMethod = "lightning" | "stripe" | "square";

export type SettlementView = {
  id: string;
  memberId: string;
  status: "pending" | "paid" | "expired";
  paymentMethod: PayMethod;
  amountMinor: number;
  currency: string;
  amountSats: number | null;
  bolt11: string;
  checkoutUrl: string | null;
  payable: boolean;
  expiresAt: string;
  paidAt: string | null;
};

export type IncomingPaymentResult = PaymentApplyResult & { settlementId: string | null };

type TabPayOutcome =
  | { outcome: "paid"; settlementId: string }
  | { outcome: "already-paid"; settlementId: string }
  | { outcome: "expired"; settlementId: string }
  | { outcome: "ignored"; settlementId: string | null }
  | { outcome: "unknown"; settlementId: null };

type SettlementRow = {
  id: string;
  member_id: string;
  invoice_id: string;
  payment_hash: string | null;
  payment_method: string;
  status: string;
  amount_minor: number;
  currency: string;
  amount_sats: number | null;
  bolt11: string;
  checkout_url: string | null;
  expires_at: string;
  paid_at: string | null;
};

/**
 * Court holds are applied first. An invoice that is not a hold is tried as a tab payment.
 * A second notice for the same invoice does not write a second ledger line.
 */
export function applyIncomingPayment(
  db: Database.Database,
  event: WebhookInterpretation,
  now: Date,
): IncomingPaymentResult {
  const booking = applyPaymentEvent(db, event, now);
  if (booking.outcome !== "unknown") return { ...booking, settlementId: null };
  const tab = applyTabPayment(db, event, now);
  switch (tab.outcome) {
    case "unknown":
      return { outcome: "unknown", bookingId: null, settlementId: null };
    case "paid":
      return { outcome: "confirmed", bookingId: null, settlementId: tab.settlementId };
    case "already-paid":
      return { outcome: "already-confirmed", bookingId: null, settlementId: tab.settlementId };
    case "expired":
      return { outcome: "expired", bookingId: null, settlementId: tab.settlementId };
    case "ignored":
      return { outcome: "ignored", bookingId: null, settlementId: tab.settlementId };
    default: {
      const unknown: never = tab;
      throw new Error(`Unhandled tab payment: ${String(unknown)}`);
    }
  }
}

export async function openTabSettlement(
  db: Database.Database,
  config: AppConfig,
  payments: PaymentBackend,
  cards: CardSet,
  input: { memberId: string; method: PayMethod; amountMinor: number | null; now: Date },
): Promise<SettlementView> {
  const member = one<{ id: string }>(db, "SELECT id FROM members WHERE id = ?", input.memberId);
  if (!member) throw new AppError(404, "Membership was not found");
  const reserved = reserveSettlement(db, config, input);
  try {
    const invoice = await createCharge(config, payments, cards, input.method, {
      orderId: reserved.id,
      amountMinor: reserved.amountMinor,
      currency: config.currency,
      currencyDecimals: config.currencyDecimals,
      memo: "Tab",
      expirySeconds: config.holdMinutes * 60,
      nowIso: input.now.toISOString(),
      webhookUrl: input.method === "lightning" ? lnbitsWebhook(config) : config.publicBaseUrl,
    });
    const holdExpiry = new Date(input.now.getTime() + config.holdMinutes * 60_000).toISOString();
    const expiresAt = invoice.expiresAt < holdExpiry ? invoice.expiresAt : holdExpiry;
    db.prepare(
      `UPDATE tab_settlements
       SET invoice_id = ?, payment_hash = ?, amount_sats = ?, bolt11 = ?, checkout_url = ?, expires_at = ?
       WHERE id = ?`,
    ).run(
      invoice.invoiceId,
      invoice.paymentHash,
      invoice.amountSats,
      invoice.bolt11,
      invoice.checkoutUrl,
      expiresAt,
      reserved.id,
    );
  } catch (error) {
    db.prepare("UPDATE tab_settlements SET status = 'expired' WHERE id = ? AND status = 'pending'").run(reserved.id);
    throw error;
  }
  const view = settlementById(db, reserved.id);
  if (!view) throw new Error("tab settlement missing after it was created");
  return view;
}

export function settlementById(db: Database.Database, id: string): SettlementView | null {
  const row = one<SettlementRow>(
    db,
    `SELECT id, member_id, invoice_id, payment_hash, payment_method, status, amount_minor, currency,
            amount_sats, bolt11, checkout_url, expires_at, paid_at
     FROM tab_settlements WHERE id = ?`,
    id,
  );
  if (!row) return null;
  return toView(row);
}

export function settlementForMember(db: Database.Database, id: string, memberId: string): SettlementView | null {
  const view = settlementById(db, id);
  if (!view || view.memberId !== memberId) return null;
  return view;
}

function reserveSettlement(
  db: Database.Database,
  config: AppConfig,
  input: { memberId: string; method: PayMethod; amountMinor: number | null; now: Date },
): { id: string; amountMinor: number } {
  return immediate(db, () => {
    expireDueTabSettlements(db, input.now);
    const open = sumTab(db, input.memberId);
    const pending = sumPending(db, input.memberId);
    const available = open - pending;
    if (available < 1) throw new AppError(400, "Nothing is owed on the tab");
    const amount = input.amountMinor ?? available;
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new AppError(400, "amountMinor must be a positive integer");
    }
    if (amount > available) {
      throw new AppError(400, "That is more than the open tab minus payments already waiting");
    }
    const id = newId("tabpay");
    const nowIso = input.now.toISOString();
    const expiresAt = new Date(input.now.getTime() + config.holdMinutes * 60_000).toISOString();
    db.prepare(
      `INSERT INTO tab_settlements (
         id, member_id, invoice_id, payment_hash, payment_method, status, amount_minor, currency,
         amount_sats, bolt11, checkout_url, expires_at, created_at, paid_at
       ) VALUES (?, ?, ?, NULL, ?, 'pending', ?, ?, NULL, 'pending', NULL, ?, ?, NULL)`,
    ).run(id, input.memberId, `pending:${id}`, input.method, amount, config.currency, expiresAt, nowIso);
    return { id, amountMinor: amount };
  });
}

function applyTabPayment(db: Database.Database, event: WebhookInterpretation, now: Date): TabPayOutcome {
  switch (event.kind) {
    case "ignore":
      return { outcome: "ignored", settlementId: null };
    case "expired":
      return expireTabInvoice(db, event.invoiceId);
    case "settled":
      return payTabInvoice(db, event, now);
    default: {
      const unknown: never = event;
      throw new Error(`Unhandled payment event: ${String(unknown)}`);
    }
  }
}

function expireTabInvoice(db: Database.Database, invoiceId: string): TabPayOutcome {
  if (invoiceId.startsWith("pending:")) return { outcome: "unknown", settlementId: null };
  return immediate(db, () => {
    const row = byInvoice(db, invoiceId);
    if (!row) return { outcome: "unknown" as const, settlementId: null };
    if (row.status !== "pending") return { outcome: "ignored" as const, settlementId: row.id };
    db.prepare("UPDATE tab_settlements SET status = 'expired' WHERE id = ? AND status = 'pending'").run(row.id);
    return { outcome: "expired" as const, settlementId: row.id };
  });
}

/**
 * A settled tab invoice reduces what the member owes, including when the local row
 * was already marked expired. The debt was not given to someone else, unlike a court slot.
 */
function payTabInvoice(
  db: Database.Database,
  event: { invoiceId: string; paymentHash: string | null; settledAt: string },
  now: Date,
): TabPayOutcome {
  if (event.invoiceId.startsWith("pending:")) return { outcome: "unknown", settlementId: null };
  return immediate(db, () => {
    const row = byInvoice(db, event.invoiceId);
    if (!row) return { outcome: "unknown" as const, settlementId: null };
    const already = one<{ id: string }>(db, "SELECT id FROM ledger_entries WHERE settlement_id = ?", row.id);
    if (row.status === "paid" || already) return { outcome: "already-paid" as const, settlementId: row.id };
    const at = event.settledAt || now.toISOString();
    appendSettlementEntry(db, {
      settlementId: row.id,
      memberId: row.member_id,
      amountMinor: row.amount_minor,
      amountSats: row.amount_sats,
      currency: row.currency,
      at,
    });
    db.prepare(
      `UPDATE tab_settlements
       SET status = 'paid', paid_at = ?, payment_hash = COALESCE(?, payment_hash)
       WHERE id = ? AND status IN ('pending', 'expired')`,
    ).run(at, event.paymentHash, row.id);
    return { outcome: "paid" as const, settlementId: row.id };
  });
}

function byInvoice(db: Database.Database, invoiceId: string): SettlementRow | undefined {
  return one<SettlementRow>(
    db,
    `SELECT id, member_id, invoice_id, payment_hash, payment_method, status, amount_minor, currency,
            amount_sats, bolt11, checkout_url, expires_at, paid_at
     FROM tab_settlements WHERE invoice_id = ?`,
    invoiceId,
  );
}

function toView(row: SettlementRow): SettlementView {
  const status = statusOf(row.status);
  const paymentMethod = methodOf(row.payment_method);
  return {
    id: row.id,
    memberId: row.member_id,
    status,
    paymentMethod,
    amountMinor: row.amount_minor,
    currency: row.currency,
    amountSats: row.amount_sats,
    bolt11: row.bolt11,
    checkoutUrl: row.checkout_url,
    payable: paymentMethod === "lightning" && status === "pending" && !row.bolt11.startsWith("mock-not-payable:") && row.bolt11 !== "pending",
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
  };
}

function statusOf(value: string): SettlementView["status"] {
  switch (value) {
    case "pending":
    case "paid":
    case "expired":
      return value;
    default:
      throw new Error(`Unknown settlement status: ${value}`);
  }
}

function methodOf(value: string): PayMethod {
  switch (value) {
    case "lightning":
    case "stripe":
    case "square":
      return value;
    default:
      throw new Error(`Unknown payment method: ${value}`);
  }
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
  cards: CardSet,
  method: PayMethod,
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
      const provider = cards.get(method);
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

function lnbitsWebhook(config: AppConfig): string | null {
  if (config.paymentBackend !== "lnbits" || !config.lnbits) return null;
  return `${config.publicBaseUrl}/api/webhooks/lnbits/${config.lnbits.webhookSecret}`;
}
