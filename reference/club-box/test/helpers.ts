import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type Database from "better-sqlite3";
import { etc, getPublicKey, signAsync, utils } from "@noble/secp256k1";
import { loadConfig, type AppConfig, type Env } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { createDoorController } from "../src/doors/index.js";
import { MockDoorController } from "../src/doors/mock.js";
import { listen } from "../src/http.js";
import { createPaymentBackend } from "../src/payments/index.js";
import { createClubServer } from "../src/server.js";

export const ADMIN_TOKEN = "test-admin-token-0123456789";
/** Fixture amount in minor units. Not a suggested court price. */
export const FIXTURE_PRICE_MINOR = 1;

export type RunningApp = {
  baseUrl: string;
  config: AppConfig;
  db: Database.Database;
  databasePath: string;
  door: MockDoorController;
  setNow: (date: Date) => void;
  now: () => Date;
  close: () => Promise<void>;
};

export async function startTestApp(overrides: Env = {}): Promise<RunningApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "club-box-"));
  const databasePath = path.join(dir, "club.sqlite");
  let current = new Date("2026-06-01T15:00:00.000Z");
  const config = loadConfig({
    ADMIN_TOKEN,
    CURRENCY: "XXX",
    CURRENCY_DECIMALS: "2",
    PAYMENT_BACKEND: "mock",
    DOOR_BACKEND: "mock",
    DATABASE_PATH: databasePath,
    ACCESS_AREAS: "lounge,after-hours",
    HOST: "127.0.0.1",
    PORT: "0",
    PUBLIC_BASE_URL: "http://127.0.0.1:9",
    K1_TTL_SECONDS: "90",
    HOLD_MINUTES: "15",
    ...overrides,
  });
  const db = openDatabase(config.databasePath);
  const payments = createPaymentBackend(config);
  const door = createDoorController(config);
  if (!(door instanceof MockDoorController) && (overrides.DOOR_BACKEND ?? "mock") === "mock") {
    throw new Error("expected the mock door");
  }
  const server = createClubServer({
    config,
    db,
    payments,
    door,
    now: () => current,
  });
  await listen(server, 0, "127.0.0.1");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  if (!overrides.PUBLIC_BASE_URL) config.publicBaseUrl = baseUrl;
  return {
    baseUrl,
    config,
    db,
    databasePath,
    door: door as MockDoorController,
    now: () => current,
    setNow: (date: Date) => {
      current = date;
    },
    close: async () => {
      await closeServer(server);
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function adminHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${ADMIN_TOKEN}`,
    "content-type": "application/json",
  };
}

export async function api(
  baseUrl: string,
  pathname: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: response.status, body };
}

export async function createCourtAndSlot(
  app: RunningApp,
  priceMinor: number,
  name = "Court 1",
): Promise<{ courtId: string; slotId: string; startsAt: string }> {
  const court = await api(app.baseUrl, "/api/admin/courts", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ name }),
  });
  if (court.status !== 201) throw new Error(`create court failed: ${JSON.stringify(court.body)}`);
  const courtId = (court.body.court as { id: string }).id;
  const startsAt = new Date(app.now().getTime() + 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString();
  const slot = await api(app.baseUrl, "/api/admin/slots", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ courtId, startsAt, endsAt, priceMinor }),
  });
  if (slot.status !== 201) throw new Error(`create slot failed: ${JSON.stringify(slot.body)}`);
  return { courtId, slotId: (slot.body.slot as { id: string }).id, startsAt };
}

export async function freshKey(): Promise<{ privateKey: Uint8Array; pubkey: string }> {
  const privateKey = utils.randomPrivateKey();
  return { privateKey, pubkey: etc.bytesToHex(getPublicKey(privateKey, true)) };
}

export async function signK1(privateKey: Uint8Array, k1Hex: string): Promise<string> {
  const signature = await signAsync(etc.hexToBytes(k1Hex), privateKey, { extraEntropy: false });
  return signature.toCompactHex();
}

export function compactToDer(compactHex: string): string {
  const compact = etc.hexToBytes(compactHex);
  const r = derInteger(compact.subarray(0, 32));
  const s = derInteger(compact.subarray(32));
  const body = etc.concatBytes(r, s);
  const out = new Uint8Array(2 + body.length);
  out[0] = 0x30;
  out[1] = body.length;
  out.set(body, 2);
  return etc.bytesToHex(out);
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  let body = bytes.subarray(start);
  const lead = body[0] ?? 0;
  if ((lead & 0x80) !== 0) {
    const padded = new Uint8Array(body.length + 1);
    padded.set(body, 1);
    body = padded;
  }
  const out = new Uint8Array(2 + body.length);
  out[0] = 0x02;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
