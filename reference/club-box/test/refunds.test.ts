// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { LnbitsPaymentBackend } from "../src/payments/lnbits.js";
import { adminHeaders, api, createCourtAndSlot, FIXTURE_PRICE_MINOR, startTestApp } from "./helpers.js";

test("mock refunds are recorded and LNbits refuses an in-place refund", async () => {
  const app = await startTestApp();
  try {
    const slot = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const hold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot.slotId, receiptEmail: "payer@example.invalid" }),
    });
    assert.equal(hold.status, 201);
    const holdId = (hold.body.hold as { id: string }).id;
    const paid = await api(app.baseUrl, `/api/admin/holds/${holdId}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(paid.status, 200);
    const bookingId = (paid.body as { bookingId: string }).bookingId;
    const email = app.notifier.email;
    assert.equal("sent" in email && Array.isArray(email.sent), true);
    if (!("sent" in email) || !Array.isArray(email.sent)) throw new Error("expected console email");
    assert.equal(email.sent.at(-1)?.to, "payer@example.invalid");
    assert.match(email.sent.at(-1)?.text ?? "", /transactional/);

    const refund = await api(app.baseUrl, `/api/admin/bookings/${bookingId}/refund`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ reason: "Club policy" }),
    });
    assert.equal(refund.status, 200);
    assert.match(String(refund.body.refundId), /^mock_refund_/);
    const stored = app.db.prepare("SELECT reason FROM refunds WHERE booking_id = ?").get(bookingId) as {
      reason: string;
    };
    assert.equal(stored.reason, "Club policy");

    const health = await api(app.baseUrl, "/api/admin/payments/health", { headers: adminHeaders() });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.balanceSats, null);
    const publicHealth = await api(app.baseUrl, "/api/health");
    assert.equal(publicHealth.body.balanceSats, undefined);
    assert.equal(publicHealth.body.emailProvider, "console");
  } finally {
    await app.close();
  }
});

test("LNbits refund is not supported without a customer invoice", async () => {
  const backend = new LnbitsPaymentBackend(
    { url: "http://127.0.0.1:9", invoiceKey: "invoice-key", webhookSecret: "webhook-secret-ok" },
    1,
  );
  const result = await backend.refund({
    invoiceId: "hash",
    amountMinor: 1,
    currency: "XXX",
    reason: "test",
    bolt11: null,
  });
  assert.equal(result.supported, false);
  if (!result.supported) assert.match(result.reason, /Not supported by this backend/);
});

test("LNbits refunds need the admin key and never pay more than was paid", async () => {
  const sent: Array<{ key: string | undefined; bolt11: string }> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/v1/payments/decode") {
        const { data } = JSON.parse(raw) as { data: string };
        res.end(JSON.stringify({ amount_msat: data === "lnbcrt-small" ? 2000 : 9_000_000, payment_hash: "ab".repeat(32) }));
        return;
      }
      if (req.url === "/api/v1/payments" && req.method === "POST") {
        const body = JSON.parse(raw) as { bolt11: string };
        sent.push({ key: req.headers["x-api-key"] as string | undefined, bolt11: body.bolt11 });
        res.end(JSON.stringify({ payment_hash: "cd".repeat(32), status: "success" }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const base = { invoiceId: "ef".repeat(32), amountMinor: 1, currency: "XXX", reason: "test", paidSats: 2 };
    const noAdmin = new LnbitsPaymentBackend({ url, invoiceKey: "invoice-key", webhookSecret: "webhook-secret-ok" }, 2);
    const refused = await noAdmin.refund({ ...base, bolt11: "lnbcrt-small" });
    assert.equal(refused.supported, false);
    if (!refused.supported) assert.match(refused.reason, /LNBITS_ADMIN_KEY/);

    const backend = new LnbitsPaymentBackend(
      { url, invoiceKey: "invoice-key", webhookSecret: "webhook-secret-ok", adminKey: "admin-key" },
      2,
    );
    await assert.rejects(backend.refund({ ...base, bolt11: "lnbcrt-big" }), /more than the 2 sats/);
    const ok = await backend.refund({ ...base, bolt11: "lnbcrt-small" });
    assert.equal(ok.supported, true);
    assert.deepEqual(sent, [{ key: "admin-key", bolt11: "lnbcrt-small" }]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
