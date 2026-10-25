// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { zonedLocalToUtc } from "../src/time.js";
import { ADMIN_TOKEN } from "./helpers.js";

const base = {
  ADMIN_TOKEN,
  CURRENCY: "XXX",
  CURRENCY_DECIMALS: "2",
  ACCESS_AREAS: "lounge",
};

test("prices and secrets come from the environment", () => {
  const config = loadConfig(base);
  assert.equal(config.defaultSlotPriceMinor, null);
  assert.equal(config.satsPerMinorUnit, null);
  assert.equal(config.currency, "XXX");
  const priced = loadConfig({ ...base, DEFAULT_SLOT_PRICE_MINOR: "2500" });
  assert.equal(priced.defaultSlotPriceMinor, 2500);
  assert.throws(() => loadConfig({ ...base, CURRENCY: "" }), /CURRENCY/);
  assert.throws(() => loadConfig({ ...base, ADMIN_TOKEN: "short" }), /ADMIN_TOKEN/);
  assert.throws(() => loadConfig({ ...base, PAYMENT_BACKEND: "cash" }), /PAYMENT_BACKEND/);
  assert.throws(() => loadConfig({ ...base, DEFAULT_SLOT_PRICE_MINOR: "0" }), /positive/);
  assert.throws(() => loadConfig({ ...base, CARD_PROVIDERS: "bitcoin" }), /CARD_PROVIDERS/);
  assert.throws(
    () =>
      loadConfig({
        ...base,
        CARD_PROVIDERS: "stripe",
        STRIPE_SECRET_KEY: "sk_live_not_for_this_repo",
        STRIPE_WEBHOOK_SECRET: "1234567890123456",
      }),
    /sk_test_/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...base,
        CARD_PROVIDERS: "square",
        SQUARE_ACCESS_TOKEN: "token",
        SQUARE_LOCATION_ID: "LOC",
        SQUARE_WEBHOOK_SIGNATURE_KEY: "1234567890123456",
        SQUARE_ENV: "production",
      }),
    /SQUARE_ALLOW_LIVE/,
  );
});

test("club-local clock times convert to UTC", () => {
  assert.equal(zonedLocalToUtc("2026-01-15", "18:00", "America/New_York").toISOString(), "2026-01-15T23:00:00.000Z");
  assert.equal(zonedLocalToUtc("2026-07-15", "18:00", "America/New_York").toISOString(), "2026-07-15T22:00:00.000Z");
  assert.equal(zonedLocalToUtc("2026-06-01", "15:00", "UTC").toISOString(), "2026-06-01T15:00:00.000Z");
});
