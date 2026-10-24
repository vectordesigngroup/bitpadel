import path from "node:path";
import { loadNfcKeys, type NfcKeyMaterial } from "./nfc/keys.js";
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

export type UidMode = "off" | "insecure-dev";

export type NfcConfig = {
  keys: NfcKeyMaterial;
  uidMode: UidMode;
};

export type PlaytomicConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  /** 0 means the operator runs sync by hand. */
  syncMinutes: number;
  pageSize: number;
  minGapMs: number;
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
  staffToken: string | null;
  guestLimit: number;
  checkinStaleMinutes: number;
  visitRetentionDays: number;
  membershipTypes: string[];
  consentTextVersion: string;
  waiverTextVersion: string;
  photoDir: string;
  nfc: NfcConfig;
  playtomic: PlaytomicConfig | null;
};

export type Env = Record<string, string | undefined>;

const PAYMENT_BACKENDS = ["mock", "btcpay", "lnbits"] as const;
const DOOR_BACKENDS = ["mock", "http"] as const;
const UID_MODES = ["off", "insecure-dev"] as const;
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
  const databasePath = env.DATABASE_PATH?.trim() || "./data/club.sqlite";

  const config: AppConfig = {
    host,
    port,
    databasePath,
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
    staffToken: optionalSecret(env.STAFF_TOKEN, "STAFF_TOKEN"),
    guestLimit: intEnv(env, "GUEST_LIMIT", 0, 0, 50),
    checkinStaleMinutes: intEnv(env, "CHECKIN_STALE_MINUTES", 480, 15, 10_080),
    visitRetentionDays: intEnv(env, "VISIT_RETENTION_DAYS", 30, 1, 3650),
    membershipTypes: parseMembershipTypes(env.MEMBERSHIP_TYPES ?? ""),
    consentTextVersion: textVersion(env.CONSENT_TEXT_VERSION, "CONSENT_TEXT_VERSION"),
    waiverTextVersion: textVersion(env.WAIVER_TEXT_VERSION, "WAIVER_TEXT_VERSION"),
    photoDir: env.PHOTO_DIR?.trim() || defaultPhotoDir(databasePath),
    nfc: {
      keys: loadNfcKeys(env),
      uidMode: oneOf(env.NFC_UID_MODE?.trim() || "off", UID_MODES, "NFC_UID_MODE"),
    },
    playtomic: parsePlaytomic(env),
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

function optionalSecret(raw: string | undefined, name: string): string | null {
  const token = raw?.trim() ?? "";
  if (!token) return null;
  if (token.length < 16) throw new Error(`${name} must be at least 16 characters`);
  return token;
}

function textVersion(raw: string | undefined, name: string): string {
  const value = raw?.trim() || "1";
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(value)) {
    throw new Error(`${name} must be 1-40 letters, numbers, dots, underscores, or hyphens`);
  }
  return value;
}

function parseMembershipTypes(raw: string): string[] {
  const trimmed = raw.trim();
  const parts = (trimmed || "standard,household")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error("MEMBERSHIP_TYPES must list at least one type");
  const seen = new Set<string>();
  for (const part of parts) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(part)) {
      throw new Error(`MEMBERSHIP_TYPES id "${part}" must be lowercase letters, numbers, and hyphens`);
    }
    if (seen.has(part)) throw new Error(`MEMBERSHIP_TYPES lists "${part}" more than once`);
    seen.add(part);
  }
  return parts;
}

function defaultPhotoDir(databasePath: string): string {
  if (databasePath === ":memory:") return path.join(path.resolve("."), "data", "photos");
  return path.join(path.dirname(path.resolve(databasePath)), "photos");
}

function parsePlaytomic(env: Env): PlaytomicConfig | null {
  const clientId = env.PLAYTOMIC_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.PLAYTOMIC_CLIENT_SECRET?.trim() ?? "";
  const tenantId = env.PLAYTOMIC_TENANT_ID?.trim() ?? "";
  const any = clientId || clientSecret || tenantId;
  if (!any) return null;
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error("PLAYTOMIC_CLIENT_ID, PLAYTOMIC_CLIENT_SECRET, and PLAYTOMIC_TENANT_ID must all be set");
  }
  if (clientId.length > 200 || clientSecret.length > 200 || tenantId.length > 200) {
    throw new Error("Playtomic credentials are too long");
  }
  return {
    baseUrl: parseHttpUrl(env.PLAYTOMIC_BASE_URL?.trim() || "https://thirdparty.playtomic.io", "PLAYTOMIC_BASE_URL"),
    clientId,
    clientSecret,
    tenantId,
    syncMinutes: intEnv(env, "PLAYTOMIC_SYNC_MINUTES", 15, 0, 1440),
    pageSize: intEnv(env, "PLAYTOMIC_PAGE_SIZE", 100, 1, 200),
    minGapMs: intEnv(env, "PLAYTOMIC_MIN_GAP_MS", 60_000, 0, 60_000),
  };
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
