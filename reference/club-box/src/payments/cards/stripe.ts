// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { createHmac } from "node:crypto";
import { PaymentError } from "../../errors.js";
import { safeEqual } from "../../security.js";
import type { BackendHealth, InvoiceRequest, RefundRequest, RefundResult, WebhookInput, WebhookInterpretation } from "../types.js";
import type { CardCheckout, CardProvider, FetchLike } from "./types.js";

type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  apiBase: string;
};

export class StripeCardProvider implements CardProvider {
  readonly name = "stripe" as const;

  constructor(
    private readonly config: StripeConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async createCheckout(input: InvoiceRequest): Promise<CardCheckout> {
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("client_reference_id", input.orderId);
    body.set("success_url", successUrl(input.webhookUrl));
    body.set("cancel_url", cancelUrl(input.webhookUrl));
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
    body.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
    body.set("line_items[0][price_data][product_data][name]", input.memo.slice(0, 200));
    const payload = await this.form("/v1/checkout/sessions", body);
    const session = asRecord(payload);
    const id = stringField(session, "id");
    const url = stringField(session, "url");
    if (!id || !url) throw new PaymentError("Stripe did not return a checkout session");
    const expires = new Date(Date.parse(input.nowIso) + input.expirySeconds * 1000).toISOString();
    return { invoiceId: id, checkoutUrl: url, expiresAt: expires };
  }

  async interpretWebhook(input: WebhookInput): Promise<WebhookInterpretation> {
    if (!verifyStripeSignature(input.rawBody, headerOne(input.headers["stripe-signature"]), this.config.webhookSecret)) {
      throw new PaymentError("Invalid Stripe webhook signature");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      throw new PaymentError("Stripe webhook was not JSON");
    }
    const event = asRecord(parsed);
    const type = stringField(event, "type");
    const data = asRecord(event.data);
    const object = asRecord(data.object);
    if (type !== "checkout.session.completed") return { kind: "ignore" };
    if (stringField(object, "payment_status") !== "paid") return { kind: "ignore" };
    const invoiceId = stringField(object, "id");
    if (!invoiceId) throw new PaymentError("Stripe webhook is missing the session id");
    const intent = stringField(object, "payment_intent");
    return {
      kind: "settled",
      invoiceId,
      paymentHash: intent,
      settledAt: input.nowIso,
    };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    const paymentIntent = input.providerPaymentId ?? null;
    if (!paymentIntent) {
      return {
        supported: false,
        reason: "Not supported by this backend until the Stripe webhook stores the payment intent.",
      };
    }
    const body = new URLSearchParams();
    body.set("payment_intent", paymentIntent);
    if (input.amountMinor != null) body.set("amount", String(input.amountMinor));
    if (input.reason) body.set("metadata[reason]", input.reason.slice(0, 200));
    const payload = await this.form("/v1/refunds", body);
    const refund = asRecord(payload);
    const id = stringField(refund, "id");
    if (!id) throw new PaymentError("Stripe did not return a refund id");
    return { supported: true, refundId: id, status: "submitted" };
  }

  async health(): Promise<BackendHealth> {
    try {
      await this.request("/v1/balance", { method: "GET" });
      return { ok: true, detail: "Stripe responded", balanceSats: null };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Stripe did not respond";
      return { ok: false, detail, balanceSats: null };
    }
  }

  private async form(path: string, body: URLSearchParams): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  private async request(path: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiBase}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.config.secretKey}`,
          accept: "application/json",
          ...init.headers,
        },
        body: init.body,
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

/** Signed events further than this many seconds from now are rejected. */
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!header) return false;
  const parts = new Map<string, string[]>();
  for (const piece of header.split(",")) {
    const separator = piece.indexOf("=");
    if (separator < 0) continue;
    const key = piece.slice(0, separator).trim();
    const value = piece.slice(separator + 1).trim();
    const list = parts.get(key) ?? [];
    list.push(value);
    parts.set(key, list);
  }
  const timestamp = parts.get("t")?.[0];
  const signatures = parts.get("v1") ?? [];
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  let matched = false;
  for (const signature of signatures) {
    if (safeEqual(signature, expected)) matched = true;
  }
  if (!matched) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || !Number.isFinite(nowMs)) return false;
  const nowSeconds = Math.floor(nowMs / 1000);
  return Math.abs(nowSeconds - timestampSeconds) <= STRIPE_SIGNATURE_TOLERANCE_SECONDS;
}

function successUrl(webhookUrl: string | null): string {
  if (!webhookUrl) return "https://example.invalid/paid";
  try {
    const url = new URL(webhookUrl);
    url.pathname = "/";
    url.search = "paid=1";
    return url.toString();
  } catch {
    return "https://example.invalid/paid";
  }
}

function cancelUrl(webhookUrl: string | null): string {
  if (!webhookUrl) return "https://example.invalid/";
  try {
    const url = new URL(webhookUrl);
    url.pathname = "/";
    url.search = "";
    return url.toString();
  } catch {
    return "https://example.invalid/";
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
