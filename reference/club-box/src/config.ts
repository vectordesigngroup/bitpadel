import { isValidTimeZone } from "./time.js";

export type PaymentBackendName = "mock" | "btcpay" | "lnbits";
export type DoorBackendName = "mock" | "http";

export type BtcpayConfig = {
  url: string;
  storeId: string;
  apiKey: string;
  webhookSecret: string;
  paymentMethod: string;
};

export type LnbitsConfig = {
  url: string;
  invoiceKey: string;
  webhookSecret: string;
};

export type DoorHttpConfig = {
  url: string;
  token: string;
  timeoutMs: number;
};

export type AreaWindow = {
  startMin: number;
  endMin: number;
};

export type AppConfig = {
  host: string;
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  currency: string;
  currencyDecimals: number;
  /** Operator default for the admin slot helper. Null until they set it. */
  defaultSlotPriceMinor: number | null;
  /** Required for LNbits. Optional for the mock backend. Unused by BTCPay fiat invoices. */
  satsPerMinorUnit: number | null;
  holdMinutes: number;
  paymentBackend: PaymentBackendName;
  btcpay: BtcpayConfig | null;
  lnbits: LnbitsConfig | null;
  doorBackend: DoorBackendName;
  doorHttp: DoorHttpConfig | null;
  doorPulseMs: number;
  k1TtlSeconds: number;
  rateLimitWindowSeconds: number;
  rateLimitMax: number;
  challengeRateLimitMax: number;
  adminToken: string;
  areas: string[];
  areaHours: Record<string, AreaWindow>;
  clubTimeZone: string;
  logRetentionDays: number;
  trustProxy: boolean;
};

export type Env = Record<string, string | undefined>;

const PAYMENT_BACKENDS = ["mock", "btcpay", "lnbits"] as const;
const DOOR_BACKENDS = ["mock", "http"] as const;
const AREA_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SECRET_PATH = /^[A-Za-z0-9_-]{16,128}$/;

export function loadConfig(env: Env): AppConfig {
  const port = intEnv(env, "PORT", 3000, 0, 65535);
  const host = env.HOST?.trim() || "127.0.0.1";
  const currency = required(env, "CURRENCY");
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("CURRENCY must be a 3-letter ISO-style code");
  }
  const currencyDecimals = intEnv(env, "CURRENCY_DECIMALS", null, 0, 8);
  const paymentBackend = oneOf(env.PAYMENT_BACKEND?.trim() || "mock", PAYMENT_BACKENDS, "PAYMENT_BACKEND");
  const doorBackend = oneOf(env.DOOR_BACKEND?.trim() || "mock", DOOR_BACKENDS, "DOOR_BACKEND");
  const areas = parseAreas(env.ACCESS_AREAS ?? "");
  const clubTimeZone = env.CLUB_TIMEZONE?.trim() || "UTC";
  if (!isValidTimeZone(clubTimeZone)) throw new Error("CLUB_TIMEZONE must be an IANA timezone");

  const config: AppConfig = {
    host,
    port,
    databasePath: env.DATABASE_PATH?.trim() || "./data/club.sqlite",
    publicBaseUrl: parseBaseUrl(env.PUBLIC_BASE_URL?.trim() || `http://127.0.0.1:${port || 3000}`),
    currency,
    currencyDecimals,
    defaultSlotPriceMinor: optionalMinor(env, "DEFAULT_SLOT_PRICE_MINOR"),
    satsPerMinorUnit: optionalRate(env, "SATS_PER_MINOR_UNIT"),
    holdMinutes: intEnv(env, "HOLD_MINUTES", 15, 1, 120),
    paymentBackend,
    btcpay: null,
    lnbits: null,
    doorBackend,
    doorHttp: null,
    doorPulseMs: intEnv(env, "DOOR_PULSE_MS", 3000, 200, 10_000),
    k1TtlSeconds: intEnv(env, "K1_TTL_SECONDS", 90, 15, 300),
    rateLimitWindowSeconds: intEnv(env, "RATE_LIMIT_WINDOW_SECONDS", 60, 1, 3600),
    rateLimitMax: intEnv(env, "RATE_LIMIT_MAX", 30, 1, 10_000),
    challengeRateLimitMax: intEnv(env, "CHALLENGE_RATE_LIMIT_MAX", 120, 1, 10_000),
    adminToken: parseAdminToken(env.ADMIN_TOKEN ?? ""),
    areas,
    areaHours: parseAreaHours(env.ACCESS_AREA_HOURS ?? "", areas),
    clubTimeZone,
    logRetentionDays: intEnv(env, "LOG_RETENTION_DAYS", 90, 1, 3650),
    trustProxy: boolEnv(env, "TRUST_PROXY", false),
  };

  if (paymentBackend === "btcpay") config.btcpay = parseBtcpay(env);
  if (paymentBackend === "lnbits") {
    if (config.satsPerMinorUnit == null) {
      throw new Error("SATS_PER_MINOR_UNIT is required when PAYMENT_BACKEND=lnbits");
    }
    config.lnbits = parseLnbits(env);
  }
  if (doorBackend === "http") config.doorHttp = parseDoorHttp(env);
  return config;
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function intEnv(env: Env, name: string, fallback: number | null, min: number, max: number): number {
  const raw = env[name]?.trim() ?? "";
  if (!raw) {
    if (fallback === null) throw new Error(`Missing ${name}`);
    return fallback;
  }
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${name} must be from ${min} to ${max}`);
  return value;
}

function boolEnv(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase() ?? "";
  if (!raw) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}

function optionalMinor(env: Env, name: string): number | null {
  const raw = env[name]?.trim() ?? "";
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer of minor units`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer of minor units`);
  }
  return value;
}

function optionalRate(env: Env, name: string): number | null {
  const raw = env[name]?.trim() ?? "";
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`${name} must be a positive number`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function parseAdminToken(raw: string): string {
  const token = raw.trim();
  if (token.length < 16) {
    throw new Error("ADMIN_TOKEN must be at least 16 characters. Generate one with: openssl rand -hex 24");
  }
  return token;
}

function parseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("PUBLIC_BASE_URL must not include credentials, a query, or a hash");
  }
  const path = url.pathname.replace(/\/$/, "");
  return `${url.origin}${path}`;
}

function parseAreas(raw: string): string[] {
  const areas = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (areas.length === 0) throw new Error("ACCESS_AREAS must list at least one area id");
  const seen = new Set<string>();
  for (const area of areas) {
    if (!AREA_ID.test(area)) {
      throw new Error(`ACCESS_AREAS id "${area}" must be lowercase letters, numbers, and hyphens`);
    }
    if (seen.has(area)) throw new Error(`ACCESS_AREAS lists "${area}" more than once`);
    seen.add(area);
  }
  return areas;
}

function parseAreaHours(raw: string, areas: readonly string[]): Record<string, AreaWindow> {
  const hours: Record<string, AreaWindow> = {};
  const trimmed = raw.trim();
  if (!trimmed) return hours;
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const match = /^([a-z0-9][a-z0-9-]{0,40})=(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(piece);
    if (!match) {
      throw new Error("ACCESS_AREA_HOURS entries look like area=HH:MM-HH:MM");
    }
    const area = match[1];
    const startHour = match[2];
    const startMinute = match[3];
    const endHour = match[4];
    const endMinute = match[5];
    if (
      area === undefined ||
      startHour === undefined ||
      startMinute === undefined ||
      endHour === undefined ||
      endMinute === undefined
    ) {
      throw new Error("ACCESS_AREA_HOURS entries look like area=HH:MM-HH:MM");
    }
    if (!areas.includes(area)) throw new Error(`ACCESS_AREA_HOURS names unknown area "${area}"`);
    const startMin = clockToMinutes(startHour, startMinute);
    const endMin = clockToMinutes(endHour, endMinute);
    if (startMin === endMin) throw new Error(`ACCESS_AREA_HOURS window for "${area}" is empty`);
    hours[area] = { startMin, endMin };
  }
  return hours;
}

function clockToMinutes(hourRaw: string, minuteRaw: string): number {
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (hour > 23 || minute > 59) throw new Error("ACCESS_AREA_HOURS has a clock time that does not exist");
  return hour * 60 + minute;
}

function parseHttpUrl(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return raw.replace(/\/$/, "");
}

function parseBtcpay(env: Env): BtcpayConfig {
  const webhookSecret = required(env, "BTCPAY_WEBHOOK_SECRET");
  if (webhookSecret.length < 16) throw new Error("BTCPAY_WEBHOOK_SECRET must be at least 16 characters");
  return {
    url: parseHttpUrl(required(env, "BTCPAY_URL"), "BTCPAY_URL"),
    storeId: required(env, "BTCPAY_STORE_ID"),
    apiKey: required(env, "BTCPAY_API_KEY"),
    webhookSecret,
    paymentMethod: env.BTCPAY_PAYMENT_METHOD?.trim() || "BTC-LN",
  };
}

function parseLnbits(env: Env): LnbitsConfig {
  const webhookSecret = required(env, "LNBITS_WEBHOOK_SECRET");
  if (!SECRET_PATH.test(webhookSecret)) {
    throw new Error("LNBITS_WEBHOOK_SECRET must be 16-128 characters of letters, numbers, _ or -");
  }
  return {
    url: parseHttpUrl(required(env, "LNBITS_URL"), "LNBITS_URL"),
    invoiceKey: required(env, "LNBITS_INVOICE_KEY"),
    webhookSecret,
  };
}

function parseDoorHttp(env: Env): DoorHttpConfig {
  const token = required(env, "DOOR_HTTP_TOKEN");
  if (token.length < 16) throw new Error("DOOR_HTTP_TOKEN must be at least 16 characters");
  return {
    url: parseHttpUrl(required(env, "DOOR_HTTP_URL"), "DOOR_HTTP_URL"),
    token,
    timeoutMs: intEnv(env, "DOOR_HTTP_TIMEOUT_MS", 2000, 200, 10_000),
  };
}
