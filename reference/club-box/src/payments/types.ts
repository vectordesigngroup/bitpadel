// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { IncomingHttpHeaders } from "node:http";

export type PaymentBackendName = "mock" | "btcpay" | "lnbits";

export type InvoiceRequest = {
  orderId: string;
  amountMinor: number;
  currency: string;
  currencyDecimals: number;
  memo: string;
  expirySeconds: number;
  nowIso: string;
  webhookUrl: string | null;
};

export type InvoiceCreated = {
  invoiceId: string;
  paymentHash: string | null;
  bolt11: string;
  amountSats: number | null;
  expiresAt: string;
};

export type WebhookInterpretation =
  | { kind: "settled"; invoiceId: string; paymentHash: string | null; settledAt: string }
  | { kind: "expired"; invoiceId: string }
  | { kind: "ignore" };

export type WebhookInput = {
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  nowIso: string;
  pathSecret?: string;
};

export type RefundRequest = {
  invoiceId: string;
  amountMinor: number | null;
  currency: string;
  reason: string;
  /** Required only when the backend pays a customer invoice instead of reversing one. */
  bolt11: string | null;
  /** Stripe payment intent or Square payment id, when the webhook has stored one. */
  providerPaymentId?: string | null;
};

export type RefundResult =
  | { supported: true; refundId: string; status: "recorded" | "submitted" }
  | { supported: false; reason: string };

export type BackendHealth = {
  ok: boolean;
  detail: string;
  balanceSats: number | null;
};

export interface PaymentBackend {
  readonly name: PaymentBackendName;
  createInvoice(input: InvoiceRequest): Promise<InvoiceCreated>;
  interpretWebhook(input: WebhookInput): Promise<WebhookInterpretation>;
  refund(input: RefundRequest): Promise<RefundResult>;
  health(): Promise<BackendHealth>;
}
