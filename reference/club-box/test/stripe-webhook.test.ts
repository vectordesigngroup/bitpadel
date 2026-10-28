// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyStripeSignature } from "../src/payments/cards/stripe.js";

const SECRET = "whsec_test_placeholder_0001";
const NOW_MS = 1_762_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const BODY = Buffer.from('{"id":"evt_test_fresh","type":"checkout.session.completed"}', "utf8");

function sign(rawBody: Buffer, timestampSeconds: number, secret = SECRET): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody.toString("utf8")}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

test("a fresh Stripe event within 300 seconds verifies", () => {
  assert.equal(verifyStripeSignature(BODY, sign(BODY, NOW_SECONDS), SECRET, NOW_MS), true);
  assert.equal(verifyStripeSignature(BODY, sign(BODY, NOW_SECONDS - 300), SECRET, NOW_MS), true);
  assert.equal(verifyStripeSignature(BODY, sign(BODY, NOW_SECONDS + 300), SECRET, NOW_MS), true);
});

test("a stale Stripe timestamp is rejected", () => {
  const header = sign(BODY, NOW_SECONDS - 301);
  assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW_MS), false);
});

test("a future Stripe timestamp is rejected", () => {
  const header = sign(BODY, NOW_SECONDS + 301);
  assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW_MS), false);
});

test("a tampered Stripe body is rejected", () => {
  const header = sign(BODY, NOW_SECONDS);
  const tampered = Buffer.from(`${BODY.toString("utf8")} `, "utf8");
  assert.equal(verifyStripeSignature(tampered, header, SECRET, NOW_MS), false);
});

test("a missing Stripe-Signature header is rejected", () => {
  assert.equal(verifyStripeSignature(BODY, undefined, SECRET, NOW_MS), false);
  assert.equal(verifyStripeSignature(BODY, "", SECRET, NOW_MS), false);
});

test("any one of several v1 signatures can match", () => {
  const digest = sign(BODY, NOW_SECONDS).split("v1=")[1] ?? "";
  const decoy = "ab".repeat(32);
  const header = `t=${NOW_SECONDS},v1=${decoy},v1=${digest}`;
  assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW_MS), true);
  assert.equal(verifyStripeSignature(BODY, `t=${NOW_SECONDS},v1=${digest},v1=${decoy}`, SECRET, NOW_MS), true);
  assert.equal(verifyStripeSignature(BODY, `t=${NOW_SECONDS},v1=${decoy},v1=${decoy}`, SECRET, NOW_MS), false);
});
