// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import test from "node:test";
import { decodeLnurl } from "../src/access/lnurl.js";
import { purgeOldRows } from "../src/db.js";
import { isoWeekKey } from "../src/ledger/periods.js";
import { ConsoleMessageProvider } from "../src/notify/console.js";
import {
  adminHeaders,
  api,
  FIXTURE_PRICE_MINOR,
  freshKey,
  signK1,
  startTestApp,
  type RunningApp,
} from "./helpers.js";

const DEVICE_TOKEN = "vending-device-token-012345";
const STAFF_TOKEN = "test-staff-token-0123456789";
/** Two fixture minor units. Not a club allowance. */
const FIXTURE_ALLOWANCE = FIXTURE_PRICE_MINOR * 2;

test("ISO week keys use the Thursday year and stay integers", () => {
  assert.equal(isoWeekKey(2026, 1, 1), "week:2026-W01");
  assert.equal(isoWeekKey(2026, 6, 1), "week:2026-W23");
  assert.equal(isoWeekKey(2027, 1, 1), "week:2026-W53");
});

test("allowance is spent before the tab, and the ledger is append-only", async () => {
  const app = await startTestApp({ STAFF_TOKEN, VENDING_DEVICE_TOKEN: DEVICE_TOKEN });
  try {
    const memberId = await addMember(app, "membership-number");
    const saved = await api(app.baseUrl, "/api/admin/allowances", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ membershipType: "standard", amountMinor: FIXTURE_ALLOWANCE, period: "day" }),
    });
    assert.equal(saved.status, 200);
    assert.equal((saved.body.allowance as { amountMinor: number }).amountMinor, FIXTURE_ALLOWANCE);
    assert.equal((saved.body.allowance as { period: string }).period, "day");

    const denied = await api(app.baseUrl, "/api/admin/allowances", {
      method: "POST",
      headers: { authorization: `Bearer ${STAFF_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ membershipType: "standard", amountMinor: FIXTURE_ALLOWANCE, period: "day" }),
    });
    assert.equal(denied.status, 401);

    const limit = await api(app.baseUrl, `/api/admin/members/${memberId}/tab`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ limitMinor: FIXTURE_ALLOWANCE }),
    });
    assert.equal(limit.status, 200);

    const first = await charge(app, memberId, FIXTURE_ALLOWANCE + FIXTURE_PRICE_MINOR, "counter-1");
    assert.equal(first.status, 201);
    const entry = first.body.entry as { allowanceMinor: number; tabMinor: number; amountMinor: number; unit: string };
    assert.equal(entry.allowanceMinor, FIXTURE_ALLOWANCE);
    assert.equal(entry.tabMinor, FIXTURE_PRICE_MINOR);
    assert.equal(entry.amountMinor, FIXTURE_ALLOWANCE + FIXTURE_PRICE_MINOR);
    assert.equal(entry.unit, "minor");
    assert.equal(Number.isInteger(entry.amountMinor), true);

    const replay = await charge(app, memberId, FIXTURE_ALLOWANCE + FIXTURE_PRICE_MINOR, "counter-1");
    assert.equal(replay.status, 200);
    assert.equal(replay.body.idempotentReplay, true);
    assert.equal((replay.body.balance as { tab: { openMinor: number } }).tab.openMinor, FIXTURE_PRICE_MINOR);

    const over = await charge(app, memberId, FIXTURE_ALLOWANCE, "counter-2");
    assert.equal(over.status, 409);
    assert.match(String(over.body.error), /tab limit/);

    const room = await charge(app, memberId, FIXTURE_PRICE_MINOR, "counter-3");
    assert.equal(room.status, 201);
    assert.equal((room.body.entry as { allowanceMinor: number; tabMinor: number }).allowanceMinor, 0);
    assert.equal((room.body.entry as { tabMinor: number }).tabMinor, FIXTURE_PRICE_MINOR);
    assert.equal((room.body.balance as { tab: { openMinor: number } }).tab.openMinor, FIXTURE_ALLOWANCE);

    const frozen = await api(app.baseUrl, `/api/admin/members/${memberId}/tab/freeze`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(frozen.status, 200);
    assert.equal((frozen.body.tab as { frozen: boolean }).frozen, true);
    const blocked = await charge(app, memberId, FIXTURE_PRICE_MINOR, "counter-4");
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.body.error), /frozen/);

    const credit = await api(app.baseUrl, `/api/admin/members/${memberId}/tab/adjust`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        direction: "credit",
        amountMinor: FIXTURE_PRICE_MINOR,
        reason: "Wrong item at the counter",
        requestId: "adjust-1",
      }),
    });
    assert.equal(credit.status, 200);
    assert.equal((credit.body.entry as { tabMinor: number; reason: string }).tabMinor, -FIXTURE_PRICE_MINOR);
    assert.equal((credit.body.entry as { reason: string }).reason, "Wrong item at the counter");
    assert.equal((credit.body.balance as { tab: { openMinor: number } }).tab.openMinor, FIXTURE_PRICE_MINOR);

    const tooMuch = await api(app.baseUrl, `/api/admin/members/${memberId}/tab/adjust`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ direction: "credit", amountMinor: FIXTURE_ALLOWANCE, reason: "Too large" }),
    });
    assert.equal(tooMuch.status, 400);

    const missingReason = await api(app.baseUrl, `/api/admin/members/${memberId}/tab/adjust`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ direction: "debit", amountMinor: FIXTURE_PRICE_MINOR }),
    });
    assert.equal(missingReason.status, 400);

    await api(app.baseUrl, `/api/admin/members/${memberId}/tab/unfreeze`, {
      method: "POST",
      headers: adminHeaders(),
    });

    const fractional = await charge(app, memberId, 1.5, "counter-5");
    assert.equal(fractional.status, 400);

    const balance = await api(app.baseUrl, `/api/admin/members/${memberId}/tab`, { headers: adminHeaders() });
    assert.equal(balance.status, 200);
    const view = balance.body.balance as {
      allowance: { periodKey: string; remainingMinor: number };
      tab: { openMinor: number };
    };
    assert.equal(view.allowance.periodKey, "day:2026-06-01");
    assert.equal(view.allowance.remainingMinor, 0);
    assert.equal(view.tab.openMinor, FIXTURE_PRICE_MINOR);

    app.setNow(new Date("2026-06-02T12:00:00.000Z"));
    const nextDay = await api(app.baseUrl, `/api/staff/members/${memberId}/tab`, {
      headers: { authorization: `Bearer ${STAFF_TOKEN}` },
    });
    const rolled = nextDay.body.balance as { allowance: { remainingMinor: number; periodKey: string } };
    assert.equal(rolled.allowance.periodKey, "day:2026-06-02");
    assert.equal(rolled.allowance.remainingMinor, FIXTURE_ALLOWANCE);

    const csv = await fetch(`${app.baseUrl}/api/admin/ledger.csv?memberId=${memberId}`, { headers: adminHeaders() });
    const text = await csv.text();
    assert.match(text, /amount_minor,amount_sats,allowance_minor,tab_minor/);
    assert.match(text, /Wrong item at the counter/);
    const amountCells = text
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(",").slice(10, 14));
    for (const cells of amountCells) {
      for (const cell of cells) {
        if (cell === "") continue;
        assert.match(cell, /^-?\d+$/);
      }
    }

    assert.throws(() => app.db.prepare("UPDATE ledger_entries SET description = 'edited'").run(), /append-only/);
    assert.throws(() => app.db.prepare("DELETE FROM ledger_entries").run(), /append-only/);
    const before = countLedger(app);
    purgeOldRows(app.db, 1, app.now());
    assert.equal(countLedger(app), before);
  } finally {
    await app.close();
  }
});

test("a vending device charges by card or LNURL without pulsing a door", async () => {
  const app = await startTestApp({
    VENDING_DEVICE_TOKEN: DEVICE_TOKEN,
    NFC_UID_MODE: "insecure-dev",
    GUEST_LIMIT: "2",
  });
  try {
    const memberId = await addMember(app, "card-member");
    await api(app.baseUrl, "/api/admin/allowances", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ membershipType: "standard", amountMinor: FIXTURE_ALLOWANCE, period: "visit" }),
    });
    await api(app.baseUrl, `/api/admin/members/${memberId}/tab`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ limitMinor: FIXTURE_ALLOWANCE }),
    });
    const issued = await api(app.baseUrl, `/api/admin/members/${memberId}/cards`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ uid: "04aabbccddeeff", scheme: "uid-insecure", label: "fixture" }),
    });
    assert.equal(issued.status, 201);

    const tap = await api(app.baseUrl, "/api/access/nfc/uid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "04aabbccddeeff", area: "lounge" }),
    });
    assert.equal(tap.status, 200);
    const checkin = tap.body.checkin as { checkinId: string; token: string };
    assert.equal(app.door.pulses.length, 1);
    await api(app.baseUrl, `/api/checkins/${checkin.checkinId}/guest-count`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: checkin.token, guestCount: 1 }),
    });
    const guest = await api(app.baseUrl, `/api/checkins/${checkin.checkinId}/guests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: checkin.token,
        displayName: "Guest",
        contactKind: "email",
        contactValue: "guest@example.invalid",
        waiverAccepted: true,
        marketingConsent: false,
      }),
    });
    assert.equal(guest.status, 201);
    const guestId = guest.body.guestId as string;

    const vend = await deviceCharge(app, {
      requestId: "machine-1",
      deviceId: "cooler-1",
      description: "bottled water",
      amountMinor: FIXTURE_ALLOWANCE,
      guestId,
      identity: { kind: "nfc-uid", uid: "04aabbccddeeff" },
    });
    assert.equal(vend.status, 201);
    assert.equal(app.door.pulses.length, 1);
    const vendEntry = vend.body.entry as { allowanceMinor: number; tabMinor: number; guestId: string; guestLabel: string };
    assert.equal(vendEntry.allowanceMinor, FIXTURE_ALLOWANCE);
    assert.equal(vendEntry.tabMinor, 0);
    assert.equal(vendEntry.guestId, guestId);
    assert.equal(vendEntry.guestLabel, "Guest");

    const again = await deviceCharge(app, {
      requestId: "machine-1",
      deviceId: "cooler-1",
      description: "bottled water",
      amountMinor: FIXTURE_ALLOWANCE,
      guestId,
      identity: { kind: "nfc-uid", uid: "00000000000000" },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotentReplay, true);
    assert.equal(countLedger(app), 1);

    const clash = await deviceCharge(app, {
      requestId: "machine-1",
      deviceId: "cooler-1",
      description: "bottled water",
      amountMinor: FIXTURE_PRICE_MINOR,
      identity: { kind: "nfc-uid", uid: "04aabbccddeeff" },
    });
    assert.equal(clash.status, 409);

    const closed = await api(app.baseUrl, "/api/devices/vending/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "no-token", deviceId: "cooler-1", description: "water", amountMinor: 1 }),
    });
    assert.equal(closed.status, 401);

    const signer = await freshKey();
    const enroll = await api(app.baseUrl, `/api/admin/members/${memberId}/enroll`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const enrollK1 = (enroll.body.challenge as { k1: string }).k1;
    const enrollSig = await signK1(signer.privateKey, enrollK1);
    const enrolled = await api(
      app.baseUrl,
      `/api/access/enroll/callback?k1=${enrollK1}&sig=${enrollSig}&key=${signer.pubkey}`,
    );
    assert.equal(enrolled.body.status, "OK");

    const challenge = await api(app.baseUrl, "/api/devices/vending/challenges", {
      method: "POST",
      headers: deviceHeaders(),
      body: JSON.stringify({ deviceId: "cooler-1" }),
    });
    assert.equal(challenge.status, 201);
    const vendChallenge = challenge.body.challenge as { k1: string; lnurl: string; httpsUrl: string };
    assert.equal(decodeLnurl(vendChallenge.lnurl), vendChallenge.httpsUrl);
    const loginUrl = new URL(vendChallenge.httpsUrl);
    assert.equal(loginUrl.pathname, "/api/devices/vending/lnurl");
    const doc = await api(app.baseUrl, `/api/devices/vending/lnurl?k1=${vendChallenge.k1}`);
    assert.equal(doc.body.tag, "login");
    assert.equal(doc.body.action, "login");
    const sig = await signK1(signer.privateKey, vendChallenge.k1);
    const callback = await api(
      app.baseUrl,
      `/api/devices/vending/callback?k1=${vendChallenge.k1}&sig=${sig}&key=${signer.pubkey}`,
    );
    assert.equal(callback.body.status, "OK");
    const signed = await deviceCharge(app, {
      requestId: "machine-2",
      deviceId: "cooler-1",
      description: "bottled water",
      amountMinor: FIXTURE_PRICE_MINOR,
      identity: { kind: "lnurl", k1: vendChallenge.k1 },
    });
    assert.equal(signed.status, 201);
    assert.equal((signed.body.entry as { tabMinor: number; allowanceMinor: number }).allowanceMinor, 0);
    assert.equal((signed.body.entry as { tabMinor: number }).tabMinor, FIXTURE_PRICE_MINOR);
    assert.equal(app.door.pulses.length, 1);
    const spent = await deviceCharge(app, {
      requestId: "machine-3",
      deviceId: "cooler-1",
      description: "bottled water",
      amountMinor: FIXTURE_PRICE_MINOR,
      identity: { kind: "lnurl", k1: vendChallenge.k1 },
    });
    assert.equal(spent.status, 409);
  } finally {
    await app.close();
  }
});

test("sats charges convert only when the minor-unit amount is exact", async () => {
  const app = await startTestApp({ VENDING_DEVICE_TOKEN: DEVICE_TOKEN, SATS_PER_MINOR_UNIT: "2" });
  try {
    const memberId = await addMember(app, "sats-member");
    await api(app.baseUrl, `/api/admin/members/${memberId}/tab`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ limitMinor: FIXTURE_ALLOWANCE }),
    });
    const exact = await api(app.baseUrl, "/api/staff/tabs/charges", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        memberId,
        description: "item",
        unit: "sats",
        amountSats: 2,
        requestId: "sats-1",
      }),
    });
    assert.equal(exact.status, 201);
    const entry = exact.body.entry as { unit: string; amountMinor: number; amountSats: number; tabMinor: number };
    assert.equal(entry.unit, "sats");
    assert.equal(entry.amountSats, 2);
    assert.equal(entry.amountMinor, 1);
    assert.equal(entry.tabMinor, 1);
    const odd = await api(app.baseUrl, "/api/staff/tabs/charges", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ memberId, description: "item", unit: "sats", amountSats: 3, requestId: "sats-2" }),
    });
    assert.equal(odd.status, 400);
    assert.match(String(odd.body.error), /whole number of minor units/);
  } finally {
    await app.close();
  }
});

test("a member can see the tab and settle it, including a late Lightning notice", async () => {
  const app = await startTestApp({ SATS_PER_MINOR_UNIT: "2" });
  try {
    const email = "member@example.invalid";
    const memberId = await addMember(app, "settling-member");
    await api(app.baseUrl, `/api/admin/members/${memberId}/profile`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ email }),
    });
    await api(app.baseUrl, `/api/admin/members/${memberId}/tab`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ limitMinor: FIXTURE_ALLOWANCE }),
    });
    const posted = await charge(app, memberId, FIXTURE_PRICE_MINOR, "desk-1");
    assert.equal(posted.status, 201);

    const anonymous = await api(app.baseUrl, "/api/player/tab");
    assert.equal(anonymous.status, 401);
    const cookie = await loginPlayer(app, email);
    const seen = await api(app.baseUrl, "/api/player/tab", { headers: { cookie } });
    assert.equal(seen.status, 200);
    const balance = seen.body.balance as { tab: { openMinor: number }; recent: Array<{ description: string }> };
    assert.equal(balance.tab.openMinor, FIXTURE_PRICE_MINOR);
    assert.equal(balance.recent[0]?.description, "item");

    const card = await api(app.baseUrl, "/api/player/tab/settle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ method: "stripe" }),
    });
    assert.equal(card.status, 400);

    const opened = await api(app.baseUrl, "/api/player/tab/settle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ method: "lightning" }),
    });
    assert.equal(opened.status, 201);
    const settlement = opened.body.settlement as { id: string; amountMinor: number; amountSats: number; bolt11: string };
    assert.equal(settlement.amountMinor, FIXTURE_PRICE_MINOR);
    assert.equal(settlement.amountSats, 2);
    assert.match(settlement.bolt11, /^mock-not-payable:/);

    const second = await api(app.baseUrl, "/api/player/tab/settle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ method: "lightning" }),
    });
    assert.equal(second.status, 400);

    app.setNow(new Date(app.now().getTime() + 60 * 60_000));
    const expiredView = await api(app.baseUrl, `/api/admin/members/${memberId}/tab`, { headers: adminHeaders() });
    const pending = (expiredView.body.balance as { pendingSettlements: unknown[] }).pendingSettlements;
    assert.equal(pending.length, 0);

    const paid = await api(app.baseUrl, `/api/admin/tab-settlements/${settlement.id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.outcome, "confirmed");
    const after = await api(app.baseUrl, "/api/player/tab", { headers: { cookie } });
    assert.equal((after.body.balance as { tab: { openMinor: number } }).tab.openMinor, 0);
    const lines = countLedger(app);
    const repeat = await api(app.baseUrl, `/api/admin/tab-settlements/${settlement.id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(repeat.body.outcome, "already-confirmed");
    assert.equal(countLedger(app), lines);
  } finally {
    await app.close();
  }
});

test("vending routes stay closed until a device token is set", async () => {
  const app = await startTestApp();
  try {
    const health = await api(app.baseUrl, "/api/health");
    assert.equal(health.body.vendingDevices, false);
    const closed = await api(app.baseUrl, "/api/devices/vending/challenges", {
      method: "POST",
      headers: { authorization: `Bearer ${DEVICE_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "cooler-1" }),
    });
    assert.equal(closed.status, 503);
  } finally {
    await app.close();
  }
});

async function addMember(app: RunningApp, label: string): Promise<string> {
  const created = await api(app.baseUrl, "/api/admin/members", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ label }),
  });
  assert.equal(created.status, 201);
  return (created.body.member as { id: string }).id;
}

async function charge(
  app: RunningApp,
  memberId: string,
  amountMinor: number,
  requestId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return api(app.baseUrl, "/api/staff/tabs/charges", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ memberId, description: "item", amountMinor, requestId }),
  });
}

function deviceHeaders(): Record<string, string> {
  return { authorization: `Bearer ${DEVICE_TOKEN}`, "content-type": "application/json" };
}

async function deviceCharge(
  app: RunningApp,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return api(app.baseUrl, "/api/devices/vending/charges", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify(body),
  });
}

function countLedger(app: RunningApp): number {
  const row = app.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number };
  return row.n;
}

async function loginPlayer(app: RunningApp, email: string): Promise<string> {
  const requested = await api(app.baseUrl, "/api/player/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(requested.status, 200);
  const emailProvider = app.notifier.email;
  if (!(emailProvider instanceof ConsoleMessageProvider)) throw new Error("expected console email");
  const message = [...emailProvider.sent].reverse().find((row) => row.to === email);
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
