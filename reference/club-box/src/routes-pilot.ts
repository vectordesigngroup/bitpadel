import type { AppDeps } from "./deps.js";
import { AppError } from "./errors.js";
import { many, one } from "./db.js";
import { newId } from "./ids.js";
import { readJson, requireAdmin, sendJson, sendText, type HttpReq, type Route } from "./http.js";
import { applyPaymentEvent } from "./booking/service.js";
import { cancelPlayerBooking } from "./player/cancel.js";
import {
  normalizeEmail,
  openPlayerSession,
  playerCookie,
  playerFromRequest,
  requestPlayerCode,
} from "./player/service.js";
import { dailySummary, summaryText } from "./reports/daily.js";
import { sendTransactional } from "./notify/service.js";
import { listStaffActions, staffActionsCsv } from "./staff/audit.js";
import { asObject, requiredInt, requiredString } from "./validate.js";

export function pilotRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "POST", pattern: "/api/player/code", handler: (req) => playerCode(req, ctx) },
    { method: "POST", pattern: "/api/player/session", handler: (req) => playerSession(req, ctx) },
    { method: "GET", pattern: "/api/player/bookings", handler: (req) => playerBookings(req, ctx) },
    { method: "POST", pattern: "/api/player/bookings/:id/cancel", handler: (req) => playerCancel(req, ctx) },
    { method: "GET", pattern: "/api/admin/price-rules", handler: (req) => listRules(req, ctx) },
    { method: "POST", pattern: "/api/admin/price-rules", handler: (req) => createRule(req, ctx) },
    { method: "POST", pattern: "/api/admin/price-rules/:id/delete", handler: (req) => deleteRule(req, ctx) },
    { method: "GET", pattern: "/api/admin/staff-actions", handler: (req) => staffActions(req, ctx) },
    { method: "GET", pattern: "/api/admin/staff-actions.csv", handler: (req) => staffActionsExport(req, ctx) },
    { method: "GET", pattern: "/api/admin/reports/daily", handler: (req) => daily(req, ctx) },
    { method: "POST", pattern: "/api/admin/reports/daily/email", handler: (req) => dailyEmail(req, ctx) },
    { method: "POST", pattern: "/api/webhooks/stripe", handler: (req) => stripeWebhook(req, ctx) },
    { method: "POST", pattern: "/api/webhooks/square", handler: (req) => squareWebhook(req, ctx) },
  ];
}

async function playerCode(req: HttpReq, ctx: AppDeps): Promise<void> {
  if (!ctx.limiters.callbacks.allow(`player-code:${req.ip}`)) {
    throw new AppError(429, "Too many attempts. Wait a moment.");
  }
  const body = asObject(readJson(req));
  const email = normalizeEmail(requiredString(body, "email", 200));
  await requestPlayerCode(ctx.db, ctx.notifier, ctx.config, email, ctx.now());
  sendJson(req.res, 200, { sent: true });
}

function playerSession(req: HttpReq, ctx: AppDeps): Promise<void> {
  if (!ctx.limiters.callbacks.allow(`player-session:${req.ip}`)) {
    throw new AppError(429, "Too many attempts. Wait a moment.");
  }
  const body = asObject(readJson(req));
  const email = normalizeEmail(requiredString(body, "email", 200));
  const code = requiredString(body, "code", 12);
  const opened = openPlayerSession(ctx.db, email, code, ctx.now(), ctx.config.sessionTtlHours);
  if (!opened) throw new AppError(401, "That code is wrong or expired");
  sendJson(
    req.res,
    200,
    { player: opened.player },
    {
      "set-cookie": playerCookie(
        opened.token,
        ctx.config.sessionTtlHours * 3600,
        ctx.config.publicBaseUrl.startsWith("https://"),
      ),
    },
  );
  return Promise.resolve();
}

function playerBookings(req: HttpReq, ctx: AppDeps): Promise<void> {
  const player = playerFromRequest(ctx.db, req.headers, ctx.now());
  if (!player) throw new AppError(401, "Player login required");
  const upcoming = many<{
    id: string;
    court_name: string;
    starts_at: string;
    ends_at: string;
    amount_minor: number;
    currency: string;
    payment_method: string;
  }>(
    ctx.db,
    `SELECT b.id, c.name AS court_name, s.starts_at, s.ends_at, b.amount_minor, b.currency, b.payment_method
     FROM bookings b
     JOIN slots s ON s.id = b.slot_id
     JOIN courts c ON c.id = s.court_id
     WHERE b.player_id = ? AND s.starts_at >= ?
     ORDER BY s.starts_at ASC`,
    player.id,
    ctx.now().toISOString(),
  );
  const past = many<{
    id: string;
    court_name: string;
    starts_at: string;
    ends_at: string;
    amount_minor: number;
    currency: string;
    payment_method: string;
    cancelled_at: string | null;
  }>(
    ctx.db,
    `SELECT b.id, c.name AS court_name, s.starts_at, s.ends_at, b.amount_minor, b.currency, b.payment_method,
            NULL AS cancelled_at
     FROM bookings b
     JOIN slots s ON s.id = b.slot_id
     JOIN courts c ON c.id = s.court_id
     WHERE b.player_id = ? AND s.starts_at < ?
     UNION ALL
     SELECT cb.id, c.name, s.starts_at, s.ends_at, cb.amount_minor, cb.currency, cb.payment_method, cb.cancelled_at
     FROM cancelled_bookings cb
     JOIN slots s ON s.id = cb.slot_id
     JOIN courts c ON c.id = s.court_id
     WHERE cb.player_id = ?
     ORDER BY starts_at DESC
     LIMIT 50`,
    player.id,
    ctx.now().toISOString(),
    player.id,
  );
  sendJson(req.res, 200, {
    player,
    cancelWindowHours: ctx.config.cancelWindowHours,
    cancelRefund: ctx.config.cancelRefund,
    upcoming: upcoming.map(bookingJson),
    past: past.map((row) => ({ ...bookingJson(row), cancelledAt: row.cancelled_at })),
  });
  return Promise.resolve();
}

async function playerCancel(req: HttpReq, ctx: AppDeps): Promise<void> {
  const player = playerFromRequest(ctx.db, req.headers, ctx.now());
  if (!player) throw new AppError(401, "Player login required");
  const result = await cancelPlayerBooking(
    ctx.db,
    ctx.config,
    ctx.payments,
    ctx.cards,
    player.id,
    req.params.id ?? "",
    ctx.now(),
  );
  sendJson(req.res, 200, result);
}

function listRules(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const rules = many<{
    id: string;
    court_id: string | null;
    label: string;
    days: string;
    start_min: number;
    end_min: number;
    member_price_minor: number;
    guest_price_minor: number;
  }>(
    ctx.db,
    `SELECT id, court_id, label, days, start_min, end_min, member_price_minor, guest_price_minor
     FROM price_rules ORDER BY created_at ASC`,
  );
  sendJson(req.res, 200, {
    rules: rules.map((rule) => ({
      id: rule.id,
      courtId: rule.court_id,
      label: rule.label,
      days: rule.days,
      startMin: rule.start_min,
      endMin: rule.end_min,
      memberPriceMinor: rule.member_price_minor,
      guestPriceMinor: rule.guest_price_minor,
    })),
  });
  return Promise.resolve();
}

function createRule(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const label = requiredString(body, "label", 80);
  const days = parseDays(body.days);
  const startMin = clockMinutes(requiredString(body, "start", 5));
  const endMin = clockMinutes(requiredString(body, "end", 5));
  const memberPriceMinor = requiredInt(body, "memberPriceMinor", 1, 100_000_000);
  const guestPriceMinor = requiredInt(body, "guestPriceMinor", 1, 100_000_000);
  const courtId = optionalCourt(body);
  if (courtId) {
    const court = one<{ id: string }>(ctx.db, "SELECT id FROM courts WHERE id = ?", courtId);
    if (!court) throw new AppError(404, "Court not found");
  }
  const id = newId("price");
  ctx.db
    .prepare(
      `INSERT INTO price_rules (
         id, court_id, label, days, start_min, end_min, member_price_minor, guest_price_minor, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, courtId, label, days, startMin, endMin, memberPriceMinor, guestPriceMinor, ctx.now().toISOString());
  sendJson(req.res, 201, { id });
  return Promise.resolve();
}

function deleteRule(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const info = ctx.db.prepare("DELETE FROM price_rules WHERE id = ?").run(req.params.id ?? "");
  if (info.changes !== 1) throw new AppError(404, "Price rule was not found");
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function staffActions(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendJson(req.res, 200, { actions: listStaffActions(ctx.db, 200) });
  return Promise.resolve();
}

function staffActionsExport(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendText(req.res, 200, staffActionsCsv(listStaffActions(ctx.db, 1000)), "text/csv; charset=utf-8", {
    "content-disposition": "attachment; filename=\"staff-actions.csv\"",
  });
  return Promise.resolve();
}

function daily(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const date = req.url.searchParams.get("date") ?? ctx.now().toISOString().slice(0, 10);
  sendJson(req.res, 200, { summary: dailySummary(ctx.db, ctx.config, date) });
  return Promise.resolve();
}

async function dailyEmail(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const date = typeof body.date === "string" && body.date ? body.date : ctx.now().toISOString().slice(0, 10);
  const to = ctx.config.dailySummaryEmail ?? ctx.config.notifyAdminEmail;
  if (!to) throw new AppError(400, "Set DAILY_SUMMARY_EMAIL or NOTIFY_ADMIN_EMAIL");
  const summary = dailySummary(ctx.db, ctx.config, date);
  await sendTransactional(ctx.notifier, {
    channel: "email",
    kind: "transactional",
    to,
    subject: `Daily sales ${summary.date}`,
    text: summaryText(summary),
  });
  sendJson(req.res, 200, { sent: true, date: summary.date });
}

async function stripeWebhook(req: HttpReq, ctx: AppDeps): Promise<void> {
  const stripe = ctx.cards.get("stripe");
  if (!stripe) throw new AppError(404, "Stripe webhooks are not enabled");
  const event = await stripe.interpretWebhook({ headers: req.headers, rawBody: req.rawBody, nowIso: ctx.now().toISOString() });
  const result = applyPaymentEvent(ctx.db, event, ctx.now());
  sendJson(req.res, 200, { outcome: result.outcome });
}

async function squareWebhook(req: HttpReq, ctx: AppDeps): Promise<void> {
  const square = ctx.cards.get("square");
  if (!square) throw new AppError(404, "Square webhooks are not enabled");
  const event = await square.interpretWebhook({ headers: req.headers, rawBody: req.rawBody, nowIso: ctx.now().toISOString() });
  const result = applyPaymentEvent(ctx.db, event, ctx.now());
  sendJson(req.res, 200, { outcome: result.outcome });
}

function bookingJson(row: {
  id: string;
  court_name: string;
  starts_at: string;
  ends_at: string;
  amount_minor: number;
  currency: string;
  payment_method: string;
}): {
  id: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  amountMinor: number;
  currency: string;
  paymentMethod: string;
} {
  return {
    id: row.id,
    courtName: row.court_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    amountMinor: row.amount_minor,
    currency: row.currency,
    paymentMethod: row.payment_method,
  };
}

function parseDays(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) throw new AppError(400, "days must list weekday numbers 0-6");
  const days: string[] = [];
  for (const day of value) {
    if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
      throw new AppError(400, "days must list weekday numbers 0-6");
    }
    const text = String(day);
    if (!days.includes(text)) days.push(text);
  }
  return days.join(",");
}

function clockMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new AppError(400, "times must be HH:MM");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new AppError(400, "times must be HH:MM");
  return hour * 60 + minute;
}

function optionalCourt(body: Record<string, unknown>): string | null {
  if (body.courtId === undefined || body.courtId === null || body.courtId === "") return null;
  return requiredString(body, "courtId", 80);
}
