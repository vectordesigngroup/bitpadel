import { createHmac } from "node:crypto";
import { AppError } from "../errors.js";
import { btcStringToSats, minorToMajorString } from "../money.js";
import { safeEqual } from "../security.js";
import { isRecord } from "../validate.js";
import type { BtcpayConfig } from "../config.js";
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

const BOLT11 = /^(lnbc|lntb|lnbcrt|lnsb)/i;

export class BtcpayPaymentBackend implements PaymentBackend {
  readonly name = "btcpay" as const;

  constructor(private readonly config: BtcpayConfig) {}

  async createInvoice(input: InvoiceRequest): Promise<InvoiceCreated> {
    const store = encodeURIComponent(this.config.storeId);
    const created = await requestJson(`${this.config.url}/api/v1/stores/${store}/invoices`, {
      method: "POST",
      headers: { authorization: `token ${this.config.apiKey}` },
      body: {
        amount: minorToMajorString(input.amountMinor, input.currencyDecimals),
        currency: input.currency,
        metadata: { orderId: input.orderId },
        checkout: {
          speedPolicy: "HighSpeed",
          expirationMinutes: Math.max(1, Math.ceil(input.expirySeconds / 60)),
          paymentMethods: [this.config.paymentMethod],
        },
      },
    });
    if (!isRecord(created) || typeof created.id !== "string" || created.id.length === 0) {
      throw new AppError(502, "BTCPay invoice response did not include an id");
    }
    const invoiceId = created.id;
    const methods = await requestJson(
      `${this.config.url}/api/v1/stores/${store}/invoices/${encodeURIComponent(invoiceId)}/payment-methods`,
      {
        method: "GET",
        headers: { authorization: `token ${this.config.apiKey}` },
      },
    );
    const picked = pickLightning(methods);
    const expiration =
      typeof created.expirationTime === "number"
        ? new Date(created.expirationTime * 1000).toISOString()
        : new Date(Date.parse(input.nowIso) + input.expirySeconds * 1000).toISOString();
    return {
      invoiceId,
      paymentHash: null,
      bolt11: picked.bolt11,
      amountSats: picked.amountSats,
      expiresAt: expiration,
    };
  }

  async interpretWebhook(input: WebhookInput): Promise<WebhookInterpretation> {
    const signature = headerValue(input.headers, "btcpay-sig");
    if (!verifyBtcpaySignature(input.rawBody, signature, this.config.webhookSecret)) {
      throw new AppError(401, "Invalid BTCPay webhook signature");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      throw new AppError(400, "Invalid JSON");
    }
    if (!isRecord(parsed) || typeof parsed.invoiceId !== "string" || parsed.invoiceId.length === 0) {
      return { kind: "ignore" };
    }
    const type = typeof parsed.type === "string" ? parsed.type.replaceAll("_", "").toLowerCase() : "";
    if (type === "invoicesettled") {
      return {
        kind: "settled",
        invoiceId: parsed.invoiceId,
        paymentHash: null,
        settledAt: input.nowIso,
      };
    }
    if (type === "invoiceexpired" || type === "invoiceinvalid") {
      return { kind: "expired", invoiceId: parsed.invoiceId };
    }
    return { kind: "ignore" };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    const store = encodeURIComponent(this.config.storeId);
    const invoiceId = encodeURIComponent(input.invoiceId);
    const created = await requestJson(
      `${this.config.url}/api/v1/stores/${store}/invoices/${invoiceId}/refund`,
      {
        method: "POST",
        headers: { authorization: `token ${this.config.apiKey}` },
        body: {
          paymentMethod: this.config.paymentMethod,
          name: input.reason.slice(0, 80),
        },
      },
    );
    const refundId = isRecord(created) && typeof created.id === "string" ? created.id : `btcpay_${input.invoiceId}`;
    return { supported: true, refundId, status: "submitted" };
  }

  async health(): Promise<BackendHealth> {
    const store = encodeURIComponent(this.config.storeId);
    try {
      const body = await requestJson(
        `${this.config.url}/api/v1/stores/${store}/lightning/BTC/balance`,
        {
          method: "GET",
          headers: { authorization: `token ${this.config.apiKey}` },
        },
      );
      return {
        ok: true,
        detail: "BTCPay Lightning balance endpoint responded",
        balanceSats: balanceSats(body),
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "BTCPay balance check failed",
        balanceSats: null,
      };
    }
  }
}

export function verifyBtcpaySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const given = header.slice(prefix.length).trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(given)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, given);
}

function headerValue(
  headers: WebhookInput["headers"],
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function pickLightning(methods: unknown): { bolt11: string; amountSats: number | null } {
  if (!Array.isArray(methods)) {
    throw new AppError(502, "BTCPay did not return Lightning payment methods");
  }
  for (const method of methods) {
    if (!isRecord(method)) continue;
    const bolt11 = bolt11Of(method);
    if (!bolt11) continue;
    const amount = typeof method.amount === "string" ? btcStringToSats(method.amount) : null;
    return { bolt11, amountSats: amount };
  }
  throw new AppError(
    502,
    "BTCPay did not return a Lightning invoice. Enable Lightning on the store and check BTCPAY_PAYMENT_METHOD.",
  );
}

function bolt11Of(method: Record<string, unknown>): string | null {
  const destination = stringField(method, "destination");
  const link = stringField(method, "paymentLink").replace(/^lightning:/i, "");
  if (BOLT11.test(destination)) return destination;
  if (BOLT11.test(link)) return link;
  return null;
}

function balanceSats(body: unknown): number | null {
  if (!isRecord(body)) return null;
  if (typeof body.balance === "number" && Number.isFinite(body.balance)) return Math.floor(body.balance);
  if (typeof body.balance === "string" && /^\d+$/.test(body.balance)) return Number(body.balance);
  return null;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
