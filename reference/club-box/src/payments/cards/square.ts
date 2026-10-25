import { createHmac } from "node:crypto";
import { PaymentError } from "../../errors.js";
import { safeEqual } from "../../security.js";
import type { BackendHealth, InvoiceRequest, RefundRequest, RefundResult, WebhookInput, WebhookInterpretation } from "../types.js";
import type { CardCheckout, CardProvider, FetchLike } from "./types.js";

type SquareConfig = {
  accessToken: string;
  locationId: string;
  webhookSignatureKey: string;
  apiBase: string;
  webhookUrl: string;
};

/**
 * Square online checkout is card, wallet, Afterpay, and Cash App.
 * Bitcoin on Square is a POS feature. This provider does not request it.
 */
export class SquareCardProvider implements CardProvider {
  readonly name = "square" as const;

  constructor(
    private readonly config: SquareConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async createCheckout(input: InvoiceRequest): Promise<CardCheckout> {
    const payload = await this.request("/v2/online-checkout/payment-links", {
      method: "POST",
      body: {
        idempotency_key: input.orderId.slice(0, 45),
        quick_pay: {
          name: input.memo.slice(0, 255),
          price_money: { amount: input.amountMinor, currency: input.currency },
          location_id: this.config.locationId,
        },
        checkout_options: { redirect_url: redirectUrl(input.webhookUrl) },
        payment_note: input.orderId.slice(0, 500),
      },
    });
    const link = asRecord(asRecord(payload).payment_link);
    const orderId = stringField(link, "order_id");
    const url = stringField(link, "url") ?? stringField(link, "long_url");
    if (!orderId || !url) throw new PaymentError("Square did not return a payment link");
    const expires = new Date(Date.parse(input.nowIso) + input.expirySeconds * 1000).toISOString();
    return { invoiceId: orderId, checkoutUrl: url, expiresAt: expires };
  }

  async interpretWebhook(input: WebhookInput): Promise<WebhookInterpretation> {
    const signature = headerOne(input.headers["x-square-hmacsha256-signature"]);
    if (!verifySquareSignature(input.rawBody, signature, this.config.webhookSignatureKey, this.config.webhookUrl)) {
      throw new PaymentError("Invalid Square webhook signature");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      throw new PaymentError("Square webhook was not JSON");
    }
    const event = asRecord(parsed);
    const type = stringField(event, "type");
    if (type !== "payment.updated" && type !== "payment.created") return { kind: "ignore" };
    const data = asRecord(event.data);
    const object = asRecord(data.object);
    const payment = asRecord(object.payment ?? object);
    if (stringField(payment, "status") !== "COMPLETED") return { kind: "ignore" };
    const invoiceId = stringField(payment, "order_id");
    const paymentId = stringField(payment, "id");
    if (!invoiceId || !paymentId) throw new PaymentError("Square webhook is missing the order or payment id");
    return { kind: "settled", invoiceId, paymentHash: paymentId, settledAt: input.nowIso };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    const paymentId = input.providerPaymentId ?? null;
    if (!paymentId) {
      return {
        supported: false,
        reason: "Not supported by this backend until the Square webhook stores the payment id.",
      };
    }
    const payload = await this.request("/v2/refunds", {
      method: "POST",
      body: {
        idempotency_key: `refund-${paymentId}`.slice(0, 45),
        payment_id: paymentId,
        amount_money: { amount: input.amountMinor ?? 0, currency: input.currency },
        reason: input.reason.slice(0, 192),
      },
    });
    const refund = asRecord(asRecord(payload).refund);
    const id = stringField(refund, "id");
    if (!id) throw new PaymentError("Square did not return a refund id");
    return { supported: true, refundId: id, status: "submitted" };
  }

  async health(): Promise<BackendHealth> {
    try {
      await this.request("/v2/locations", { method: "GET" });
      return { ok: true, detail: "Square responded", balanceSats: null };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Square did not respond";
      return { ok: false, detail, balanceSats: null };
    }
  }

  private async request(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiBase}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PaymentError("Payment backend did not respond");
    }
    const text = await response.text();
    if (!response.ok) throw new PaymentError(`Payment backend returned HTTP ${response.status}`);
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PaymentError("Payment backend returned invalid JSON");
    }
  }
}

export function verifySquareSignature(
  rawBody: Buffer,
  header: string | undefined,
  signatureKey: string,
  notificationUrl: string,
): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", signatureKey).update(notificationUrl).update(rawBody).digest("base64");
  return safeEqual(header, expected);
}

function redirectUrl(webhookUrl: string | null): string {
  if (!webhookUrl) return "https://example.invalid/?paid=1";
  try {
    const url = new URL(webhookUrl);
    url.pathname = "/";
    url.search = "paid=1";
    return url.toString();
  } catch {
    return "https://example.invalid/?paid=1";
  }
}

function headerOne(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
