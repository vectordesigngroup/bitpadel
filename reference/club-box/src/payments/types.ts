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

export interface PaymentBackend {
  readonly name: PaymentBackendName;
  createInvoice(input: InvoiceRequest): Promise<InvoiceCreated>;
  interpretWebhook(input: WebhookInput): Promise<WebhookInterpretation>;
}
