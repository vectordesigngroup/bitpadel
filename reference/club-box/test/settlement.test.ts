// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { adminHeaders, api, createCourtAndSlot, FIXTURE_PRICE_MINOR, startTestApp } from "./helpers.js";

test("mock settlement confirms a hold once and keeps the configured price", async () => {
  const app = await startTestApp();
  try {
    const first = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR, "Court A");
    const second = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR + 2, "Court B");
    const listed = await api(app.baseUrl, "/api/slots");
    const slots = listed.body.slots as Array<{ id: string; priceMinor: number }>;
    assert.equal(slots.find((slot) => slot.id === first.slotId)?.priceMinor, FIXTURE_PRICE_MINOR);
    assert.equal(slots.find((slot) => slot.id === second.slotId)?.priceMinor, FIXTURE_PRICE_MINOR + 2);

    const hold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: first.slotId }),
    });
    assert.equal(hold.status, 201);
    const created = hold.body.hold as {
      id: string;
      status: string;
      amountMinor: number;
      currency: string;
      bolt11: string;
      payable: boolean;
    };
    assert.equal(created.status, "pending");
    assert.equal(created.amountMinor, FIXTURE_PRICE_MINOR);
    assert.equal(created.currency, "XXX");
    assert.equal(created.payable, false);
    assert.match(created.bolt11, /^mock-not-payable:/);

    const paid = await api(app.baseUrl, `/api/admin/holds/${created.id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.outcome, "confirmed");
    const again = await api(app.baseUrl, `/api/admin/holds/${created.id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(again.body.outcome, "already-confirmed");
    const bookings = await api(app.baseUrl, "/api/admin/bookings", { headers: adminHeaders() });
    const rows = bookings.body.bookings as Array<{ slotId: string; amountMinor: number }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.slotId, first.slotId);
    assert.equal(rows[0]?.amountMinor, FIXTURE_PRICE_MINOR);

    const taken = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: first.slotId }),
    });
    assert.equal(taken.status, 409);
  } finally {
    await app.close();
  }
});

test("a settled invoice after the hold expires does not book the slot", async () => {
  const app = await startTestApp({ HOLD_MINUTES: "15" });
  try {
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const hold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    const created = hold.body.hold as { id: string; expiresAt: string };
    app.setNow(new Date(Date.parse(created.expiresAt) + 1000));
    const late = await api(app.baseUrl, `/api/admin/holds/${created.id}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(late.body.outcome, "expired");
    const slots = await api(app.baseUrl, "/api/slots");
    const slot = (slots.body.slots as Array<{ id: string; status: string }>).find((item) => item.id === slotId);
    assert.equal(slot?.status, "open");
    const retry = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(retry.status, 201);
  } finally {
    await app.close();
  }
});

test("BTCPay webhook signature gates settlement and expiry releases the hold", async () => {
  const fakeInvoices = new Map<string, { amount: string; currency: string }>();
  const fake = await fakeJsonServer((req, raw) => {
    if (req.method === "POST" && req.url?.endsWith("/invoices")) {
      const body = JSON.parse(raw) as { amount: string; currency: string };
      const id = `inv_${fakeInvoices.size + 1}`;
      fakeInvoices.set(id, body);
      return { status: 200, body: { id, expirationTime: Math.floor(Date.now() / 1000) + 900 } };
    }
    if (req.method === "GET" && req.url?.includes("/payment-methods")) {
      return {
        status: 200,
        body: [{ paymentMethod: "BTC-LN", destination: "lnbc1testinvoiceonlynotpayable", amount: "0.00000001" }],
      };
    }
    return { status: 404, body: {} };
  });
  const secret = "btcpay-webhook-secret-test";
  const app = await startTestApp({
    PAYMENT_BACKEND: "btcpay",
    BTCPAY_URL: fake.url,
    BTCPAY_STORE_ID: "store-test",
    BTCPAY_API_KEY: "api-test-key-not-real",
    BTCPAY_WEBHOOK_SECRET: secret,
  });
  try {
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const hold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(hold.status, 201);
    const created = hold.body.hold as { bolt11: string; payable: boolean };
    assert.equal(created.payable, true);
    assert.equal(created.bolt11, "lnbc1testinvoiceonlynotpayable");
    const invoice = [...fakeInvoices.values()].at(-1);
    assert.equal(invoice?.amount, "0.01");
    assert.equal(invoice?.currency, "XXX");
    const invoiceId = [...fakeInvoices.keys()].at(-1);
    if (!invoiceId) throw new Error("missing invoice");

    const forged = await postWebhook(app.baseUrl, "/api/webhooks/btcpay", { type: "InvoiceSettled", invoiceId }, "nope");
    assert.equal(forged.status, 401);
    const unsigned = await api(app.baseUrl, "/api/webhooks/btcpay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "InvoiceSettled", invoiceId }),
    });
    assert.equal(unsigned.status, 401);

    const settled = await postWebhook(app.baseUrl, "/api/webhooks/btcpay", { type: "InvoiceSettled", invoiceId }, secret);
    assert.equal(settled.status, 200);
    assert.equal(settled.body.outcome, "confirmed");
    const repeat = await postWebhook(app.baseUrl, "/api/webhooks/btcpay", { type: "InvoiceSettled", invoiceId }, secret);
    assert.equal(repeat.body.outcome, "already-confirmed");

    const other = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR, "Court C");
    const secondHold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: other.slotId }),
    });
    assert.equal(secondHold.status, 201);
    const secondId = [...fakeInvoices.keys()].at(-1);
    if (!secondId) throw new Error("missing second invoice");
    const expired = await postWebhook(app.baseUrl, "/api/webhooks/btcpay", { type: "InvoiceExpired", invoiceId: secondId }, secret);
    assert.equal(expired.body.outcome, "expired");
    const slots = await api(app.baseUrl, "/api/slots");
    const slot = (slots.body.slots as Array<{ id: string; status: string }>).find((item) => item.id === other.slotId);
    assert.equal(slot?.status, "open");
  } finally {
    await app.close();
    await fake.close();
  }
});

test("LNbits webhook settles only with the path secret and a paid invoice", async () => {
  const payments = new Map<string, { amount: number }>();
  const fake = await fakeJsonServer((req, raw) => {
    if (req.method === "POST" && req.url === "/api/v1/payments") {
      const body = JSON.parse(raw) as { amount: number; webhook: string };
      const paymentHash = randomBytes(32).toString("hex");
      payments.set(paymentHash, { amount: body.amount });
      assert.match(body.webhook, /\/api\/webhooks\/lnbits\//);
      return { status: 200, body: { payment_hash: paymentHash, payment_request: "lnbc1lnbitstestonly" } };
    }
    return { status: 404, body: {} };
  });
  const secret = "lnbits-webhook-secret";
  const app = await startTestApp({
    PAYMENT_BACKEND: "lnbits",
    LNBITS_URL: fake.url,
    LNBITS_INVOICE_KEY: "invoice-key-test-not-real",
    LNBITS_WEBHOOK_SECRET: secret,
    SATS_PER_MINOR_UNIT: "2",
  });
  try {
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const hold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(hold.status, 201);
    assert.equal((hold.body.hold as { amountSats: number }).amountSats, 2);
    const invoiceId = [...payments.keys()].at(-1);
    if (!invoiceId) throw new Error("missing payment hash");

    const pending = await api(app.baseUrl, `/api/webhooks/lnbits/${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_hash: invoiceId, pending: true }),
    });
    assert.equal(pending.body.outcome, "ignored");

    const wrong = await api(app.baseUrl, "/api/webhooks/lnbits/not-the-secret-value", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_hash: invoiceId, pending: false }),
    });
    assert.equal(wrong.status, 401);

    const paid = await api(app.baseUrl, `/api/webhooks/lnbits/${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_hash: invoiceId, pending: false }),
    });
    assert.equal(paid.body.outcome, "confirmed");
    const bookings = await api(app.baseUrl, "/api/admin/bookings", { headers: adminHeaders() });
    assert.equal((bookings.body.bookings as unknown[]).length, 1);
  } finally {
    await app.close();
    await fake.close();
  }
});

async function postWebhook(
  baseUrl: string,
  pathname: string,
  payload: unknown,
  secret: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return api(baseUrl, pathname, {
    method: "POST",
    headers: { "content-type": "application/json", "btcpay-sig": `sha256=${signature}` },
    body: raw,
  });
}

type FakeReply = { status: number; body: unknown };

function fakeJsonServer(
  handle: (req: { method?: string; url?: string }, raw: string) => FakeReply,
): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server;
  return new Promise((resolve) => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");
      const reply = handle(req, raw);
      const payload = JSON.stringify(reply.body);
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(payload);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}
