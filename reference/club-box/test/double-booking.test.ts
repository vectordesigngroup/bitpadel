import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { claimOpenSlot, type ClaimInput, type ClaimResult } from "../src/booking/claim.js";
import { adminHeaders, api, createCourtAndSlot, FIXTURE_PRICE_MINOR, startTestApp } from "./helpers.js";

test("a second hold cannot take a slot that is already held", async () => {
  const app = await startTestApp();
  try {
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const first = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(first.status, 201);
    const second = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(second.status, 409);
    const overlap = await api(app.baseUrl, "/api/admin/slots", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        courtId: (await courtIdOf(app.baseUrl, slotId)),
        startsAt: new Date(app.now().getTime() + 60 * 60 * 1000).toISOString(),
        endsAt: new Date(app.now().getTime() + 2 * 60 * 60 * 1000).toISOString(),
        priceMinor: FIXTURE_PRICE_MINOR,
      }),
    });
    assert.equal(overlap.status, 409);
  } finally {
    await app.close();
  }
});

test("two concurrent claims produce exactly one hold", async () => {
  const app = await startTestApp();
  try {
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const expiresAt = new Date(app.now().getTime() + 15 * 60 * 1000).toISOString();
    const base: Omit<ClaimInput, "holdId" | "invoiceId"> = {
      slotId,
      paymentHash: null,
      bolt11: "mock-not-payable:race",
      amountSats: null,
      amountMinor: FIXTURE_PRICE_MINOR,
      currency: "XXX",
      expiresAt,
      nowIso: app.now().toISOString(),
    };
    const [first, second] = await Promise.all([
      claimInWorker(app.databasePath, { ...base, holdId: "hold_race_a", invoiceId: "mock_race_a" }),
      claimInWorker(app.databasePath, { ...base, holdId: "hold_race_b", invoiceId: "mock_race_b" }),
    ]);
    const wins = [first, second].filter((result) => result.ok);
    assert.equal(wins.length, 1, JSON.stringify([first, second]));
    const pending = app.db.prepare("SELECT COUNT(*) AS n FROM holds WHERE slot_id = ? AND status = 'pending'").get(slotId) as {
      n: number;
    };
    assert.equal(pending.n, 1);
    const slot = app.db.prepare("SELECT status FROM slots WHERE id = ?").get(slotId) as { status: string };
    assert.equal(slot.status, "held");
  } finally {
    await app.close();
  }
});

test("claimOpenSlot reports a price change instead of holding the old amount", async () => {
  const app = await startTestApp();
  try {
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const result = claimOpenSlot(app.db, {
      slotId,
      holdId: "hold_stale_price",
      invoiceId: "mock_stale_price",
      paymentHash: null,
      bolt11: "mock-not-payable:stale",
      amountSats: null,
      amountMinor: FIXTURE_PRICE_MINOR + 5,
      currency: "XXX",
      expiresAt: new Date(app.now().getTime() + 60_000).toISOString(),
      nowIso: app.now().toISOString(),
    });
    assert.deepEqual(result, { ok: false, reason: "price-changed" });
    const slot = app.db.prepare("SELECT status FROM slots WHERE id = ?").get(slotId) as { status: string };
    assert.equal(slot.status, "open");
  } finally {
    await app.close();
  }
});

async function courtIdOf(baseUrl: string, slotId: string): Promise<string> {
  const listed = await api(baseUrl, "/api/admin/slots", { headers: adminHeaders() });
  const slot = (listed.body.slots as Array<{ id: string; courtId: string }>).find((item) => item.id === slotId);
  if (!slot) throw new Error("slot missing");
  return slot.courtId;
}

function claimInWorker(databasePath: string, claim: ClaimInput): Promise<ClaimResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./claim-worker.ts", import.meta.url), {
      execArgv: process.execArgv,
      workerData: { databasePath, claim },
    });
    worker.once("message", (message: ClaimResult) => resolve(message));
    worker.once("error", reject);
  });
}
