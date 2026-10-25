// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { PlaytomicConfig } from "../config.js";

export type PlaytomicParticipant = {
  participantId: string;
  email: string | null;
  name: string | null;
  acceptsCommercial: boolean;
  participantType: string;
};

export type PlaytomicBooking = {
  bookingId: string;
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  status: string;
  priceText: string | null;
  participants: PlaytomicParticipant[];
};

export type PlaytomicPayment = {
  clubPaymentId: string;
  paymentId: string | null;
  refundId: string | null;
  status: string | null;
  totalText: string | null;
  paymentDate: string | null;
  serviceDate: string | null;
  productSku: string | null;
};

type TokenCache = {
  value: string;
  expiresAtMs: number;
};

const TOKEN_PATH = "/api/v1/oauth/token";
const MAX_ATTEMPTS = 5;

/**
 * Read-only Playtomic Third Party API client.
 * The token request is the only POST. Bookings and payments are GET.
 */
export class PlaytomicClient {
  private token: TokenCache | null = null;
  private lastRequestMs = 0;

  constructor(
    private readonly config: PlaytomicConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listBookings(start: Date, end: Date): Promise<PlaytomicBooking[]> {
    const collected: PlaytomicBooking[] = [];
    const size = this.config.pageSize;
    for (let page = 0; page < 50; page += 1) {
      const body = await this.authorizedGet("/api/v1/bookings", {
        tenant_id: this.config.tenantId,
        start_booking_date: stamp(start, false),
        end_booking_date: stamp(end, false),
        page: String(page),
        size: String(size),
      });
      if (!Array.isArray(body)) throw new Error("Playtomic bookings response was not a list");
      const pageRows = body.flatMap((row) => {
        const parsed = parseBooking(row);
        return parsed ? [parsed] : [];
      });
      collected.push(...pageRows);
      if (body.length < size) break;
    }
    return collected;
  }

  async listPayments(start: Date, end: Date): Promise<PlaytomicPayment[]> {
    const collected: PlaytomicPayment[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const query: Record<string, string> = {
        tenant_id: this.config.tenantId,
        start_payment_date: stamp(start, true),
        end_payment_date: stamp(end, true),
        limit: "100",
      };
      if (cursor) query.cursor_id = cursor;
      const body = await this.authorizedGet("/api/v1/payments", query);
      if (!isRecord(body) || !Array.isArray(body.data)) {
        throw new Error("Playtomic payments response was not a page");
      }
      for (const row of body.data) {
        const parsed = parsePayment(row);
        if (parsed) collected.push(parsed);
      }
      const hasMore = body.has_more === true;
      const next = typeof body.next_cursor_id === "string" && body.next_cursor_id ? body.next_cursor_id : null;
      if (!hasMore || !next) break;
      cursor = next;
    }
    return collected;
  }

  private async authorizedGet(pathname: string, query: Record<string, string>): Promise<unknown> {
    const token = await this.bearer();
    const first = await this.request("GET", pathname, query, token);
    if (first.status !== 401) return first.json;
    this.token = null;
    const refreshed = await this.bearer();
    const second = await this.request("GET", pathname, query, refreshed);
    if (second.status === 401 || second.status === 403) throw new Error("Playtomic rejected the access token");
    return second.json;
  }

  private async bearer(): Promise<string> {
    const nowMs = this.now().getTime();
    if (this.token && nowMs < this.token.expiresAtMs - 60_000) return this.token.value;
    const response = await this.request("POST", TOKEN_PATH, {}, null);
    if (!isRecord(response.json) || typeof response.json.token !== "string" || !response.json.token) {
      throw new Error("Playtomic token response did not include a token");
    }
    const expiresIn = typeof response.json.expires_in === "number" ? response.json.expires_in : 3600;
    this.token = {
      value: response.json.token,
      expiresAtMs: nowMs + Math.max(1, expiresIn) * 1000,
    };
    return this.token.value;
  }

  private async request(
    method: "GET" | "POST",
    pathname: string,
    query: Record<string, string>,
    bearer: string | null,
  ): Promise<{ status: number; json: unknown }> {
    if (method === "POST" && pathname !== TOKEN_PATH) {
      throw new Error("Playtomic sync is read-only");
    }
    const url = new URL(pathname, ensureSlash(this.config.baseUrl));
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let delayMs = 1000;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await this.gap();
      const headers: Record<string, string> = { accept: "application/json" };
      if (bearer) headers.authorization = `Bearer ${bearer}`;
      const init: RequestInit = { method, headers, redirect: "error" };
      if (method === "POST") {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify({ client_id: this.config.clientId, secret: this.config.clientSecret });
      }
      const response = await this.fetchImpl(url, init);
      const retryable = response.status === 429 || (pathname.endsWith("/payments") && response.status === 202);
      if (retryable && attempt < MAX_ATTEMPTS) {
        await response.arrayBuffer().catch(() => undefined);
        await this.sleep(retryDelay(response, delayMs));
        delayMs = Math.min(delayMs * 2, 16_000);
        continue;
      }
      if (response.status === 202) throw new Error("Playtomic payments snapshot is still processing");
      if (response.status === 429) throw new Error("Playtomic rate limit persisted");
      if (response.status === 401 || response.status === 403) {
        const json = (await response.json().catch(() => null)) as unknown;
        return { status: response.status, json };
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Playtomic request failed with status ${response.status}`);
      }
      const json = (await response.json()) as unknown;
      return { status: response.status, json };
    }
    throw new Error("Playtomic request failed");
  }

  private async gap(): Promise<void> {
    const wait = this.config.minGapMs - (this.now().getTime() - this.lastRequestMs);
    this.lastRequestMs = this.now().getTime();
    if (wait > 0) await this.sleep(wait);
  }
}

function ensureSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

function stamp(date: Date, withZone: boolean): string {
  const base = date.toISOString().slice(0, 19);
  return withZone ? `${base}Z` : base;
}

function retryDelay(response: Response, fallbackMs: number): number {
  const header = response.headers.get("retry-after");
  if (!header) return fallbackMs;
  if (/^\d+$/.test(header)) return Math.min(Number(header) * 1000, 16_000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.min(Math.max(0, when - Date.now()), 16_000);
  return fallbackMs;
}

function parseBooking(value: unknown): PlaytomicBooking | null {
  if (!isRecord(value)) return null;
  const bookingId = asText(value.booking_id, 80);
  const resourceId = asText(value.resource_id, 80);
  const resourceName = asText(value.resource_name, 120) ?? "Court";
  const startsAt = asUtc(value.booking_start_date);
  const endsAt = asUtc(value.booking_end_date);
  if (!bookingId || !resourceId || !startsAt || !endsAt) return null;
  const status = asText(value.status, 40) ?? "";
  const canceled = value.is_canceled === true || status === "CANCELED";
  const info = isRecord(value.participant_info) ? value.participant_info : null;
  const participants = Array.isArray(info?.participants) ? info.participants.flatMap(parseParticipant) : [];
  return {
    bookingId,
    resourceId,
    resourceName,
    startsAt,
    endsAt,
    canceled,
    status,
    priceText: asText(value.price, 40),
    participants,
  };
}

function parseParticipant(value: unknown): PlaytomicParticipant[] {
  if (!isRecord(value)) return [];
  const participantId = asText(value.participant_id, 80);
  if (!participantId) return [];
  const kind = asText(value.participant_type, 32) ?? "UNKNOWN";
  return [
    {
      participantId,
      email: asText(value.email, 200),
      name: asText(value.name, 120),
      acceptsCommercial: value.accepts_commercial_communications === true,
      participantType: kind,
    },
  ];
}

function parsePayment(value: unknown): PlaytomicPayment | null {
  if (!isRecord(value)) return null;
  const clubPaymentId = asText(value.club_payment_id, 80);
  if (!clubPaymentId) return null;
  const paymentInfo = isRecord(value.payment_info) ? value.payment_info : null;
  const serviceInfo = isRecord(value.service_info) ? value.service_info : null;
  const productInfo = isRecord(value.product_info) ? value.product_info : null;
  return {
    clubPaymentId,
    paymentId: asText(value.payment_id, 80),
    refundId: asText(value.refund_id, 80),
    status: asText(value.status, 40) ?? asText(paymentInfo?.status, 40),
    totalText: moneyText(value.total) ?? moneyText(paymentInfo?.total) ?? moneyText(value.price),
    paymentDate: asUtc(value.payment_date) ?? asUtc(paymentInfo?.payment_date),
    serviceDate: asUtc(value.service_date) ?? asUtc(serviceInfo?.service_date),
    productSku: asText(value.product_sku, 80) ?? asText(productInfo?.product_sku, 80),
  };
}

function moneyText(value: unknown): string | null {
  if (typeof value === "string") return asText(value, 40);
  if (!isRecord(value)) return null;
  const amount = asText(value.amount, 20);
  const currency = asText(value.currency, 8);
  if (!amount || !currency) return null;
  return `${amount} ${currency}`.slice(0, 40);
}

function asUtc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const zoned = /[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  const ms = Date.parse(zoned);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
