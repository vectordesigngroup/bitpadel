import { randomBytes } from "node:crypto";
import { AppError } from "../errors.js";
import { minorToSats } from "../money.js";
import type { AppConfig } from "../config.js";
import type { InvoiceCreated, InvoiceRequest, PaymentBackend, WebhookInput, WebhookInterpretation } from "./types.js";

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
}
