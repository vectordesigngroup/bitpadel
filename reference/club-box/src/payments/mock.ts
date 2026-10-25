// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { randomBytes } from "node:crypto";
import { AppError } from "../errors.js";
import { minorToSats } from "../money.js";
import type { AppConfig } from "../config.js";
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

/**
 * Local stand-in. Invoice strings are not BOLT11 and cannot be paid on Lightning.
 * Settlement is an explicit admin action, not a webhook.
 */
export class MockPaymentBackend implements PaymentBackend {
  readonly name = "mock" as const;

  constructor(private readonly config: AppConfig) {}

  async createInvoice(input: InvoiceRequest): Promise<InvoiceCreated> {
    const invoiceId = `mock_${randomBytes(16).toString("hex")}`;
    const paymentHash = randomBytes(32).toString("hex");
    const amountSats =
      this.config.satsPerMinorUnit == null
        ? null
        : minorToSats(input.amountMinor, this.config.satsPerMinorUnit);
    const expiresAt = new Date(Date.parse(input.nowIso) + input.expirySeconds * 1000).toISOString();
    return {
      invoiceId,
      paymentHash,
      bolt11: `mock-not-payable:${invoiceId}`,
      amountSats,
      expiresAt,
    };
  }

  async interpretWebhook(_input: WebhookInput): Promise<WebhookInterpretation> {
    throw new AppError(404, "The mock backend does not accept payment webhooks");
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    return {
      supported: true,
      refundId: `mock_refund_${randomBytes(8).toString("hex")}_${input.invoiceId}`,
      status: "recorded",
    };
  }

  async health(): Promise<BackendHealth> {
    return { ok: true, detail: "Mock backend does not hold a Lightning balance", balanceSats: null };
  }
}
