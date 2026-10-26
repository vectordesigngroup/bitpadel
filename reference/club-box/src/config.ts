// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import path from "node:path";
import { loadNfcKeys, type NfcKeyMaterial } from "./nfc/keys.js";
import { isValidTimeZone } from "./time.js";

export type PaymentBackendName = "mock" | "btcpay" | "lnbits";
export type CardProviderName = "stripe" | "square";
export type CancelRefundPolicy = "full" | "none";
export type DoorBackendName = "mock" | "http" | "gpio" | "serial";
export type EmailProviderName = "console" | "smtp" | "postmark";
export type SmsProviderName = "console" | "twilio" | "webhook";
export type StorageBackendName = "local" | "memory";
export type BackupDestinationName = "local" | "s3";

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
  /** Optional. Only needed to send refunds; LNbits rejects outgoing payments made with an invoice key. */
  adminKey?: string | null;
};

export type DoorHttpConfig = {
  url: string;
  token: string;
  timeoutMs: number;
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export type PostmarkConfig = {
  serverToken: string;
  from: string;
};

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  from: string;
};

export type SmsWebhookConfig = {
  url: string;
  token: string | null;
};

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
};

export type StaffBootstrapConfig = {
  username: string;
  password: string;
  displayName: string;
};

export type DoorGpioConfig = {
  pin: number;
  activeHigh: boolean;
};

export type DoorSerialConfig = {
  path: string;
};

export type UidMode = "off" | "insecure-dev";

export type NfcConfig = {
  keys: NfcKeyMaterial;
  uidMode: UidMode;
};

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  apiBase: string;
};

export type SquareConfig = {
  accessToken: string;
  locationId: string;
  webhookSignatureKey: string;
  apiBase: string;
  /** Notification URL Square signs. The club's public webhook address. */
  webhookUrl: string;
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
  cardProviders: CardProviderName[];
  stripe: StripeConfig | null;
  square: SquareConfig | null;
  btcpay: BtcpayConfig | null;
  lnbits: LnbitsConfig | null;
  doorBackend: DoorBackendName;
  doorHttp: DoorHttpConfig | null;
  doorGpio: DoorGpioConfig | null;
  doorSerial: DoorSerialConfig | null;
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
  /** Bearer token for vending and counter devices. Null refuses those routes. */
  vendingDeviceToken: string | null;
  guestLimit: number;
  checkinStaleMinutes: number;
  visitRetentionDays: number;
  membershipTypes: string[];
  consentTextVersion: string;
  waiverTextVersion: string;
  photoDir: string;
  photoMaxBytes: number;
  emailProvider: EmailProviderName;
  smsProvider: SmsProviderName;
  smtp: SmtpConfig | null;
  postmark: PostmarkConfig | null;
  twilio: TwilioConfig | null;
  smsWebhook: SmsWebhookConfig | null;
  notifyAdminEmail: string | null;
  notifyAdminSms: string | null;
  storageBackend: StorageBackendName;
  backupDestination: BackupDestinationName;
  backupDir: string;
  s3: S3Config | null;
  logFile: string | null;
  logFileMaxBytes: number;
  logFileKeep: number;
  staffBootstrap: StaffBootstrapConfig | null;
  sessionTtlHours: number;
  bookingEntry: boolean;
  bookingEntryBeforeMinutes: number;
  bookingEntryAfterMinutes: number;
  cancelWindowHours: number;
  cancelRefund: CancelRefundPolicy;
  reminderHoursBefore: number;
  dailySummaryEmail: string | null;
  nfc: NfcConfig;
  playtomic: PlaytomicConfig | null;
};

export type Env = Record<string, string | undefined>;

const PAYMENT_BACKENDS = ["mock", "btcpay", "lnbits"] as const;
const CARD_PROVIDERS = ["stripe", "square"] as const;
const CANCEL_REFUNDS = ["full", "none"] as const;
const DOOR_BACKENDS = ["mock", "http", "gpio", "serial"] as const;
const EMAIL_PROVIDERS = ["console", "smtp", "postmark"] as const;
const SMS_PROVIDERS = ["console", "twilio", "webhook"] as const;
const STORAGE_BACKENDS = ["local", "memory"] as const;
const BACKUP_DESTINATIONS = ["local", "s3"] as const;
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
  const cardProviders = parseCardProviders(env.CARD_PROVIDERS ?? "");
  const doorBackend = oneOf(env.DOOR_BACKEND?.trim() || "mock", DOOR_BACKENDS, "DOOR_BACKEND");
  const emailProvider = oneOf(env.EMAIL_PROVIDER?.trim() || "console", EMAIL_PROVIDERS, "EMAIL_PROVIDER");
  const smsProvider = oneOf(env.SMS_PROVIDER?.trim() || "console", SMS_PROVIDERS, "SMS_PROVIDER");
  const storageBackend = oneOf(env.STORAGE_BACKEND?.trim() || "local", STORAGE_BACKENDS, "STORAGE_BACKEND");
  const backupDestination = oneOf(
    env.BACKUP_DESTINATION?.trim() || "local",
    BACKUP_DESTINATIONS,
    "BACKUP_DESTINATION",
  );
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
    cardProviders,
    stripe: null,
    square: null,
    btcpay: null,
    lnbits: null,
    doorBackend,
    doorHttp: null,
    doorGpio: null,
    doorSerial: null,
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
    vendingDeviceToken: optionalSecret(env.VENDING_DEVICE_TOKEN, "VENDING_DEVICE_TOKEN"),
    guestLimit: intEnv(env, "GUEST_LIMIT", 0, 0, 50),
    checkinStaleMinutes: intEnv(env, "CHECKIN_STALE_MINUTES", 480, 15, 10_080),
    visitRetentionDays: intEnv(env, "VISIT_RETENTION_DAYS", 30, 1, 3650),
    membershipTypes: parseMembershipTypes(env.MEMBERSHIP_TYPES ?? ""),
    consentTextVersion: textVersion(env.CONSENT_TEXT_VERSION, "CONSENT_TEXT_VERSION"),
    waiverTextVersion: textVersion(env.WAIVER_TEXT_VERSION, "WAIVER_TEXT_VERSION"),
    photoDir: env.PHOTO_DIR?.trim() || defaultPhotoDir(databasePath),
    photoMaxBytes: intEnv(env, "PHOTO_MAX_BYTES", 1_048_576, 1024, 1_048_576),
    emailProvider,
    smsProvider,
    smtp: null,
    postmark: null,
    twilio: null,
    smsWebhook: null,
    notifyAdminEmail: optionalEmail(env.NOTIFY_ADMIN_EMAIL, "NOTIFY_ADMIN_EMAIL"),
    notifyAdminSms: optionalPhone(env.NOTIFY_ADMIN_SMS, "NOTIFY_ADMIN_SMS"),
    storageBackend,
    backupDestination,
    backupDir: env.BACKUP_DIR?.trim() || "./data/backups",
    s3: null,
    logFile: env.LOG_FILE?.trim() || null,
    logFileMaxBytes: intEnv(env, "LOG_FILE_MAX_BYTES", 5_000_000, 10_000, 100_000_000),
    logFileKeep: intEnv(env, "LOG_FILE_KEEP", 5, 1, 20),
    staffBootstrap: parseStaffBootstrap(env),
    sessionTtlHours: intEnv(env, "SESSION_TTL_HOURS", 12, 1, 168),
    bookingEntry: boolEnv(env, "BOOKING_ENTRY", false),
    bookingEntryBeforeMinutes: intEnv(env, "BOOKING_ENTRY_BEFORE_MINUTES", 30, 0, 240),
    bookingEntryAfterMinutes: intEnv(env, "BOOKING_ENTRY_AFTER_MINUTES", 15, 0, 240),
    cancelWindowHours: intEnv(env, "CANCEL_WINDOW_HOURS", 24, 0, 168),
    cancelRefund: oneOf(env.CANCEL_REFUND?.trim() || "full", CANCEL_REFUNDS, "CANCEL_REFUND"),
    reminderHoursBefore: intEnv(env, "REMINDER_HOURS_BEFORE", 24, 1, 168),
    dailySummaryEmail: optionalEmail(env.DAILY_SUMMARY_EMAIL, "DAILY_SUMMARY_EMAIL"),
    nfc: {
      keys: loadNfcKeys(env),
      uidMode: oneOf(env.NFC_UID_MODE?.trim() || "off", UID_MODES, "NFC_UID_MODE"),
    },
    playtomic: parsePlaytomic(env),
  };

  if (cardProviders.includes("stripe")) config.stripe = parseStripe(env);
  if (cardProviders.includes("square")) config.square = parseSquare(env, config.publicBaseUrl);
  if (paymentBackend === "btcpay") config.btcpay = parseBtcpay(env);
  if (paymentBackend === "lnbits") {
    if (config.satsPerMinorUnit == null) {
      throw new Error("SATS_PER_MINOR_UNIT is required when PAYMENT_BACKEND=lnbits");
    }
    config.lnbits = parseLnbits(env);
  }
  if (doorBackend === "http") config.doorHttp = parseDoorHttp(env);
  if (doorBackend === "gpio") config.doorGpio = parseDoorGpio(env);
  if (doorBackend === "serial") config.doorSerial = parseDoorSerial(env);
  if (emailProvider === "smtp") config.smtp = parseSmtp(env);
  if (emailProvider === "postmark") config.postmark = parsePostmark(env);
  if (smsProvider === "twilio") config.twilio = parseTwilio(env);
  if (smsProvider === "webhook") config.smsWebhook = parseSmsWebhook(env);
  if (backupDestination === "s3") config.s3 = parseS3(env);
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
    adminKey: env.LNBITS_ADMIN_KEY?.trim() || null,
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

function parseDoorGpio(env: Env): DoorGpioConfig {
  return {
    pin: intEnv(env, "DOOR_GPIO_PIN", null, 0, 999),
    activeHigh: boolEnv(env, "DOOR_GPIO_ACTIVE_HIGH", true),
  };
}

function parseDoorSerial(env: Env): DoorSerialConfig {
  const devicePath = required(env, "DOOR_SERIAL_PATH");
  if (devicePath.length > 200) throw new Error("DOOR_SERIAL_PATH is too long");
  return { path: devicePath };
}

function parseSmtp(env: Env): SmtpConfig {
  return {
    host: required(env, "SMTP_HOST"),
    port: intEnv(env, "SMTP_PORT", 587, 1, 65535),
    secure: boolEnv(env, "SMTP_SECURE", false),
    user: env.SMTP_USER?.trim() ?? "",
    pass: env.SMTP_PASS ?? "",
    from: requiredEmail(env, "SMTP_FROM"),
  };
}

function parsePostmark(env: Env): PostmarkConfig {
  return {
    serverToken: required(env, "POSTMARK_SERVER_TOKEN"),
    from: requiredEmail(env, "POSTMARK_FROM"),
  };
}

function parseTwilio(env: Env): TwilioConfig {
  return {
    accountSid: required(env, "TWILIO_ACCOUNT_SID"),
    authToken: required(env, "TWILIO_AUTH_TOKEN"),
    from: required(env, "TWILIO_FROM"),
  };
}

function parseSmsWebhook(env: Env): SmsWebhookConfig {
  const token = env.SMS_WEBHOOK_TOKEN?.trim() ?? "";
  return {
    url: parseHttpUrl(required(env, "SMS_WEBHOOK_URL"), "SMS_WEBHOOK_URL"),
    token: token || null,
  };
}

function parseS3(env: Env): S3Config {
  return {
    endpoint: parseHttpUrl(required(env, "S3_ENDPOINT"), "S3_ENDPOINT"),
    bucket: required(env, "S3_BUCKET"),
    region: env.S3_REGION?.trim() || "us-east-1",
    accessKey: required(env, "S3_ACCESS_KEY_ID"),
    secretKey: required(env, "S3_SECRET_ACCESS_KEY"),
    prefix: env.S3_PREFIX?.trim() ?? "",
  };
}

function parseCardProviders(raw: string): CardProviderName[] {
  const parts = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  const chosen: CardProviderName[] = [];
  for (const part of parts) {
    if (!(CARD_PROVIDERS as readonly string[]).includes(part)) {
      throw new Error(`CARD_PROVIDERS must be a list of: ${CARD_PROVIDERS.join(", ")}`);
    }
    const name = part as CardProviderName;
    if (chosen.includes(name)) throw new Error(`CARD_PROVIDERS lists "${name}" more than once`);
    chosen.push(name);
  }
  return chosen;
}

function parseStripe(env: Env): StripeConfig {
  const secretKey = required(env, "STRIPE_SECRET_KEY");
  const webhookSecret = required(env, "STRIPE_WEBHOOK_SECRET");
  if (webhookSecret.length < 16) throw new Error("STRIPE_WEBHOOK_SECRET must be at least 16 characters");
  const allowLive = boolEnv(env, "STRIPE_ALLOW_LIVE", false);
  if (!allowLive && !secretKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a test key (sk_test_) unless STRIPE_ALLOW_LIVE=true");
  }
  const apiBase = env.STRIPE_API_BASE?.trim() || "https://api.stripe.com";
  if (!apiBase.startsWith("https://") && !apiBase.startsWith("http://127.0.0.1")) {
    throw new Error("STRIPE_API_BASE must be https, or http://127.0.0.1 for tests");
  }
  return { secretKey, webhookSecret, apiBase: apiBase.replace(/\/$/, "") };
}

function parseSquare(env: Env, publicBaseUrl: string): SquareConfig {
  const accessToken = required(env, "SQUARE_ACCESS_TOKEN");
  const locationId = required(env, "SQUARE_LOCATION_ID");
  const webhookSignatureKey = required(env, "SQUARE_WEBHOOK_SIGNATURE_KEY");
  if (webhookSignatureKey.length < 16) {
    throw new Error("SQUARE_WEBHOOK_SIGNATURE_KEY must be at least 16 characters");
  }
  const mode = oneOf(env.SQUARE_ENV?.trim() || "sandbox", ["sandbox", "production"] as const, "SQUARE_ENV");
  const allowLive = boolEnv(env, "SQUARE_ALLOW_LIVE", false);
  if (mode === "production" && !allowLive) {
    throw new Error("SQUARE_ENV=production requires SQUARE_ALLOW_LIVE=true. Sandbox is the default.");
  }
  const fallback = mode === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
  const apiBase = env.SQUARE_API_BASE?.trim() || fallback;
  if (!apiBase.startsWith("https://") && !apiBase.startsWith("http://127.0.0.1")) {
    throw new Error("SQUARE_API_BASE must be https, or http://127.0.0.1 for tests");
  }
  return {
    accessToken,
    locationId,
    webhookSignatureKey,
    apiBase: apiBase.replace(/\/$/, ""),
    webhookUrl: `${publicBaseUrl}/api/webhooks/square`,
  };
}

function parseStaffBootstrap(env: Env): StaffBootstrapConfig | null {
  const username = env.STAFF_BOOTSTRAP_USERNAME?.trim().toLowerCase() ?? "";
  const password = env.STAFF_BOOTSTRAP_PASSWORD ?? "";
  if (!username && !password.trim()) return null;
  if (!username || !password) {
    throw new Error("STAFF_BOOTSTRAP_USERNAME and STAFF_BOOTSTRAP_PASSWORD must both be set");
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(username)) {
    throw new Error("STAFF_BOOTSTRAP_USERNAME must be 2-40 lowercase letters, numbers, dots, underscores, or hyphens");
  }
  if (password.length < 12 || password.length > 200) {
    throw new Error("STAFF_BOOTSTRAP_PASSWORD must be 12-200 characters");
  }
  const displayName = env.STAFF_BOOTSTRAP_NAME?.trim() || username;
  return { username, password, displayName: displayName.slice(0, 80) };
}

function optionalEmail(raw: string | undefined, name: string): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(value) || value.length > 200) throw new Error(`${name} must be an email address`);
  return value;
}

function requiredEmail(env: Env, name: string): string {
  const value = optionalEmail(env[name], name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function optionalPhone(raw: string | undefined, name: string): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (!/^[0-9+][0-9 ()-]{5,20}$/.test(value)) throw new Error(`${name} must look like a phone number`);
  return value;
}
