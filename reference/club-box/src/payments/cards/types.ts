import type { BackendHealth, InvoiceRequest, RefundRequest, RefundResult, WebhookInput, WebhookInterpretation } from "../types.js";

export type CardProviderName = "stripe" | "square";

export type CardCheckout = {
  invoiceId: string;
  checkoutUrl: string;
  expiresAt: string;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Card checkout beside the Lightning backend. A club enables zero or more. */
export interface CardProvider {
  readonly name: CardProviderName;
  createCheckout(input: InvoiceRequest): Promise<CardCheckout>;
  interpretWebhook(input: WebhookInput): Promise<WebhookInterpretation>;
  refund(input: RefundRequest): Promise<RefundResult>;
  health(): Promise<BackendHealth>;
}
