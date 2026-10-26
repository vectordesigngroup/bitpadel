// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import test from "node:test";
import { zonedLocalToUtc } from "../src/time.js";
import {
  addCivilDays,
  buildSchedule,
  chipLabel,
  dayBoundsIso,
  durationChoices,
  formatClock,
  formatDuration,
  formatPrice,
  formatTimeRange,
  monthMatrix,
  openDayCounts,
  priceLabel,
  rangeMidpoint,
  shouldSplitSlotPage,
  sportChoices,
  stateLabel,
  visualState,
  SLOT_PAGE_LIMIT,
} from "../public/booking-schedule.js";
import { adminHeaders, api, FIXTURE_PRICE_MINOR, startTestApp } from "./helpers.js";

const ZONE = "America/New_York";

test("club-local day bounds match the server timezone helper, including the DST change", () => {
  for (const ymd of ["2026-10-28", "2026-11-01", "2026-11-02", "2026-03-08"]) {
    const bounds = dayBoundsIso(ymd, ZONE);
    assert.equal(bounds.from, zonedLocalToUtc(ymd, "00:00", ZONE).toISOString());
    assert.equal(bounds.to, zonedLocalToUtc(addCivilDays(ymd, 1), "00:00", ZONE).toISOString());
  }
  assert.equal(zonedLocalToUtc("2026-10-28", "14:00", ZONE).toISOString(), "2026-10-28T18:00:00.000Z");
  assert.equal(zonedLocalToUtc("2026-11-02", "14:00", ZONE).toISOString(), "2026-11-02T19:00:00.000Z");
});

test("member-facing times, lengths, and prices avoid minor units", () => {
  assert.equal(formatClock("2026-10-28T18:00:00.000Z", ZONE), "2:00 PM");
  assert.equal(formatClock("2026-10-28T18:00:00.000Z", "UTC"), "6:00 PM");
  assert.equal(
    formatTimeRange("2026-10-28T18:00:00.000Z", "2026-10-28T19:00:00.000Z", ZONE),
    "2:00–3:00 PM",
  );
  assert.equal(
    formatTimeRange("2026-10-28T15:00:00.000Z", "2026-10-28T16:00:00.000Z", ZONE),
    "11:00 AM – 12:00 PM",
  );
  assert.equal(formatDuration(60), "1 hour");
  assert.equal(formatDuration(90), "1 hour 30 min");
  assert.equal(formatDuration(120), "2 hours");
  assert.equal(formatPrice(1000, "SAT", 0), "1,000 sats");
  assert.equal(formatPrice(1000, "SATS", 0), "1,000 sats");
  assert.equal(formatPrice(1000, "USD", 2), "$10.00");
  assert.equal(formatPrice(2500, "EUR", 2), "€25.00");
  const odd = formatPrice(1000, "XXX", 2);
  assert.equal(odd.toLowerCase().includes("minor"), false);
  assert.equal(priceLabel({
    priceMinor: 1000,
    guestPriceMinor: 1000,
    memberPriceMinor: 800,
    currency: "SAT",
  }, 0), "Guest 1,000 sats · Member 800 sats");
});

test("the month marks open days and the grid keeps court columns and time rows", () => {
  const courts = [
    { id: "padel", name: "Padel Court 1" },
    { id: "tennis", name: "Tennis Court" },
    { id: "empty", name: "Padel Court 2" },
  ];
  const slots = [
    slot("open-1", "padel", "Padel Court 1", "2026-10-28T18:00:00.000Z", "2026-10-28T19:00:00.000Z", "open", false),
    slot("booked", "tennis", "Tennis Court", "2026-10-28T18:00:00.000Z", "2026-10-28T19:30:00.000Z", "booked", false),
    slot("held", "padel", "Padel Court 1", "2026-10-28T19:00:00.000Z", "2026-10-28T20:00:00.000Z", "held", false),
    slot("blocked", "padel", "Padel Court 1", "2026-10-28T20:00:00.000Z", "2026-10-28T21:00:00.000Z", "open", true),
    slot("past", "padel", "Padel Court 1", "2026-10-26T15:00:00.000Z", "2026-10-26T16:00:00.000Z", "open", false),
  ];
  const now = Date.parse("2026-10-26T16:00:00.000Z");
  assert.equal(visualState(slots[0], now), "open");
  assert.equal(visualState(slots[2], now), "held");
  assert.equal(visualState(slots[3], now), "unavailable");
  assert.equal(visualState(slots[4], now), "past");
  assert.equal(stateLabel("booked"), "Booked");
  const counts = openDayCounts(slots, ZONE, now);
  assert.equal(counts.get("2026-10-28"), 1);
  assert.equal(counts.get("2026-10-26"), undefined);

  const schedule = buildSchedule({ slots, courts, nowMs: now, durationMinutes: 0, sport: "", courtId: "" });
  assert.deepEqual(schedule.courts.map((court) => court.name), ["Padel Court 1", "Tennis Court"]);
  const at = (startsAt: string) => schedule.rows.find((row) => row.startsAt === startsAt);
  const afternoon = at("2026-10-28T18:00:00.000Z");
  assert.equal(afternoon?.cells[0]?.state, "open");
  assert.equal(afternoon?.cells[1]?.state, "booked");
  assert.equal(at("2026-10-28T19:00:00.000Z")?.cells[0]?.state, "held");
  assert.equal(at("2026-10-28T19:00:00.000Z")?.cells[1]?.state, "continued");
  assert.equal(at("2026-10-28T19:00:00.000Z")?.cells[1]?.slot?.id, "booked");
  assert.equal(at("2026-10-28T20:00:00.000Z")?.cells[0]?.state, "unavailable");
  assert.equal(at("2026-10-26T15:00:00.000Z")?.cells[0]?.state, "past");

  const hourOnly = buildSchedule({ slots, courts, nowMs: now, durationMinutes: 60, sport: "", courtId: "" });
  assert.deepEqual(hourOnly.courts.map((court) => court.id), ["padel"]);
  const tennis = buildSchedule({ slots, courts, nowMs: now, durationMinutes: 0, sport: "Tennis", courtId: "" });
  assert.deepEqual(tennis.courts.map((court) => court.name), ["Tennis Court"]);
  assert.deepEqual(durationChoices(slots), [60, 90]);
  assert.deepEqual(sportChoices(courts), ["Padel", "Tennis"]);
  assert.deepEqual(sportChoices([{ id: "a", name: "Test Court 1" }]), []);
});

test("the calendar starts on Sunday and the quick chips name today and tomorrow", () => {
  const weeks = monthMatrix(2026, 10);
  assert.equal(weeks[0]?.[0]?.ymd, "2026-09-27");
  assert.equal(weeks[0]?.[4]?.ymd, "2026-10-01");
  assert.equal(weeks[0]?.[4]?.inMonth, true);
  assert.equal(weeks[4]?.[6]?.ymd, "2026-10-31");
  assert.equal(chipLabel("2026-10-26", "2026-10-26"), "Today");
  assert.equal(chipLabel("2026-10-27", "2026-10-26"), "Tomorrow");
  assert.equal(chipLabel("2026-10-28", "2026-10-26"), "Wed 28");
});

test("a full slot page splits only when the window is longer than an hour", () => {
  assert.equal(SLOT_PAGE_LIMIT, 500);
  assert.equal(shouldSplitSlotPage(500, 2 * 60 * 60 * 1000), true);
  assert.equal(shouldSplitSlotPage(500, 60 * 60 * 1000), false);
  assert.equal(shouldSplitSlotPage(12, 7 * 24 * 60 * 60 * 1000), false);
  const mid = rangeMidpoint("2026-10-01T04:00:00.000Z", "2026-10-03T04:00:00.000Z");
  assert.equal(mid, "2026-10-02T04:00:00.000Z");
});

test("the booking page is served with the schedule assets and day windows stay bounded", async () => {
  const app = await startTestApp({ CLUB_TIMEZONE: ZONE, CURRENCY: "SAT", CURRENCY_DECIMALS: "0" });
  try {
    const page = await fetch(`${app.baseUrl}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /id="calendar"/);
    assert.match(html, /id="slot-sheet"/);
    assert.match(html, /booking\.css/);
    assert.match(html, /brand\.css/);
    assert.match(html, /brand\.js/);
    assert.match(html, /brand-name-text/);
    assert.match(html, /brand-footer-text/);
    assert.match(html, /type="module"/);
    const visible = html.replace(/<script id="i18n-boot" type="application\/json">[\s\S]*?<\/script>/, "");
    assert.equal(visible.includes("minor units"), false);

    const script = await fetch(`${app.baseUrl}/booking.js`);
    const source = await script.text();
    assert.equal(script.status, 200);
    assert.match(source, /Card \(Stripe\)/);
    assert.match(source, /Card \(Square\)/);
    assert.equal(source.includes("minor units"), false);
    const schedule = await fetch(`${app.baseUrl}/booking-schedule.js`);
    assert.equal(schedule.status, 200);
    const css = await fetch(`${app.baseUrl}/booking.css`);
    assert.equal(css.status, 200);
    assert.match(await css.text(), /var\(--primary\)/);

    const court = await api(app.baseUrl, "/api/admin/courts", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Test Court 1" }),
    });
    const courtId = (court.body.court as { id: string }).id;
    for (const startsAt of ["2026-10-28T18:00:00.000Z", "2026-10-29T18:00:00.000Z"]) {
      const created = await api(app.baseUrl, "/api/admin/slots", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          courtId,
          startsAt,
          endsAt: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString(),
          priceMinor: FIXTURE_PRICE_MINOR,
        }),
      });
      assert.equal(created.status, 201);
    }
    const bounds = dayBoundsIso("2026-10-28", ZONE);
    const listed = await api(app.baseUrl, `/api/slots?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`);
    const slots = listed.body.slots as Array<{ startsAt: string; currency: string; priceMinor: number }>;
    assert.equal(listed.status, 200);
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.startsAt, "2026-10-28T18:00:00.000Z");
    assert.equal(slots[0]?.currency, "SAT");
    assert.equal(slots[0]?.priceMinor, FIXTURE_PRICE_MINOR);
  } finally {
    await app.close();
  }
});

function slot(
  id: string,
  courtId: string,
  courtName: string,
  startsAt: string,
  endsAt: string,
  status: "open" | "held" | "booked" | "cancelled",
  blocked: boolean,
) {
  return {
    id,
    courtId,
    courtName,
    startsAt,
    endsAt,
    status,
    blocked,
    priceMinor: 1000,
    guestPriceMinor: 1000,
    memberPriceMinor: 800,
    currency: "SAT",
  };
}
