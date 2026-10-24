import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { PlaytomicClient } from "../src/playtomic/client.js";
import { ADMIN_TOKEN, api, createCourtAndSlot, FIXTURE_PRICE_MINOR, startTestApp } from "./helpers.js";

type Fixture = {
  bookingId: string;
  canceled?: boolean;
  email: string;
  commercial: boolean;
};

function bookingBody(row: Fixture) {
  return {
    booking_id: row.bookingId,
    resource_id: "resource-1",
    resource_name: "Court A",
    booking_start_date: "2026-06-01T16:00:00",
    booking_end_date: "2026-06-01T17:00:00",
    price: "1 XXX",
    status: row.canceled ? "CANCELED" : "PENDING",
    is_canceled: Boolean(row.canceled),
    participant_info: {
      owner_id: "player-1",
      participants: [
        {
          participant_id: "player-1",
          name: "Placeholder Member",
          email: row.email,
          accepts_commercial_communications: row.commercial,
          participant_type: "CUSTOMER",
        },
      ],
    },
  };
}

async function mockPlaytomic(initial: Fixture[]) {
  const state = {
    rows: initial,
    tokens: 0,
    bookingGets: 0,
    paymentGets: 0,
    booking429: false,
    payment202: false,
    writes: 0,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "POST" && url.pathname === "/api/v1/oauth/token") {
        state.tokens += 1;
        send(res, 200, { token: `token-${state.tokens}`, token_type: "BEARER", expires_in: 120 });
        return;
      }
      if (req.method !== "GET") {
        state.writes += 1;
        send(res, 405, { error: "read only" });
        return;
      }
      if (url.pathname === "/api/v1/bookings") {
        state.bookingGets += 1;
        if (state.booking429) {
          state.booking429 = false;
          res.setHeader("retry-after", "0");
          send(res, 429, { error: "slow down" });
          return;
        }
        const page = Number(url.searchParams.get("page") ?? "0");
        const size = Number(url.searchParams.get("size") ?? "100");
        send(res, 200, state.rows.slice(page * size, page * size + size).map(bookingBody));
        return;
      }
      if (url.pathname === "/api/v1/payments") {
        state.paymentGets += 1;
        if (state.payment202) {
          state.payment202 = false;
          res.setHeader("retry-after", "0");
          send(res, 202, { status: "PROCESSING" });
          return;
        }
        const cursor = url.searchParams.get("cursor_id");
        if (!cursor) {
          send(res, 200, {
            data: [{ club_payment_id: "pay-1", payment_id: "pmt-1", status: "PAID", total: "1 XXX" }],
            has_more: true,
            next_cursor_id: "cursor-2",
          });
          return;
        }
        send(res, 200, {
          data: [{ club_payment_id: "pay-2", status: "PAID", total: "1 XXX", product_sku: "court" }],
          has_more: false,
          next_cursor_id: null,
        });
        return;
      }
      send(res, 404, { error: "missing" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

test("token refresh, pagination, backoff, and payment cursors stay read-only", async () => {
  const mock = await mockPlaytomic([
    { bookingId: "book-1", email: "member@example.invalid", commercial: false },
    { bookingId: "book-2", email: "guest@example.invalid", commercial: true },
  ]);
  mock.state.booking429 = true;
  mock.state.payment202 = true;
  let clock = new Date("2026-06-01T15:00:00.000Z");
  const sleeps: number[] = [];
  const client = new PlaytomicClient(
    {
      baseUrl: mock.baseUrl,
      clientId: "client",
      clientSecret: "secret",
      tenantId: "tenant-1",
      syncMinutes: 0,
      pageSize: 1,
      minGapMs: 0,
    },
    () => clock,
    async (ms) => {
      sleeps.push(ms);
    },
  );
  try {
    const bookings = await client.listBookings(clock, new Date(clock.getTime() + 86_400_000));
    assert.deepEqual(
      bookings.map((row) => row.bookingId),
      ["book-1", "book-2"],
    );
    assert.equal(mock.state.tokens, 1);
    assert.ok(mock.state.bookingGets >= 3);
    clock = new Date(clock.getTime() + 70_000);
    const payments = await client.listPayments(clock, clock);
    assert.equal(payments.length, 2);
    assert.equal(payments[0]?.totalText, "1 XXX");
    assert.equal(mock.state.tokens, 2);
    assert.ok(sleeps.length >= 2);
    assert.equal(mock.state.writes, 0);
  } finally {
    await mock.close();
  }
});

test("re-sync is idempotent, blocks Lightning holds, and keeps marketing opt-in separate", async () => {
  const mock = await mockPlaytomic([
    { bookingId: "book-1", email: "member@example.invalid", commercial: false },
  ]);
  const app = await startTestApp({
    PLAYTOMIC_BASE_URL: mock.baseUrl,
    PLAYTOMIC_CLIENT_ID: "client",
    PLAYTOMIC_CLIENT_SECRET: "secret",
    PLAYTOMIC_TENANT_ID: "tenant-1",
    PLAYTOMIC_SYNC_MINUTES: "0",
    PLAYTOMIC_PAGE_SIZE: "20",
    PLAYTOMIC_MIN_GAP_MS: "0",
    GUEST_LIMIT: "1",
  });
  try {
    const { courtId, slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR, "Court A");
    const unmapped = await api(app.baseUrl, "/api/admin/playtomic/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(unmapped.status, 200);
    const flagged = await api(app.baseUrl, "/api/admin/playtomic/conflicts", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const openFlags = flagged.body.conflicts as Array<{ kind: string }>;
    assert.equal(openFlags.some((row) => row.kind === "unmapped-court"), true);
    const mapped = await api(app.baseUrl, "/api/admin/playtomic/maps", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ courtId, resourceId: "resource-1" }),
    });
    assert.equal(mapped.status, 201);
    const first = await api(app.baseUrl, "/api/admin/playtomic/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(first.status, 200);
    mock.state.rows[0] = { bookingId: "book-1", email: "member@example.invalid", commercial: true };
    const second = await api(app.baseUrl, "/api/admin/playtomic/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(second.status, 200);
    const cleared = await api(app.baseUrl, "/api/admin/playtomic/conflicts", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const stillOpen = cleared.body.conflicts as Array<{ kind: string }>;
    assert.equal(stillOpen.some((row) => row.kind === "unmapped-court"), false);
    const stored = app.db.prepare("SELECT count(*) AS n FROM external_bookings").get() as { n: number };
    const players = app.db.prepare("SELECT count(*) AS n FROM external_players").get() as { n: number };
    assert.equal(stored.n, 1);
    assert.equal(players.n, 1);
    const blocked = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(blocked.status, 409);
    const calendar = await api(app.baseUrl, "/api/calendar");
    const blocks = calendar.body.blocks as Array<{ source: string; label: string }>;
    assert.equal(blocks.some((block) => block.source === "playtomic" && block.label === "Imported booking"), true);
    assert.equal(JSON.stringify(calendar.body).includes("example.invalid"), false);
    const csv = await fetch(`${app.baseUrl}/api/admin/marketing.csv`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const text = await csv.text();
    assert.match(text, /member@example.invalid/);
    assert.doesNotMatch(text, /book-1/);
    mock.state.rows[0] = { bookingId: "book-1", email: "member@example.invalid", commercial: false, canceled: true };
    await api(app.baseUrl, "/api/admin/playtomic/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const open = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(open.status, 201);
    const after = await fetch(`${app.baseUrl}/api/admin/marketing.csv`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.doesNotMatch(await after.text(), /member@example.invalid/);
    assert.equal(mock.state.writes, 0);
  } finally {
    await app.close();
    await mock.close();
  }
});

function send(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json", "content-length": payload.length });
  res.end(payload);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
