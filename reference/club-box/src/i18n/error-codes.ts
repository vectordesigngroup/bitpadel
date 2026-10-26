// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

/**
 * Stable API error codes. The HTTP body keeps the English sentence in `error`
 * and adds `code` plus `params`. Pages look up `code` in the locale catalog.
 */

export type ClassifiedError = {
  code: string;
  params: Record<string, string>;
};

type Pattern = {
  re: RegExp;
  code: string;
  params: (match: RegExpMatchArray) => Record<string, string>;
};

const FIELD = "(?:link label|[A-Za-z][A-Za-z0-9]*)";

const PATTERNS: Pattern[] = [
  {
    re: new RegExp(`^(${FIELD}) must be your club's own name\\. BitPadel is the kit placeholder, not a club brand\\.$`),
    code: "errors.field-own-name",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be an integer from (-?\\d+) to (-?\\d+)$`),
    code: "errors.field-integer-range",
    params: (match) => ({ field: match[1] ?? "", min: match[2] ?? "", max: match[3] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be at most (\\d+) characters$`),
    code: "errors.field-max-length",
    params: (match) => ({ field: match[1] ?? "", max: match[2] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be 1-(\\d+) characters$`),
    code: "errors.field-length",
    params: (match) => ({ field: match[1] ?? "", max: match[2] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be (\\d+)-(\\d+) characters$`),
    code: "errors.field-length-between",
    params: (match) => ({ field: match[1] ?? "", min: match[2] ?? "", max: match[3] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be a 6-digit hex color$`),
    code: "errors.field-hex",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be a date-time$`),
    code: "errors.field-datetime",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be YYYY-MM-DD or an ISO time$`),
    code: "errors.field-date-or-iso",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be a string$`),
    code: "errors.field-string",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) must be text$`),
    code: "errors.field-text",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) contains invalid characters$`),
    code: "errors.field-invalid-characters",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) is required$`),
    code: "errors.field-required",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) is invalid$`),
    code: "errors.field-invalid",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: new RegExp(`^(${FIELD}) is too long$`),
    code: "errors.field-too-long",
    params: (match) => ({ field: match[1] ?? "" }),
  },
  {
    re: /^At most (\d+) footer links$/,
    code: "errors.links-max",
    params: (match) => ({ max: match[1] ?? "" }),
  },
  {
    re: /^Email provider returned HTTP (\d+)$/,
    code: "errors.email-http",
    params: (match) => ({ status: match[1] ?? "" }),
  },
  {
    re: /^Photo must be (\d+) bytes or smaller$/,
    code: "errors.photo-too-large",
    params: (match) => ({ bytes: match[1] ?? "" }),
  },
  {
    re: /^SMS provider returned HTTP (\d+)$/,
    code: "errors.sms-http",
    params: (match) => ({ status: match[1] ?? "" }),
  },
  {
    re: /^SMS webhook returned HTTP (\d+)$/,
    code: "errors.sms-webhook-http",
    params: (match) => ({ status: match[1] ?? "" }),
  },
  {
    re: /^The refund invoice asks for more than the (.+) sats that were paid$/,
    code: "errors.refund-over-paid",
    params: (match) => ({ limit: match[1] ?? "" }),
  },
  {
    re: /^Unknown adjustment (.+)$/,
    code: "errors.unknown-adjustment",
    params: (match) => ({ value: match[1] ?? "" }),
  },
  {
    re: /^Unknown card presentation (.+)$/,
    code: "errors.unknown-card-presentation-value",
    params: (match) => ({ value: match[1] ?? "" }),
  },
  {
    re: /^Unknown payment method (.+)$/,
    code: "errors.unknown-payment-method",
    params: (match) => ({ value: match[1] ?? "" }),
  },
  {
    re: /^Unknown unit (.+)$/,
    code: "errors.unknown-unit",
    params: (match) => ({ value: match[1] ?? "" }),
  },
  {
    re: /^Use a (.+) file\.$/,
    code: "errors.file-type",
    params: (match) => ({ allowed: match[1] ?? "" }),
  },
  {
    re: /^Payment backend returned HTTP (\d+): (.*)$/,
    code: "errors.payment-http-detail",
    params: (match) => ({ status: match[1] ?? "", detail: match[2] ?? "" }),
  },
  {
    re: /^Payment backend returned HTTP (\d+)$/,
    code: "errors.payment-http",
    params: (match) => ({ status: match[1] ?? "" }),
  },
  {
    re: /^Admin token required: (.+)$/,
    code: "errors.admin-token-detail",
    params: (match) => ({ detail: match[1] ?? "" }),
  },
];

/** English sentences that are thrown as-is. The code is `errors.` plus this slug. */
export const EXACT_ERROR_MESSAGES = [
  "A credit cannot be larger than the amount owed.",
  "A waiver acknowledgement is required",
  "Admin token required",
  "Amount must be an integer of minor units",
  "An account cannot disable itself",
  "BTCPay balance check failed",
  "BTCPay did not return Lightning payment methods",
  "BTCPay Lightning balance endpoint responded",
  "BTCPay did not return a Lightning invoice. Enable Lightning on the store and check BTCPAY_PAYMENT_METHOD.",
  "BTCPay invoice response did not include an id",
  "BTCPay webhooks are not enabled",
  "Body too large",
  "Booking was not found",
  "Card authentication failed",
  "Card data is malformed",
  "Card verification is not configured",
  "Card was not found",
  "Check-in was not found",
  "Choose a font from the list",
  "Code not found",
  "Colors must be 6-digit hex, such as #14b8a6",
  "Converted minor-unit amount is not a positive integer",
  "Court not found",
  "DESFire personalization is not implemented. This build programs NTAG 424 DNA only. A reader bridge for DESFire is also not implemented.",
  "DESFire reader bridge is not implemented. The NDEF bridge reads NTAG 424 URLs only.",
  "Device token required",
  "Email provider did not respond",
  "Entry controller did not respond. Use a fob, PIN, or staff.",
  "Expected a JSON body",
  "Expected a JSON object",
  "Expected a marketing message",
  "Expected a transactional message",
  "File must be 512 KB or smaller",
  "Guest was not found",
  "Hold not found",
  "Household was not found",
  "Internal error",
  "Invalid BTCPay webhook signature",
  "Invalid JSON",
  "Invalid LNbits webhook secret",
  "Invalid Square webhook signature",
  "Invalid Stripe webhook signature",
  "LNbits could not pay the refund invoice",
  "LNbits wallet check failed",
  "LNbits wallet responded",
  "LNbits did not return a payment hash and invoice",
  "LNbits invoice response was not an object",
  "LNbits webhook URL is not configured",
  "LNbits webhooks are not enabled",
  "Link URL must be at most 200 characters",
  "Link URL must be http or https",
  "Linking key was not found",
  "Log in to see this tab",
  "Malformed sign-in.",
  "Membership is not active",
  "Membership is not active.",
  "Membership was not found",
  "Method not allowed",
  "Mock backend does not hold a Lightning balance",
  "Mock settlement is only available when PAYMENT_BACKEND=mock",
  "No confirmed booking covers this time.",
  "No favicon has been uploaded",
  "No logo has been uploaded",
  "No membership is linked to this login",
  "Not found",
  "Nothing is owed on the tab",
  "Only an open slot can be cancelled",
  "Only an open slot can change price",
  "Open check-in was not found",
  "Payment backend did not respond",
  "Payment backend returned invalid JSON",
  "Photo data is empty",
  "Photo must be a JPEG, PNG, or WebP file",
  "Photo was not found",
  "Player login required",
  "Playtomic is not configured",
  "Preview needs background, text, primary, and accent colors",
  "Price rule was not found",
  "Raise the guest count before adding another name",
  "Remove named guests before lowering the count",
  "SMS provider did not respond",
  "SMS webhook did not respond",
  "Sats charges need SATS_PER_MINOR_UNIT set to a positive integer so the minor-unit amount is exact",
  "Self-cancel is turned off",
  "Send amountMinor or amountSats, not both",
  "Set DAILY_SUMMARY_EMAIL or NOTIFY_ADMIN_EMAIL",
  "Settlement was not found",
  "Signature did not verify.",
  "Slot end must be after slot start",
  "Slot length must be from 1 minute to 24 hours",
  "Slot not found",
  "Square did not return a payment link",
  "Square responded",
  "Square did not return a refund id",
  "Square webhook is missing the order or payment id",
  "Square webhook was not JSON",
  "Square webhooks are not enabled",
  "Staff account was not found",
  "Staff token required",
  "Stripe did not return a checkout session",
  "Stripe responded",
  "Stripe did not return a refund id",
  "Stripe webhook is missing the session id",
  "Stripe webhook was not JSON",
  "Stripe webhooks are not enabled",
  "SVG attributes must be quoted",
  "SVG contains a null byte",
  "SVG contains an element this app does not allow",
  "SVG contains disallowed markup",
  "SVG has a broken tag",
  "SVG is missing an svg root",
  "SVG is too complex",
  "SVG is too large",
  "SVG tags are not closed",
  "SVG was rejected",
  "Tab is frozen",
  "That Playtomic court is already mapped",
  "That Playtomic player is already linked",
  "That SVG includes a script or other active content. Export a plain logo, or use PNG or JPG.",
  "That account is a booking contact, not a club membership",
  "That area is closed right now",
  "That area is not available.",
  "That card is active on another membership",
  "That card is already enrolled",
  "That code is wrong or expired",
  "That contact has not opted in to marketing",
  "That court already has a slot in that window",
  "That file uses the BitPadel placeholder name. Upload your club's own logo.",
  "That guest count is over the member's limit",
  "That guest is not with this member",
  "That guest record is closed",
  "That is more than the open tab minus payments already waiting",
  "That is over the tab limit",
  "That is the club's own invoice. Send a new invoice from the player's wallet.",
  "That payment method is not enabled",
  "That privacy link was not found",
  "That role cannot be assigned by this account",
  "That role cannot be changed by this account",
  "That sats amount does not convert to a whole number of minor units at the club's SATS_PER_MINOR_UNIT",
  "That slot has already started",
  "That slot is no longer open",
  "That slot is not open",
  "That time is already on the imported calendar.",
  "That username is already in use",
  "That window does not fit one slot",
  "That window would create more than 48 slots",
  "The cancellation window has closed.",
  "The file is empty",
  "The invoice is not ready",
  "The mock backend does not accept payment webhooks",
  "The price changed. Refresh and try again.",
  "The refund invoice must include an amount",
  "The wallet has not signed this code yet",
  "This card counter was already used",
  "This card is not enrolled",
  "This card was reported lost",
  "This card was revoked",
  "This code expired",
  "This code expired. Ask staff for a new one.",
  "This code expired. Scan the screen again.",
  "This code is not valid. Scan the screen again.",
  "This code was already used",
  "This code was already used.",
  "This code was already used. Scan the screen again.",
  "This enrollment code is not valid.",
  "This wallet is enrolled to another membership.",
  "This wallet is not enrolled.",
  "Too many attempts. Wait a moment.",
  "Too many attempts. Wait and try again.",
  "Too many attempts. Wait, then scan the new code.",
  "Too many charges. Wait a moment.",
  "Too many codes. Wait a moment.",
  "Too many hold attempts. Wait a moment.",
  "UID must be 7 bytes",
  "UID must be 7 bytes of hex",
  "UID-only cards are disabled",
  "Unknown area",
  "Unknown card presentation",
  "Unknown card scheme",
  "Unknown membership type",
  "Username must be 2-40 lowercase letters, numbers, dots, underscores, or hyphens",
  "Username or password is wrong",
  "Vending devices are not configured",
  "amountMinor must be a positive integer",
  "amountSats must be a positive integer",
  "bolt11 must be a Lightning invoice",
  "channel must be email or sms",
  "contactKind must be email or phone",
  "currency must match the club currency",
  "date filter must be a date-time",
  "date filter must be a string",
  "date must be YYYY-MM-DD",
  "date must be YYYY-MM-DD and times must be HH:MM",
  "days must list weekday numbers 0-6",
  "defaultLocale is not a supported language",
  "deviceId must be letters, numbers, _ or -",
  "direction must be credit or debit",
  "email must be an email address",
  "from and to are required",
  "from must be before to",
  "identity.kind must be nfc-sun, nfc-desfire, nfc-uid, or lnurl",
  "links must be a list",
  "locale is not a supported language",
  "marketingConsent must be boolean",
  "method must be lightning, stripe, or square",
  "period must be visit, day, week, or month",
  "preferredLocale is not a supported language",
  "receiptEmail must be an email address",
  "requestId must be 1-80 letters, numbers, or . _ : -",
  "requestId was already used",
  "role must be owner, manager, front-desk, or coach",
  "role must be primary or dependent",
  "times must be HH:MM",
  "unit must be minor or sats",
] as const;

export const ERROR_TEMPLATES: Record<string, string> = {
  "errors.field-own-name": "{field} must be your club's own name. BitPadel is the kit placeholder, not a club brand.",
  "errors.field-integer-range": "{field} must be an integer from {min} to {max}",
  "errors.field-max-length": "{field} must be at most {max} characters",
  "errors.field-length-between": "{field} must be {min}-{max} characters",
  "errors.field-length": "{field} must be 1-{max} characters",
  "errors.field-hex": "{field} must be a 6-digit hex color",
  "errors.field-datetime": "{field} must be a date-time",
  "errors.field-date-or-iso": "{field} must be YYYY-MM-DD or an ISO time",
  "errors.field-string": "{field} must be a string",
  "errors.field-text": "{field} must be text",
  "errors.field-invalid-characters": "{field} contains invalid characters",
  "errors.field-required": "{field} is required",
  "errors.field-invalid": "{field} is invalid",
  "errors.field-too-long": "{field} is too long",
  "errors.links-max": "At most {max} footer links",
  "errors.email-http": "Email provider returned HTTP {status}",
  "errors.photo-too-large": "Photo must be {bytes} bytes or smaller",
  "errors.sms-http": "SMS provider returned HTTP {status}",
  "errors.sms-webhook-http": "SMS webhook returned HTTP {status}",
  "errors.refund-over-paid": "The refund invoice asks for more than the {limit} sats that were paid",
  "errors.unknown-adjustment": "Unknown adjustment {value}",
  "errors.unknown-card-presentation-value": "Unknown card presentation {value}",
  "errors.unknown-payment-method": "Unknown payment method {value}",
  "errors.unknown-unit": "Unknown unit {value}",
  "errors.file-type": "Use a {allowed} file.",
  "errors.payment-http-detail": "Payment backend returned HTTP {status}: {detail}",
  "errors.payment-http": "Payment backend returned HTTP {status}",
  "errors.admin-token-detail": "Admin token required: {detail}",
};

const EXACT_CODES: Record<string, string> = {};
for (const message of EXACT_ERROR_MESSAGES) {
  EXACT_CODES[message] = `errors.${slug(message)}`;
}

export function errorCodeFor(message: string): string {
  return classifyError(message).code;
}

export function classifyError(message: string): ClassifiedError {
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(message);
    if (match) return { code: pattern.code, params: pattern.params(match) };
  }
  const code = EXACT_CODES[message];
  if (code) return { code, params: {} };
  return { code: "errors.unlisted", params: {} };
}

export function errorPayload(message: string): { error: string; code: string; params?: Record<string, string> } {
  const classified = classifyError(message);
  const body: { error: string; code: string; params?: Record<string, string> } = {
    error: message,
    code: classified.code,
  };
  if (Object.keys(classified.params).length > 0) body.params = classified.params;
  return body;
}

function slug(message: string): string {
  const trailingDot = message.endsWith(".") ? "-dot" : "";
  const body = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${body}${trailingDot}`;
}
