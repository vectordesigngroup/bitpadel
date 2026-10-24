import {
  applyPaymentEvent,
  bookingsCsv,
  cancelSlot,
  createCourt,
  createSlot,
  deactivateCourt,
  generateSlots,
  getHold,
  holdBolt11,
  holdSlot,
  listBookings,
  listCourts,
  listSlots,
  setSlotPrice,
} from "./booking/service.js";
import {
  challengeQrText,
  challengeStatus,
  createMember,
  handleEnroll,
  handleUnlock,
  listAudit,
  listMembers,
  lnurlDocument,
  mintEnrollChallenge,
  mintUnlockChallenge,
  revokeKey,
  setMemberStatus,
} from "./access/service.js";
import { one } from "./db.js";
import type { AppDeps } from "./deps.js";
import { AppError } from "./errors.js";
import { readJson, requireAdmin, sendBytes, sendJson, sendText, type HttpReq, type Route } from "./http.js";
import { log } from "./log.js";
import { pngQr } from "./qr.js";
import { SAFETY } from "./safety.js";
import {
  asObject,
  assertAreaId,
  optionalIso,
  requiredInt,
  requiredIso,
  requiredString,
} from "./validate.js";

const PRICE_CAP = Number.MAX_SAFE_INTEGER;

export function buildRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "GET", pattern: "/api/health", handler: (req) => health(req, ctx) },
    { method: "GET", pattern: "/api/courts", handler: (req) => publicCourts(req, ctx) },
    { method: "GET", pattern: "/api/slots", handler: (req) => publicSlots(req, ctx) },
    { method: "POST", pattern: "/api/holds", handler: (req) => createHold(req, ctx) },
    { method: "GET", pattern: "/api/holds/:id", handler: (req) => readHold(req, ctx) },
    { method: "GET", pattern: "/api/holds/:id/qr.png", handler: (req) => holdQr(req, ctx) },
    { method: "POST", pattern: "/api/webhooks/btcpay", handler: (req) => btcpayWebhook(req, ctx) },
    { method: "POST", pattern: "/api/webhooks/lnbits/:secret", handler: (req) => lnbitsWebhook(req, ctx) },
    { method: "POST", pattern: "/api/access/challenges", handler: (req) => mintDoorChallenge(req, ctx) },
    { method: "GET", pattern: "/api/access/challenges/:k1", handler: (req) => readChallenge(req, ctx) },
    { method: "GET", pattern: "/api/access/challenges/:k1/qr.png", handler: (req) => challengeQr(req, ctx) },
    { method: "GET", pattern: "/api/access/lnurl", handler: (req) => walletLnurl(req, ctx, "unlock") },
    { method: "GET", pattern: "/api/access/callback", handler: (req) => walletUnlock(req, ctx) },
    { method: "GET", pattern: "/api/access/enroll/lnurl", handler: (req) => walletLnurl(req, ctx, "enroll") },
    { method: "GET", pattern: "/api/access/enroll/callback", handler: (req) => walletEnroll(req, ctx) },
    { method: "GET", pattern: "/api/admin/config", handler: (req) => adminConfig(req, ctx) },
    { method: "GET", pattern: "/api/admin/courts", handler: (req) => adminCourts(req, ctx) },
    { method: "POST", pattern: "/api/admin/courts", handler: (req) => adminCreateCourt(req, ctx) },
    { method: "POST", pattern: "/api/admin/courts/:id/deactivate", handler: (req) => adminDeactivateCourt(req, ctx) },
    { method: "GET", pattern: "/api/admin/slots", handler: (req) => adminSlots(req, ctx) },
    { method: "POST", pattern: "/api/admin/slots", handler: (req) => adminCreateSlot(req, ctx) },
    { method: "POST", pattern: "/api/admin/slots/generate", handler: (req) => adminGenerateSlots(req, ctx) },
    { method: "POST", pattern: "/api/admin/slots/:id/price", handler: (req) => adminSetPrice(req, ctx) },
    { method: "POST", pattern: "/api/admin/slots/:id/cancel", handler: (req) => adminCancelSlot(req, ctx) },
    { method: "GET", pattern: "/api/admin/bookings", handler: (req) => adminBookings(req, ctx) },
    { method: "GET", pattern: "/api/admin/bookings.csv", handler: (req) => adminBookingsCsv(req, ctx) },
    { method: "POST", pattern: "/api/admin/holds/:id/simulate-payment", handler: (req) => simulatePayment(req, ctx) },
    { method: "GET", pattern: "/api/admin/members", handler: (req) => adminMembers(req, ctx) },
    { method: "POST", pattern: "/api/admin/members", handler: (req) => adminCreateMember(req, ctx) },
    { method: "POST", pattern: "/api/admin/members/:id/revoke", handler: (req) => adminMemberStatus(req, ctx, "revoked") },
    { method: "POST", pattern: "/api/admin/members/:id/restore", handler: (req) => adminMemberStatus(req, ctx, "active") },
    { method: "POST", pattern: "/api/admin/members/:id/enroll", handler: (req) => adminEnroll(req, ctx) },
    { method: "POST", pattern: "/api/admin/keys/:id/revoke", handler: (req) => adminRevokeKey(req, ctx) },
    { method: "GET", pattern: "/api/admin/audit", handler: (req) => adminAudit(req, ctx) },
  ];
}

function health(req: HttpReq, ctx: AppDeps): Promise<void> {
  sendJson(req.res, 200, {
    ok: true,
    paymentBackend: ctx.config.paymentBackend,
    doorBackend: ctx.config.doorBackend,
    currency: ctx.config.currency,
    currencyDecimals: ctx.config.currencyDecimals,
    areas: ctx.config.areas,
    areaHours: ctx.config.areaHours,
    clubTimeZone: ctx.config.clubTimeZone,
    holdMinutes: ctx.config.holdMinutes,
    ...SAFETY,
  });
  return Promise.resolve();
}

function publicCourts(req: HttpReq, ctx: AppDeps): Promise<void> {
  sendJson(req.res, 200, { courts: listCourts(ctx.db, true) });
  return Promise.resolve();
}

function publicSlots(req: HttpReq, ctx: AppDeps): Promise<void> {
  sendJson(req.res, 200, { slots: slotsFor(req, ctx, false) });
  return Promise.resolve();
}

async function createHold(req: HttpReq, ctx: AppDeps): Promise<void> {
  if (!ctx.limiters.holds.allow(`ip:${req.ip}`)) {
    throw new AppError(429, "Too many hold attempts. Wait a moment.");
  }
  const body = asObject(readJson(req));
  const slotId = requiredString(body, "slotId", 80);
  const hold = await holdSlot(ctx.db, ctx.config, ctx.payments, slotId, ctx.now());
  sendJson(req.res, 201, { hold });
}

function readHold(req: HttpReq, ctx: AppDeps): Promise<void> {
  const hold = getHold(ctx.db, req.params.id ?? "", ctx.now());
  if (!hold) throw new AppError(404, "Hold not found");
  sendJson(req.res, 200, { hold });
  return Promise.resolve();
}

async function holdQr(req: HttpReq, ctx: AppDeps): Promise<void> {
  const bolt11 = holdBolt11(ctx.db, req.params.id ?? "", ctx.now());
  if (!bolt11) throw new AppError(404, "Hold not found");
  sendBytes(req.res, 200, await pngQr(bolt11), "image/png");
}

async function btcpayWebhook(req: HttpReq, ctx: AppDeps): Promise<void> {
  if (ctx.config.paymentBackend !== "btcpay") throw new AppError(404, "BTCPay webhooks are not enabled");
  await settleWebhook(req, ctx);
}

async function lnbitsWebhook(req: HttpReq, ctx: AppDeps): Promise<void> {
  if (ctx.config.paymentBackend !== "lnbits") throw new AppError(404, "LNbits webhooks are not enabled");
  await settleWebhook(req, ctx);
}

async function settleWebhook(req: HttpReq, ctx: AppDeps): Promise<void> {
  const event = await ctx.payments.interpretWebhook({
    headers: req.headers,
    rawBody: req.rawBody,
    nowIso: ctx.now().toISOString(),
    pathSecret: req.params.secret,
  });
  const result = applyPaymentEvent(ctx.db, event, ctx.now());
  log("info", "payment notice", { backend: ctx.payments.name, outcome: result.outcome });
  sendJson(req.res, 200, result);
}

function mintDoorChallenge(req: HttpReq, ctx: AppDeps): Promise<void> {
  if (!ctx.limiters.challenges.allow(`ip:${req.ip}`)) {
    throw new AppError(429, "Too many codes. Wait a moment.");
  }
  const body = asObject(readJson(req));
  const area = requiredString(body, "area", 41).toLowerCase();
  assertAreaId(area, ctx.config.areas);
  const challenge = mintUnlockChallenge(accessDeps(ctx), area);
  sendJson(req.res, 201, { challenge });
  return Promise.resolve();
}

function readChallenge(req: HttpReq, ctx: AppDeps): Promise<void> {
  const challenge = challengeStatus(accessDeps(ctx), req.params.k1 ?? "");
  if (!challenge) throw new AppError(404, "Code not found");
  sendJson(req.res, 200, { challenge });
  return Promise.resolve();
}

async function challengeQr(req: HttpReq, ctx: AppDeps): Promise<void> {
  const text = challengeQrText(accessDeps(ctx), req.params.k1 ?? "");
  if (!text) throw new AppError(404, "Code not found");
  sendBytes(req.res, 200, await pngQr(text), "image/png");
}

function walletLnurl(req: HttpReq, ctx: AppDeps, purpose: "unlock" | "enroll"): Promise<void> {
  const k1 = req.url.searchParams.get("k1") ?? "";
  sendJson(req.res, 200, lnurlDocument(accessDeps(ctx), k1, purpose));
  return Promise.resolve();
}

async function walletUnlock(req: HttpReq, ctx: AppDeps): Promise<void> {
  const result = await handleUnlock(accessDeps(ctx), callbackQuery(req));
  sendJson(req.res, 200, result);
}

function walletEnroll(req: HttpReq, ctx: AppDeps): Promise<void> {
  const result = handleEnroll(accessDeps(ctx), callbackQuery(req));
  sendJson(req.res, 200, result);
  return Promise.resolve();
}

function adminConfig(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  sendJson(req.res, 200, {
    currency: ctx.config.currency,
    currencyDecimals: ctx.config.currencyDecimals,
    defaultSlotPriceMinor: ctx.config.defaultSlotPriceMinor,
    satsPerMinorUnit: ctx.config.satsPerMinorUnit,
    areas: ctx.config.areas,
    areaHours: ctx.config.areaHours,
    clubTimeZone: ctx.config.clubTimeZone,
    paymentBackend: ctx.config.paymentBackend,
    doorBackend: ctx.config.doorBackend,
    holdMinutes: ctx.config.holdMinutes,
    k1TtlSeconds: ctx.config.k1TtlSeconds,
    logRetentionDays: ctx.config.logRetentionDays,
    ...SAFETY,
  });
  return Promise.resolve();
}

function adminCourts(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  sendJson(req.res, 200, { courts: listCourts(ctx.db, false) });
  return Promise.resolve();
}

function adminCreateCourt(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  const body = asObject(readJson(req));
  const court = createCourt(ctx.db, requiredString(body, "name", 60), ctx.now());
  sendJson(req.res, 201, { court });
  return Promise.resolve();
}

function adminDeactivateCourt(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  deactivateCourt(ctx.db, req.params.id ?? "");
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function adminSlots(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  sendJson(req.res, 200, { slots: slotsFor(req, ctx, true) });
  return Promise.resolve();
}

function adminCreateSlot(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  const body = asObject(readJson(req));
  const slot = createSlot(
    ctx.db,
    {
      courtId: requiredString(body, "courtId", 80),
      startsAt: requiredIso(body, "startsAt"),
      endsAt: requiredIso(body, "endsAt"),
      priceMinor: priceFrom(body, ctx),
      currency: ctx.config.currency,
    },
    ctx.now(),
  );
  sendJson(req.res, 201, { slot });
  return Promise.resolve();
}

function adminGenerateSlots(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  const body = asObject(readJson(req));
  const date = requiredString(body, "date", 10);
  const startTime = requiredString(body, "startTime", 5);
  const endTime = requiredString(body, "endTime", 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new AppError(400, "date must be YYYY-MM-DD and times must be HH:MM");
  }
  const slots = generateSlots(
    ctx.db,
    {
      courtId: requiredString(body, "courtId", 80),
      date,
      startTime,
      endTime,
      slotMinutes: requiredInt(body, "slotMinutes", 15, 1440),
      priceMinor: priceFrom(body, ctx),
      currency: ctx.config.currency,
      timeZone: ctx.config.clubTimeZone,
    },
    ctx.now(),
  );
  sendJson(req.res, 201, { slots });
  return Promise.resolve();
}

function adminSetPrice(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  const body = asObject(readJson(req));
  const slot = setSlotPrice(ctx.db, req.params.id ?? "", requiredInt(body, "priceMinor", 1, PRICE_CAP));
  sendJson(req.res, 200, { slot });
  return Promise.resolve();
}

function adminCancelSlot(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  cancelSlot(ctx.db, req.params.id ?? "");
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function adminBookings(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  sendJson(req.res, 200, { bookings: listBookings(ctx.db) });
  return Promise.resolve();
}

function adminBookingsCsv(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  sendText(req.res, 200, bookingsCsv(listBookings(ctx.db)), "text/csv; charset=utf-8", {
    "content-disposition": "attachment; filename=\"bookings.csv\"",
  });
  return Promise.resolve();
}

function simulatePayment(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  if (ctx.config.paymentBackend !== "mock") {
    throw new AppError(404, "Mock settlement is only available when PAYMENT_BACKEND=mock");
  }
  const holdId = req.params.id ?? "";
  const row = one<{ invoice_id: string; payment_hash: string | null; status: string }>(
    ctx.db,
    "SELECT invoice_id, payment_hash, status FROM holds WHERE id = ?",
    holdId,
  );
  if (!row) throw new AppError(404, "Hold not found");
  const result = applyPaymentEvent(
    ctx.db,
    {
      kind: "settled",
      invoiceId: row.invoice_id,
      paymentHash: row.payment_hash,
      settledAt: ctx.now().toISOString(),
    },
    ctx.now(),
  );
  const hold = getHold(ctx.db, holdId, ctx.now());
  sendJson(req.res, 200, { ...result, hold });
  return Promise.resolve();
}

function adminMembers(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  sendJson(req.res, 200, { members: listMembers(ctx.db) });
  return Promise.resolve();
}

function adminCreateMember(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  const body = asObject(readJson(req));
  const member = createMember(ctx.db, requiredString(body, "label", 80), ctx.now());
  sendJson(req.res, 201, { member });
  return Promise.resolve();
}

function adminMemberStatus(req: HttpReq, ctx: AppDeps, status: "active" | "revoked"): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  setMemberStatus(ctx.db, req.params.id ?? "", status);
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function adminEnroll(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  const challenge = mintEnrollChallenge(accessDeps(ctx), req.params.id ?? "");
  sendJson(req.res, 201, {
    challenge,
    enrollPath: `/enroll?k1=${challenge.k1}`,
  });
  return Promise.resolve();
}

function adminRevokeKey(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  revokeKey(ctx.db, req.params.id ?? "", ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function adminAudit(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx.config.adminToken);
  const raw = req.url.searchParams.get("limit");
  const limit = raw === null || raw === "" ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError(400, "limit must be an integer from 1 to 500");
  }
  sendJson(req.res, 200, { audit: listAudit(ctx.db, limit) });
  return Promise.resolve();
}

function slotsFor(req: HttpReq, ctx: AppDeps, admin: boolean) {
  return listSlots(
    ctx.db,
    {
      courtId: req.url.searchParams.get("courtId"),
      from: optionalIso(req.url.searchParams.get("from")),
      to: optionalIso(req.url.searchParams.get("to")),
      includeInactiveCourts: admin,
      includeCancelled: admin,
      includeHoldId: admin,
    },
    ctx.now(),
  );
}

function priceFrom(body: Record<string, unknown>, ctx: AppDeps): number {
  if (body.priceMinor !== undefined) return requiredInt(body, "priceMinor", 1, PRICE_CAP);
  if (ctx.config.defaultSlotPriceMinor == null) {
    throw new AppError(400, "priceMinor is required");
  }
  return ctx.config.defaultSlotPriceMinor;
}

function callbackQuery(req: HttpReq): { k1: string; sig: string; key: string; ip: string } {
  return {
    k1: req.url.searchParams.get("k1") ?? "",
    sig: req.url.searchParams.get("sig") ?? "",
    key: req.url.searchParams.get("key") ?? req.url.searchParams.get("pubkey") ?? "",
    ip: req.ip,
  };
}

function accessDeps(ctx: AppDeps) {
  return {
    config: ctx.config,
    db: ctx.db,
    door: ctx.door,
    now: ctx.now,
    callbacks: ctx.limiters.callbacks,
  };
}
