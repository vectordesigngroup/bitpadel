// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { ConsoleMessageProvider } from "../src/notify/console.js";
import { runDueReminders } from "../src/player/reminders.js";
import { maybeSendDailySummary } from "../src/reports/daily.js";
import {
  ADMIN_TOKEN,
  adminHeaders,
  api,
  createCourtAndSlot,
  freshKey,
  signK1,
  startTestApp,
  type RunningApp,
} from "./helpers.js";

const STRIPE_SECRET = "sk_test_pilot_secret_key_0001";
const STRIPE_WEBHOOK = "whsec_pilot_test_secret";
const SQUARE_TOKEN = "square-sandbox-token-0001";
const SQUARE_KEY = "square-webhook-key-01";
const SQUARE_NOTIFY = "http://127.0.0.1:9/api/webhooks/square";

test("Stripe and Square card checkout settle from signed webhooks and do not request Bitcoin", async () => {
  const seen: Array<{ path: string; body: string }> = [];
  const vendor = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    seen.push({ path: req.url ?? "", body });
    answerVendor(req, res, body);
  });
  await listen(vendor);
  const port = (vendor.address() as AddressInfo).port;
  const app = await startTestApp({
    CARD_PROVIDERS: "stripe,square",
    STRIPE_SECRET_KEY: STRIPE_SECRET,
    STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK,
    STRIPE_API_BASE: `http://127.0.0.1:${port}`,
    SQUARE_ACCESS_TOKEN: SQUARE_TOKEN,
    SQUARE_LOCATION_ID: "LOC_TEST",
    SQUARE_WEBHOOK_SIGNATURE_KEY: SQUARE_KEY,
    SQUARE_API_BASE: `http://127.0.0.1:${port}`,
  });
  try {
    const health = await api(app.baseUrl, "/api/health");
    assert.deepEqual(health.body.cardProviders, ["stripe", "square"]);
    assert.equal(JSON.stringify(health.body).includes(STRIPE_SECRET), false);
    assert.equal(JSON.stringify(health.body).includes(SQUARE_TOKEN), false);
    const script = await fetch(`${app.baseUrl}/booking.js`);
    const source = await script.text();
    assert.match(source, /Card \(Stripe\)/);
    assert.match(source, /Card \(Square\)/);
    assert.equal(source.includes("Bitcoin via Square"), false);

    const stripeSlot = await createCourtAndSlot(app, 1, "Stripe court");
    const stripeHold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: stripeSlot.slotId, method: "stripe" }),
    });
    assert.equal(stripeHold.status, 201);
    const stripe = stripeHold.body.hold as { id: string; paymentMethod: string; checkoutUrl: string; bolt11: string };
    assert.equal(stripe.paymentMethod, "stripe");
    assert.equal(stripe.checkoutUrl, "https://checkout.stripe.test/cs_test_1");
    assert.match(stripe.bolt11, /^card:stripe:/);
    const stripeCall = seen.find((row) => row.path === "/v1/checkout/sessions");
    assert.ok(stripeCall);
    assert.equal(stripeCall.body.includes("bitcoin"), false);

    const bad = await fetch(`${app.baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=00", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(bad.status, 502);

    const stripeEvent = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1", payment_status: "paid", payment_intent: "pi_test_1" } },
    });
    const paid = await fetch(`${app.baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "stripe-signature": stripeSignature(stripeEvent), "content-type": "application/json" },
      body: stripeEvent,
    });
    assert.equal(paid.status, 200);
    assert.equal(((await paid.json()) as { outcome: string }).outcome, "confirmed");

    const squareSlot = await createCourtAndSlot(app, 1, "Square court");
    const squareHold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: squareSlot.slotId, method: "square" }),
    });
    assert.equal(squareHold.status, 201);
    const square = squareHold.body.hold as { paymentMethod: string; checkoutUrl: string };
    assert.equal(square.paymentMethod, "square");
    assert.equal(square.checkoutUrl, "https://square.test/pay");
    const squareCall = seen.find((row) => row.path === "/v2/online-checkout/payment-links");
    assert.ok(squareCall);
    const squareBody = JSON.parse(squareCall.body) as { quick_pay: { price_money: { currency: string } } };
    assert.equal(squareBody.quick_pay.price_money.currency, "XXX");
    assert.equal(JSON.stringify(squareBody).toLowerCase().includes("bitcoin"), false);
    assert.equal(JSON.stringify(squareBody).toLowerCase().includes("lightning"), false);

    const squareEvent = JSON.stringify({
      type: "payment.updated",
      data: { object: { payment: { id: "pay_test_1", order_id: "order_test_1", status: "COMPLETED" } } },
    });
    const squarePaid = await fetch(`${app.baseUrl}/api/webhooks/square`, {
      method: "POST",
      headers: {
        "x-square-hmacsha256-signature": squareSignature(squareEvent),
        "content-type": "application/json",
      },
      body: squareEvent,
    });
    assert.equal(squarePaid.status, 200);

    const rows = app.db.prepare("SELECT id, payment_method FROM bookings").all() as Array<{
      id: string;
      payment_method: string;
    }>;
    const stripeBooking = rows.find((row) => row.payment_method === "stripe");
    const squareBooking = rows.find((row) => row.payment_method === "square");
    assert.ok(stripeBooking && squareBooking);

    const stripeRefund = await api(app.baseUrl, `/api/admin/bookings/${stripeBooking.id}/refund`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ reason: "test refund" }),
    });
    assert.equal(stripeRefund.status, 200);
    assert.equal(stripeRefund.body.refundId, "re_test_1");
    const squareRefund = await api(app.baseUrl, `/api/admin/bookings/${squareBooking.id}/refund`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ reason: "test refund" }),
    });
    assert.equal(squareRefund.status, 200);
    assert.equal(squareRefund.body.refundId, "sq_refund_1");
    assert.ok(seen.some((row) => row.path === "/v1/refunds" && row.body.includes("pi_test_1")));
    assert.ok(seen.some((row) => row.path === "/v2/refunds" && row.body.includes("pay_test_1")));

    const daily = await api(app.baseUrl, "/api/admin/reports/daily?date=2026-06-01", { headers: adminHeaders() });
    const methods = (daily.body.summary as { methods: Array<{ method: string; count: number }> }).methods;
    assert.ok(methods.some((row) => row.method === "stripe" && row.count === 1));
    assert.ok(methods.some((row) => row.method === "square" && row.count === 1));
  } finally {
    await app.close();
    vendor.close();
  }
});

test("a card method stays off until the club enables that provider", async () => {
  const app = await startTestApp();
  try {
    const slot = await createCourtAndSlot(app, 1);
    const held = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot.slotId, method: "square" }),
    });
    assert.equal(held.status, 400);
    assert.match(String(held.body.error), /not enabled/);
    const health = await api(app.baseUrl, "/api/health");
    assert.deepEqual(health.body.cardProviders, []);
  } finally {
    await app.close();
  }
});

test("price rules apply guest, member, and court prices in the club timezone", async () => {
  const app = await startTestApp();
  try {
    const first = await createCourtAndSlot(app, 1, "Court A");
    const second = await createCourtAndSlot(app, 1, "Court B");
    const global = await api(app.baseUrl, "/api/admin/price-rules", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        label: "weekday afternoon",
        days: [1],
        start: "16:00",
        end: "22:00",
        memberPriceMinor: 4,
        guestPriceMinor: 9,
      }),
    });
    assert.equal(global.status, 201);
    const specific = await api(app.baseUrl, "/api/admin/price-rules", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        label: "court A peak",
        courtId: first.courtId,
        days: [1],
        start: "16:00",
        end: "18:00",
        memberPriceMinor: 2,
        guestPriceMinor: 5,
      }),
    });
    assert.equal(specific.status, 201);

    const listed = await api(app.baseUrl, "/api/slots?from=2026-06-01T15:30:00.000Z");
    const slots = listed.body.slots as Array<{
      courtId: string;
      priceMinor: number;
      guestPriceMinor: number;
      memberPriceMinor: number;
    }>;
    const courtA = slots.find((slot) => slot.courtId === first.courtId);
    const courtB = slots.find((slot) => slot.courtId === second.courtId);
    assert.ok(courtA && courtB);
    assert.equal(courtA.priceMinor, 1);
    assert.equal(courtA.guestPriceMinor, 5);
    assert.equal(courtA.memberPriceMinor, 2);
    assert.equal(courtB.guestPriceMinor, 9);
    assert.equal(courtB.memberPriceMinor, 4);

    const guest = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: first.slotId }),
    });
    assert.equal((guest.body.hold as { amountMinor: number }).amountMinor, 5);

    const member = await api(app.baseUrl, "/api/admin/members", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ label: "member-1" }),
    });
    const memberId = (member.body.member as { id: string }).id;
    const profile = await api(app.baseUrl, `/api/admin/members/${memberId}/profile`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ email: "member@example.invalid" }),
    });
    assert.equal(profile.status, 200);
    const cookie = await loginPlayer(app, "member@example.invalid");
    const memberHold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slotId: second.slotId }),
    });
    assert.equal(memberHold.status, 201);
    assert.equal((memberHold.body.hold as { amountMinor: number }).amountMinor, 4);
  } finally {
    await app.close();
  }
});

test("a player can log in, see bookings, get an opt-in reminder, and cancel inside the window", async () => {
  const app = await startTestApp({ CANCEL_WINDOW_HOURS: "1", REMINDER_HOURS_BEFORE: "24" });
  try {
    const account = await fetch(`${app.baseUrl}/account`);
    assert.equal(account.status, 200);
    const email = "player@example.invalid";
    const cookie = await loginPlayer(app, email);
    const again = await api(app.baseUrl, "/api/player/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code: "000000" }),
    });
    assert.equal(again.status, 401);

    const startsAt = new Date(app.now().getTime() + 2 * 60 * 60 * 1000).toISOString();
    const slot = await slotAt(app, startsAt, "Remind court");
    const held = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        slotId: slot.slotId,
        reminderEmail: true,
        reminderSms: false,
      }),
    });
    assert.equal(held.status, 201);
    const holdId = (held.body.hold as { id: string }).id;
    const settled = await api(app.baseUrl, `/api/admin/holds/${holdId}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(settled.status, 200);

    const quietStarts = new Date(app.now().getTime() + 3 * 60 * 60 * 1000).toISOString();
    const quiet = await slotAt(app, quietStarts, "Quiet court");
    const quietHold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slotId: quiet.slotId, reminderEmail: false }),
    });
    await api(app.baseUrl, `/api/admin/holds/${(quietHold.body.hold as { id: string }).id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });

    const emailProvider = consoleEmail(app);
    const before = emailProvider.sent.length;
    const sent = await runDueReminders(app.db, app.notifier, app.config, app.now());
    assert.equal(sent, 1);
    const reminder = emailProvider.sent.slice(before).find((row) => row.to === email);
    assert.ok(reminder);
    assert.equal(reminder.kind, "transactional");
    assert.match(reminder.text, /not marketing/);
    const againSent = await runDueReminders(app.db, app.notifier, app.config, app.now());
    assert.equal(againSent, 0);

    const upcoming = await api(app.baseUrl, "/api/player/bookings", { headers: { cookie } });
    assert.equal(upcoming.status, 200);
    const bookings = upcoming.body.upcoming as Array<{ id: string; courtName: string }>;
    assert.equal(bookings.length, 2);
    const target = bookings.find((row) => row.courtName === "Remind court");
    assert.ok(target);
    const cancelled = await api(app.baseUrl, `/api/player/bookings/${target.id}/cancel`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.refundStatus, "recorded");
    const after = await api(app.baseUrl, "/api/player/bookings", { headers: { cookie } });
    assert.equal((after.body.upcoming as unknown[]).length, 1);
    const past = after.body.past as Array<{ id: string; cancelledAt: string | null }>;
    assert.ok(past.some((row) => row.id === target.id && row.cancelledAt));

    const late = await slotAt(app, new Date(app.now().getTime() + 30 * 60 * 1000).toISOString(), "Soon court");
    const lateHold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slotId: late.slotId }),
    });
    await api(app.baseUrl, `/api/admin/holds/${(lateHold.body.hold as { id: string }).id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const lateList = await api(app.baseUrl, "/api/player/bookings", { headers: { cookie } });
    const lateId = (lateList.body.upcoming as Array<{ id: string; courtName: string }>).find(
      (row) => row.courtName === "Soon court",
    )?.id;
    assert.ok(lateId);
    const refused = await api(app.baseUrl, `/api/player/bookings/${lateId}/cancel`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(refused.status, 409);
  } finally {
    await app.close();
  }
});

test("self-cancel stays off when the club sets the window to zero", async () => {
  const app = await startTestApp({ CANCEL_WINDOW_HOURS: "0" });
  try {
    const cookie = await loginPlayer(app, "off@example.invalid");
    const slot = await createCourtAndSlot(app, 1);
    const held = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slotId: slot.slotId }),
    });
    await api(app.baseUrl, `/api/admin/holds/${(held.body.hold as { id: string }).id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const list = await api(app.baseUrl, "/api/player/bookings", { headers: { cookie } });
    const id = (list.body.upcoming as Array<{ id: string }>)[0]?.id;
    assert.ok(id);
    const cancelled = await api(app.baseUrl, `/api/player/bookings/${id}/cancel`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(cancelled.status, 403);
  } finally {
    await app.close();
  }
});

test("a confirmed booking opens the entry door while the area is otherwise closed", async () => {
  const app = await startTestApp({
    BOOKING_ENTRY: "true",
    BOOKING_ENTRY_BEFORE_MINUTES: "30",
    BOOKING_ENTRY_AFTER_MINUTES: "15",
    ACCESS_AREA_HOURS: "lounge=09:00-10:00",
    CLUB_TIMEZONE: "UTC",
  });
  try {
    const member = await api(app.baseUrl, "/api/admin/members", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ label: "player-member" }),
    });
    const memberId = (member.body.member as { id: string }).id;
    await api(app.baseUrl, `/api/admin/members/${memberId}/profile`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ email: "door@example.invalid" }),
    });
    const signer = await freshKey();
    await enroll(app.baseUrl, memberId, signer);
    const cookie = await loginPlayer(app, "door@example.invalid");
    const slot = await createCourtAndSlot(app, 1, "Door court");
    const held = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slotId: slot.slotId }),
    });
    await api(app.baseUrl, `/api/admin/holds/${(held.body.hold as { id: string }).id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });

    app.setNow(new Date("2026-06-01T15:10:00.000Z"));
    const early = await mint(app.baseUrl);
    assert.equal(early.status, 201);
    const earlySig = await signK1(signer.privateKey, early.k1);
    const denied = await api(app.baseUrl, `/api/access/callback?k1=${early.k1}&sig=${earlySig}&key=${signer.pubkey}`);
    assert.equal(denied.body.status, "ERROR");
    assert.match(String(denied.body.reason), /closed/i);
    assert.equal(app.door.pulses.length, 0);

    app.setNow(new Date("2026-06-01T15:40:00.000Z"));
    const open = await mint(app.baseUrl);
    const openSig = await signK1(signer.privateKey, open.k1);
    const unlocked = await api(app.baseUrl, `/api/access/callback?k1=${open.k1}&sig=${openSig}&key=${signer.pubkey}`);
    assert.equal(unlocked.body.status, "OK");
    assert.equal(app.door.pulses.length, 1);
    const audit = await api(app.baseUrl, "/api/admin/audit", { headers: adminHeaders() });
    const rows = audit.body.audit as Array<{ result: string; reason: string }>;
    assert.ok(rows.some((row) => row.result === "unlocked" && row.reason === "booking-window"));
  } finally {
    await app.close();
  }
});

test("staff audit names the actor and the desk token cannot export it", async () => {
  const app = await startTestApp({ STAFF_TOKEN: "desk-token-0123456789" });
  try {
    const court = await api(app.baseUrl, "/api/admin/courts", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Audit court" }),
    });
    assert.equal(court.status, 201);
    const listed = await api(app.baseUrl, "/api/admin/staff-actions", { headers: adminHeaders() });
    assert.equal(listed.status, 200);
    const actions = listed.body.actions as Array<{ actorLabel: string; method: string; path: string; status: number }>;
    assert.ok(
      actions.some(
        (row) => row.actorLabel === "admin-token" && row.method === "POST" && row.path === "/api/admin/courts" && row.status === 201,
      ),
    );
    const csv = await fetch(`${app.baseUrl}/api/admin/staff-actions.csv`, { headers: adminHeaders() });
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /admin-token/);
    const desk = await api(app.baseUrl, "/api/admin/staff-actions", {
      headers: { authorization: "Bearer desk-token-0123456789" },
    });
    assert.equal(desk.status, 401);
    assert.equal(desk.body.error, "Admin token required");
  } finally {
    await app.close();
  }
});

test("the daily summary totals payment methods and refunds and emails once", async () => {
  const app = await startTestApp({ DAILY_SUMMARY_EMAIL: "owner@example.invalid" });
  try {
    const slot = await createCourtAndSlot(app, 1);
    const held = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot.slotId }),
    });
    const settled = await api(app.baseUrl, `/api/admin/holds/${(held.body.hold as { id: string }).id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const bookingId = (settled.body as { bookingId: string }).bookingId;
    const refund = await api(app.baseUrl, `/api/admin/bookings/${bookingId}/refund`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ reason: "end of day" }),
    });
    assert.equal(refund.status, 200);
    const summary = await api(app.baseUrl, "/api/admin/reports/daily?date=2026-06-01", { headers: adminHeaders() });
    const body = summary.body.summary as {
      methods: Array<{ method: string; amountMinor: number }>;
      refunds: { count: number; amountMinor: number };
    };
    assert.ok(body.methods.some((row) => row.method === "lightning" && row.amountMinor === 1));
    assert.equal(body.refunds.count, 1);
    assert.equal(body.refunds.amountMinor, 1);
    const mailed = await api(app.baseUrl, "/api/admin/reports/daily/email", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ date: "2026-06-01" }),
    });
    assert.equal(mailed.status, 200);
    const note = consoleEmail(app).sent.find((row) => row.to === "owner@example.invalid");
    assert.ok(note);
    assert.match(note.text, /lightning/);
    assert.match(note.text, /Refunds: 1/);

    app.setNow(new Date("2026-06-01T21:30:00.000Z"));
    assert.equal(await maybeSendDailySummary(app.db, app.notifier, app.config, app.now()), true);
    assert.equal(await maybeSendDailySummary(app.db, app.notifier, app.config, app.now()), false);
  } finally {
    await app.close();
  }
});

function answerVendor(req: IncomingMessage, res: ServerResponse, body: string): void {
  const path = req.url ?? "";
  if (path === "/v1/checkout/sessions") {
    json(res, { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" });
    return;
  }
  if (path === "/v1/refunds") {
    json(res, { id: "re_test_1" });
    return;
  }
  if (path === "/v2/online-checkout/payment-links") {
    json(res, { payment_link: { order_id: "order_test_1", url: "https://square.test/pay" } });
    return;
  }
  if (path === "/v2/refunds") {
    assert.match(body, /pay_test_1/);
    json(res, { refund: { id: "sq_refund_1" } });
    return;
  }
  res.writeHead(404);
  res.end();
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function stripeSignature(raw: string): string {
  const stamp = "1710000000";
  const digest = createHmac("sha256", STRIPE_WEBHOOK).update(`${stamp}.${raw}`).digest("hex");
  return `t=${stamp},v1=${digest}`;
}

function squareSignature(raw: string): string {
  return createHmac("sha256", SQUARE_KEY).update(SQUARE_NOTIFY).update(raw).digest("base64");
}

function consoleEmail(app: RunningApp): ConsoleMessageProvider {
  if (!(app.notifier.email instanceof ConsoleMessageProvider)) throw new Error("expected console email");
  return app.notifier.email;
}

async function loginPlayer(app: RunningApp, email: string): Promise<string> {
  const requested = await api(app.baseUrl, "/api/player/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(requested.status, 200);
  const message = [...consoleEmail(app).sent].reverse().find((row) => row.to === email);
  const code = message ? /(\d{6})/.exec(message.text)?.[1] : undefined;
  if (!code) throw new Error("login code missing");
  const response = await fetch(`${app.baseUrl}/api/player/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().find((row) => row.startsWith("player_session="));
  if (!cookie) throw new Error("player cookie missing");
  return cookie.split(";")[0] ?? "";
}

async function slotAt(app: RunningApp, startsAt: string, name: string): Promise<{ slotId: string }> {
  const court = await api(app.baseUrl, "/api/admin/courts", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ name }),
  });
  const courtId = (court.body.court as { id: string }).id;
  const endsAt = new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString();
  const slot = await api(app.baseUrl, "/api/admin/slots", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ courtId, startsAt, endsAt, priceMinor: 1 }),
  });
  assert.equal(slot.status, 201);
  return { slotId: (slot.body.slot as { id: string }).id };
}

async function enroll(
  baseUrl: string,
  memberId: string,
  signer: { privateKey: Uint8Array; pubkey: string },
): Promise<void> {
  const challenge = await api(baseUrl, `/api/admin/members/${memberId}/enroll`, {
    method: "POST",
    headers: adminHeaders(),
  });
  const k1 = (challenge.body.challenge as { k1: string }).k1;
  const sig = await signK1(signer.privateKey, k1);
  const enrolled = await api(baseUrl, `/api/access/enroll/callback?k1=${k1}&sig=${sig}&key=${signer.pubkey}`);
  assert.equal(enrolled.body.status, "OK");
}

async function mint(baseUrl: string): Promise<{ status: number; k1: string }> {
  const door = await api(baseUrl, "/api/access/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "lounge" }),
  });
  return { status: door.status, k1: (door.body.challenge as { k1: string } | undefined)?.k1 ?? "" };
}
