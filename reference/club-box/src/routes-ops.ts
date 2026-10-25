import { one } from "./db.js";
import type { AppDeps } from "./deps.js";
import { AppError } from "./errors.js";
import {
  credentialToken,
  readJson,
  requireAdmin,
  sendJson,
  sendText,
  sessionCookie,
  type HttpReq,
  type Route,
} from "./http.js";
import { newId } from "./ids.js";
import { refundCharge } from "./player/cancel.js";
import { sendMarketing } from "./notify/service.js";
import type { Channel } from "./notify/types.js";
import { parseReportRange, salesCsv, salesRows } from "./reports/sales.js";
import { actorAllows, resolveActor, type Actor } from "./staff/gate.js";
import { isStaffRole, type StaffRole } from "./staff/permissions.js";
import {
  createStaffAccount,
  deleteSession,
  disableStaffAccount,
  listStaff,
  loginStaff,
} from "./staff/service.js";
import { asObject, requiredString } from "./validate.js";

export function opsRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "POST", pattern: "/api/session/login", handler: (req) => login(req, ctx) },
    { method: "POST", pattern: "/api/session/logout", handler: (req) => logout(req, ctx) },
    { method: "GET", pattern: "/api/admin/staff", handler: (req) => staffList(req, ctx) },
    { method: "POST", pattern: "/api/admin/staff", handler: (req) => staffCreate(req, ctx) },
    { method: "POST", pattern: "/api/admin/staff/:id/disable", handler: (req) => staffDisable(req, ctx) },
    { method: "GET", pattern: "/api/admin/reports/sales.csv", handler: (req) => sales(req, ctx) },
    { method: "POST", pattern: "/api/admin/bookings/:id/refund", handler: (req) => refund(req, ctx) },
    { method: "GET", pattern: "/api/admin/payments/health", handler: (req) => paymentHealth(req, ctx) },
    { method: "POST", pattern: "/api/admin/marketing/send", handler: (req) => marketingSend(req, ctx) },
  ];
}

async function login(req: HttpReq, ctx: AppDeps): Promise<void> {
  if (!ctx.limiters.callbacks.allow(`login:${req.ip}`)) {
    throw new AppError(429, "Too many attempts. Wait a moment.");
  }
  const body = asObject(readJson(req));
  const username = requiredString(body, "username", 40).toLowerCase();
  const password = requiredString(body, "password", 200);
  const result = loginStaff(ctx.db, username, password, ctx.now(), ctx.config.sessionTtlHours);
  if (!result) throw new AppError(401, "Username or password is wrong");
  sendJson(
    req.res,
    200,
    { token: result.token, role: result.role, displayName: result.displayName },
    { "set-cookie": sessionCookie(result.token, ctx.config.sessionTtlHours * 3600, ctx.config.publicBaseUrl.startsWith("https://")) },
  );
}

function logout(req: HttpReq, ctx: AppDeps): Promise<void> {
  const token = credentialToken(req);
  if (token) deleteSession(ctx.db, token);
  sendJson(req.res, 200, { ok: true }, {
    "set-cookie": sessionCookie("", 0, ctx.config.publicBaseUrl.startsWith("https://")),
  });
  return Promise.resolve();
}

function staffList(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendJson(req.res, 200, { staff: listStaff(ctx.db) });
  return Promise.resolve();
}

function staffCreate(req: HttpReq, ctx: AppDeps): Promise<void> {
  const actor = adminActor(req, ctx);
  const body = asObject(readJson(req));
  const role = requiredString(body, "role", 16);
  if (!isStaffRole(role)) throw new AppError(400, "role must be owner, manager, front-desk, or coach");
  const account = createStaffAccount(ctx.db, assigner(actor), {
    username: requiredString(body, "username", 40).toLowerCase(),
    password: requiredString(body, "password", 200),
    displayName: requiredString(body, "displayName", 80),
    role,
    now: ctx.now(),
  });
  sendJson(req.res, 201, { staff: account });
  return Promise.resolve();
}

function staffDisable(req: HttpReq, ctx: AppDeps): Promise<void> {
  const actor = adminActor(req, ctx);
  disableStaffAccount(ctx.db, assigner(actor), req.params.id ?? "", ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function sales(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const range = parseReportRange(req.url.searchParams.get("from"), req.url.searchParams.get("to"));
  sendText(req.res, 200, salesCsv(salesRows(ctx.db, range.fromIso, range.toIso)), "text/csv; charset=utf-8", {
    "content-disposition": "attachment; filename=\"sales.csv\"",
  });
  return Promise.resolve();
}

async function refund(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const reason = requiredString(body, "reason", 200);
  const bolt11 = optionalBolt11(body);
  const bookingId = req.params.id ?? "";
  const row = one<{
    invoice_id: string;
    amount_minor: number;
    currency: string;
    payment_method: string;
    payment_hash: string | null;
    bolt11: string | null;
  }>(
    ctx.db,
    `SELECT h.invoice_id, b.amount_minor, b.currency, b.payment_method, h.payment_hash, h.bolt11
     FROM bookings b
     JOIN holds h ON h.id = b.hold_id
     WHERE b.id = ?`,
    bookingId,
  );
  if (!row) throw new AppError(404, "Booking was not found");
  const result = await refundCharge(
    ctx.payments,
    ctx.cards,
    { ...row, bolt11: bolt11 ?? row.bolt11 },
    reason,
  );
  if (!result.supported) throw new AppError(409, result.reason);
  ctx.db
    .prepare(
      `INSERT INTO refunds (
         id, booking_id, invoice_id, amount_minor, currency, status, provider_refund_id, reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("rfd"),
      bookingId,
      row.invoice_id,
      row.amount_minor,
      row.currency,
      result.status,
      result.refundId,
      reason,
      ctx.now().toISOString(),
    );
  sendJson(req.res, 200, { refundId: result.refundId, status: result.status });
}

async function paymentHealth(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendJson(req.res, 200, await ctx.payments.health());
}

async function marketingSend(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const channel = requiredString(body, "channel", 8);
  if (!isChannel(channel)) throw new AppError(400, "channel must be email or sms");
  const sent = await sendMarketing(ctx.db, ctx.notifier, {
    channel,
    kind: "marketing",
    to: requiredString(body, "to", 200),
    subject: channel === "email" ? requiredString(body, "subject", 120) : null,
    text: requiredString(body, "text", 2000),
  });
  sendJson(req.res, 200, sent);
}

function adminActor(req: HttpReq, ctx: AppDeps): Actor {
  requireAdmin(req, ctx);
  const actor = resolveActor(req, ctx.config, ctx.db, ctx.now());
  if (!actor || !actorAllows(actor, "admin") || actor.kind === "legacy-staff") {
    throw new AppError(401, "Admin token required");
  }
  return actor;
}

function assigner(actor: Actor): { kind: "legacy-admin" } | { kind: "account"; role: StaffRole; accountId: string } {
  switch (actor.kind) {
    case "legacy-admin":
      return { kind: "legacy-admin" };
    case "account":
      return { kind: "account", role: actor.role, accountId: actor.accountId };
    case "legacy-staff":
      throw new AppError(401, "Admin token required");
    default: {
      const unknown: never = actor;
      throw new AppError(401, `Admin token required: ${String(unknown)}`);
    }
  }
}

function optionalBolt11(body: Record<string, unknown>): string | null {
  if (typeof body.bolt11 !== "string" || body.bolt11.trim().length === 0) return null;
  const bolt11 = body.bolt11.trim();
  if (bolt11.length > 2000 || !/^(lnbc|lntb|lnbcrt|lnsb)/i.test(bolt11)) {
    throw new AppError(400, "bolt11 must be a Lightning invoice");
  }
  return bolt11;
}

function isChannel(value: string): value is Channel {
  return value === "email" || value === "sms";
}
