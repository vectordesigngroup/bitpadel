// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "../errors.js";
import { minorToSats } from "../money.js";
import { safeEqual } from "../security.js";
import { isRecord } from "../validate.js";
import type { LnbitsConfig } from "../config.js";
import { requestJson } from "./http.js";
import type {
  BackendHealth,
  InvoiceCreated,
  InvoiceRequest,
  PaymentBackend,
  RefundRequest,
  RefundResult,
  WebhookInput,
  WebhookInterpretation,
} from "./types.js";

export class LnbitsPaymentBackend implements PaymentBackend {
  readonly name = "lnbits" as const;

  constructor(
    private readonly config: LnbitsConfig,
    private readonly satsPerMinorUnit: number,
  ) {}

  async createInvoice(input: InvoiceRequest): Promise<InvoiceCreated> {
    if (!input.webhookUrl) throw new AppError(500, "LNbits webhook URL is not configured");
    const amount = minorToSats(input.amountMinor, this.satsPerMinorUnit);
    const created = await requestJson(`${this.config.url}/api/v1/payments`, {
      method: "POST",
      headers: { "x-api-key": this.config.invoiceKey },
      body: {
        out: false,
        amount,
        memo: input.memo,
        webhook: input.webhookUrl,
      },
    });
    if (!isRecord(created)) throw new AppError(502, "LNbits invoice response was not an object");
    const paymentHash = stringField(created, "payment_hash");
    const bolt11 = stringField(created, "payment_request");
    if (!paymentHash || !bolt11) {
      throw new AppError(502, "LNbits did not return a payment hash and invoice");
    }
    return {
      invoiceId: paymentHash,
      paymentHash,
      bolt11,
      amountSats: amount,
      expiresAt: new Date(Date.parse(input.nowIso) + input.expirySeconds * 1000).toISOString(),
    };
  }

  async interpretWebhook(input: WebhookInput): Promise<WebhookInterpretation> {
    if (!input.pathSecret || !safeEqual(input.pathSecret, this.config.webhookSecret)) {
      throw new AppError(401, "Invalid LNbits webhook secret");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      throw new AppError(400, "Invalid JSON");
    }
    if (!isRecord(parsed)) return { kind: "ignore" };
    const paymentHash = stringField(parsed, "payment_hash");
    if (!paymentHash) return { kind: "ignore" };
    if (!lnbitsSettled(parsed)) return { kind: "ignore" };
    return {
      kind: "settled",
      invoiceId: paymentHash,
      paymentHash,
      settledAt: input.nowIso,
    };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    if (!input.bolt11) {
      return {
        supported: false,
        reason: "Not supported by this backend without a customer BOLT11. LNbits cannot reverse an invoice in place.",
      };
    }
    const created = await requestJson(`${this.config.url}/api/v1/payments`, {
      method: "POST",
      headers: { "x-api-key": this.config.invoiceKey },
      body: { out: true, bolt11: input.bolt11 },
    });
    const paymentHash = isRecord(created) ? stringField(created, "payment_hash") : "";
    return {
      supported: true,
      refundId: paymentHash || `lnbits_${input.invoiceId}`,
      status: "submitted",
    };
  }

  async health(): Promise<BackendHealth> {
    try {
      const body = await requestJson(`${this.config.url}/api/v1/wallet`, {
        method: "GET",
        headers: { "x-api-key": this.config.invoiceKey },
      });
      return {
        ok: true,
        detail: "LNbits wallet responded",
        balanceSats: walletSats(body),
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "LNbits wallet check failed",
        balanceSats: null,
      };
    }
  }
}

function lnbitsSettled(body: Record<string, unknown>): boolean {
  if (body.pending === true || body.paid === false) return false;
  const status = typeof body.status === "string" ? body.status.toLowerCase() : "";
  if (status === "pending" || status === "expired" || status === "failed") return false;
  return true;
}

function walletSats(body: unknown): number | null {
  if (!isRecord(body) || typeof body.balance !== "number" || !Number.isFinite(body.balance)) return null;
  return Math.floor(body.balance / 1000);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
