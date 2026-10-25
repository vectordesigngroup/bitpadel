// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors
//
// End-to-end Lightning test against a local REGTEST network (play money only).
// Start the stack first with ./start.sh. This script starts its own club-box
// process, a tiny SMTP sink for player login codes, and acts as the player:
//   - node B (lncli) is the player's Lightning wallet
//   - a LUD-05 key derivation from a throwaway seed is the player's LNURL-auth wallet
// It never talks to mainnet. It refuses to run if lncli reports a non-regtest chain.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { etc, getPublicKey, signAsync, CURVE } from "@noble/secp256k1";
import { bech32 } from "bech32";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const stateDir = process.env.REGTEST_STATE ?? path.join(here, ".state");
const state = JSON.parse(readFileSync(path.join(stateDir, "state.json"), "utf8")) as {
  lncli: string;
  lndB: string[];
  lndA: string[];
  lnbitsUrl: string;
  invoiceKey: string;
  adminKey: string;
};

const CLUB_PORT = Number(process.env.CLUB_PORT ?? 3100);
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 2525);
const BASE = `http://127.0.0.1:${CLUB_PORT}`;
const ADMIN = "regtest-admin-token-" + Date.now();
const SATS_PER_MINOR = 10; // fixture rate for play money only
const PRICE_MINOR = 2500; // fixture price, 25,000 regtest sats
const results: Array<{ id: string; name: string; result: "PASS" | "FAIL" | "N/A" | "INFO"; evidence: string }> = [];

function record(id: string, name: string, result: "PASS" | "FAIL" | "N/A" | "INFO", evidence: string): void {
  results.push({ id, name, result, evidence });
  console.log(`[${result}] ${id} ${name}\n        ${evidence.replaceAll("\n", "\n        ")}`);
}

// ---------- node B (player wallet) via lncli ----------
function lnB(...args: string[]): any {
  const out = execFileSync(state.lncli, [...state.lndB, ...args], { encoding: "utf8" });
  return JSON.parse(out);
}
function lnBTry(...args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync(state.lncli, [...state.lndB, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error: any) {
    return { ok: false, out: String(error.stderr || error.stdout || error.message) };
  }
}
function channelBalanceB(): number {
  return Number(lnB("channelbalance").local_balance.sat);
}

// ---------- LNbits ----------
async function lnbitsBalanceSats(): Promise<number> {
  const r = await fetch(`${state.lnbitsUrl}/api/v1/wallet`, { headers: { "x-api-key": state.invoiceKey } });
  const body = (await r.json()) as { balance: number };
  return Math.floor(body.balance / 1000);
}

// ---------- SMTP sink (captures player login codes) ----------
const mails: string[] = [];
function startSmtpSink(): Promise<Server> {
  const server = createServer((socket) => {
    let data = false;
    let buf = "";
    socket.write("220 regtest-sink\r\n");
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      while (true) {
        if (data) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          mails.push(buf.slice(0, end));
          buf = buf.slice(end + 5);
          data = false;
          socket.write("250 ok\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") socket.write("250 regtest-sink\r\n");
        else if (cmd === "DATA") {
          data = true;
          socket.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(SMTP_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------- club-box ----------
let club: ChildProcess | null = null;
const clubLog: string[] = [];
async function startClub(extra: Record<string, string>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "club-regtest-"));
  const env = {
    PATH: process.env.PATH ?? "",
    HOST: "127.0.0.1",
    PORT: String(CLUB_PORT),
    DATABASE_PATH: path.join(dir, "club.sqlite"),
    PUBLIC_BASE_URL: BASE,
    CURRENCY: "USD",
    CURRENCY_DECIMALS: "2",
    SATS_PER_MINOR_UNIT: String(SATS_PER_MINOR),
    HOLD_MINUTES: "1",
    PAYMENT_BACKEND: "lnbits",
    CARD_PROVIDERS: "",
    LNBITS_URL: state.lnbitsUrl,
    LNBITS_INVOICE_KEY: state.invoiceKey,
    LNBITS_ADMIN_KEY: state.adminKey,
    LNBITS_WEBHOOK_SECRET: "regtest_webhook_secret_0123456789",
    DOOR_BACKEND: "mock",
    ADMIN_TOKEN: ADMIN,
    ACCESS_AREAS: "lounge",
    CLUB_TIMEZONE: "UTC",
    CANCEL_WINDOW_HOURS: "24",
    CANCEL_REFUND: "full",
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(SMTP_PORT),
    SMTP_SECURE: "false",
    SMTP_FROM: "club@example.invalid",
    NFC_MASTER_KEY: "00112233445566778899aabbccddeeff",
    NFC_SDM_META_READ_KEY: "00000000000000000000000000000000",
    NFC_SYSTEM_ID: "club-box",
    PHOTO_DIR: path.join(dir, "photos"),
    BACKUP_DIR: path.join(dir, "backups"),
    ...extra,
  };
  club = spawn(path.join(appDir, "node_modules/.bin/tsx"), ["src/index.ts"], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });
  club.stdout?.on("data", (d) => clubLog.push(String(d)));
  club.stderr?.on("data", (d) => clubLog.push(String(d)));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`club-box did not start:\n${clubLog.join("")}`);
}

async function api(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: r.status, body: json, headers: r.headers };
}
const admin = { authorization: `Bearer ${ADMIN}` };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(fn: () => Promise<T | null>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  return null;
}

// ---------- LUD-05 linking key derivation (BIP32) ----------
type Node = { k: bigint; c: Uint8Array };
const N = CURVE.n;
function toBig(b: Uint8Array): bigint {
  return BigInt("0x" + etc.bytesToHex(b));
}
function to32(v: bigint): Uint8Array {
  return etc.hexToBytes(v.toString(16).padStart(64, "0"));
}
function ser32(i: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, i >>> 0, false);
  return b;
}
function master(seed: Uint8Array): Node {
  const I = hmac(sha512, new TextEncoder().encode("Bitcoin seed"), seed);
  return { k: toBig(I.slice(0, 32)), c: I.slice(32) };
}
function child(node: Node, index: number): Node {
  const hardened = index >>> 0 >= 0x80000000;
  const data = hardened
    ? etc.concatBytes(new Uint8Array([0]), to32(node.k), ser32(index))
    : etc.concatBytes(getPublicKey(to32(node.k), true), ser32(index));
  const I = hmac(sha512, node.c, data);
  return { k: etc.mod(toBig(I.slice(0, 32)) + node.k, N), c: I.slice(32) };
}
function derivePath(seed: Uint8Array, p: number[]): Uint8Array {
  let n = master(seed);
  for (const i of p) n = child(n, i);
  return to32(n.k);
}
/** LUD-05: hashingKey = m/138'/0; linking key = m/138'/<4 x uint32 from HMAC(hashingKey, domain)>. */
function linkingKey(seed: Uint8Array, domain: string): { priv: Uint8Array; pub: string } {
  const H = 0x80000000;
  const hashingKey = derivePath(seed, [138 + H, 0]);
  const material = hmac(sha256, hashingKey, new TextEncoder().encode(domain));
  const dv = new DataView(material.buffer, material.byteOffset, 16);
  const p = [138 + H, dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12)];
  const priv = derivePath(seed, p);
  return { priv, pub: etc.bytesToHex(getPublicKey(priv, true)) };
}

/** LUD-04 asks wallets for DER-encoded signatures. */
function derHex(compact: Uint8Array): string {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i += 1;
    let v = b.subarray(i);
    if ((v[0] ?? 0) & 0x80) v = etc.concatBytes(new Uint8Array([0]), v);
    return etc.concatBytes(new Uint8Array([0x02, v.length]), v);
  };
  const body = etc.concatBytes(int(compact.subarray(0, 32)), int(compact.subarray(32)));
  return etc.bytesToHex(etc.concatBytes(new Uint8Array([0x30, body.length]), body));
}

/**
 * Simulated LUD-04 wallet. A spec-following wallet reads tag=login and k1 from the
 * decoded LNURL query string, signs k1 (DER), and GETs <same url>&sig=..&key=..
 * If the URL has no tag=login, "lenient" wallets GET it and read the JSON instead.
 */
async function walletLogin(lnurl: string, seed: Uint8Array, mode: "strict" | "lenient") {
  const words = bech32.decode(lnurl.toLowerCase(), 2000).words;
  const url = new URL(Buffer.from(bech32.fromWords(words)).toString("utf8"));
  let k1 = url.searchParams.get("k1") ?? "";
  let callback = url;
  if (url.searchParams.get("tag") !== "login") {
    if (mode === "strict") return { ok: false, detail: `decoded LNURL has no tag=login (${url.pathname}${url.search.replace(/k1=[0-9a-f]+/, "k1=…")})`, pub: "" };
    const doc = (await (await fetch(url)).json()) as { tag?: string; k1?: string; callback?: string };
    if (doc.tag !== "login" || !doc.k1 || !doc.callback) return { ok: false, detail: `bad login doc ${JSON.stringify(doc)}`, pub: "" };
    k1 = doc.k1;
    callback = new URL(doc.callback);
    callback.searchParams.set("k1", k1);
  }
  const key = linkingKey(seed, url.hostname);
  const sig = derHex((await signAsync(etc.hexToBytes(k1), key.priv, { extraEntropy: false })).toCompactRawBytes());
  callback.searchParams.set("sig", sig);
  callback.searchParams.set("key", key.pub);
  const r = await fetch(callback);
  const body = (await r.json()) as { status?: string; reason?: string };
  return { ok: body.status === "OK", detail: JSON.stringify(body), pub: key.pub };
}

// ---------- player login ----------
async function playerLogin(email: string): Promise<string> {
  const before = mails.length;
  const sent = await api("POST", "/api/player/code", { email });
  if (sent.status !== 200) throw new Error(`player code: ${JSON.stringify(sent.body)}`);
  const mail = await waitFor(async () => (mails.length > before ? mails[mails.length - 1]! : null), 10_000);
  const code = mail?.replace(/=\r\n/g, "").match(/login code is ([A-Za-z0-9]+)/)?.[1];
  if (!code) throw new Error("no login code captured");
  const session = await api("POST", "/api/player/session", { email, code });
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`no session cookie: ${JSON.stringify(session.body)}`);
  return cookie;
}

let slotSeq = 0;
async function newSlot(courtId: string): Promise<string> {
  slotSeq += 1;
  const start = new Date(Date.now() + (48 + slotSeq) * 3_600_000);
  start.setUTCMinutes(0, 0, 0);
  const r = await api(
    "POST",
    "/api/admin/slots",
    { courtId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(), priceMinor: PRICE_MINOR },
    admin,
  );
  if (r.status !== 201) throw new Error(`slot: ${JSON.stringify(r.body)}`);
  return r.body.slot.id;
}

async function holdAndPay(courtId: string, cookie: string) {
  const slotId = await newSlot(courtId);
  const hold = await api("POST", "/api/holds", { slotId }, { cookie });
  if (hold.status !== 201) throw new Error(`hold: ${JSON.stringify(hold.body)}`);
  const bolt11: string = hold.body.hold.bolt11;
  const decoded = lnB("decodepayreq", bolt11);
  const b0 = channelBalanceB();
  const l0 = await lnbitsBalanceSats();
  const pay = lnB("payinvoice", "--force", "--json", bolt11);
  const confirmed = await waitFor(async () => {
    const h = await api("GET", `/api/holds/${hold.body.hold.id}`);
    return h.body.hold?.status === "paid" ? h.body.hold : null;
  }, 20_000);
  return { slotId, hold: hold.body.hold, decoded, pay, confirmed, b0, b1: channelBalanceB(), l0, l1: await lnbitsBalanceSats() };
}

async function main(): Promise<void> {
  const info = lnB("getinfo");
  const chains = JSON.stringify(info.chains ?? []);
  if (!chains.includes("regtest")) throw new Error(`refusing to run: node B is not on regtest (${chains})`);
  const smtp = await startSmtpSink();
  await startClub({});
  try {
    const court = await api("POST", "/api/admin/courts", { name: "Court 1" }, admin);
    const courtId: string = court.body.court.id;
    const cookie = await playerLogin("player@example.invalid");
    const health = await api("GET", "/api/admin/payments/health", undefined, admin);
    record("0", "LNbits backend health", health.body?.ok === true || health.body?.lightning?.ok === true ? "PASS" : "INFO", JSON.stringify(health.body));

    // 1. Membership purchase
    record(
      "1",
      "Membership purchase over Lightning",
      "N/A",
      "club-box has no membership-purchase flow yet: members are created and revoked by staff (POST /api/admin/members, /revoke, /restore) and have no paid-until date. Nothing to pay.",
    );

    // 2. Court booking
    const b = await holdAndPay(courtId, cookie);
    const paidSats = Number(b.decoded.num_satoshis);
    record(
      "2",
      "Court booking paid by node B",
      b.confirmed && b.pay.status === "SUCCEEDED" && paidSats === PRICE_MINOR * SATS_PER_MINOR ? "PASS" : "FAIL",
      `invoice ${paidSats} sats (expected ${PRICE_MINOR * SATS_PER_MINOR}); payinvoice=${b.pay.status} fee=${b.pay.fee_sat}; hold=${b.confirmed?.status ?? "not paid"} booking=${b.confirmed?.bookingId ?? "-"}\n` +
        `node B ${b.b0} -> ${b.b1} sats; LNbits wallet ${b.l0} -> ${b.l1} sats; invoice expiry=${b.decoded.expiry}s vs HOLD_MINUTES=1`,
    );

    // 3. Self-cancel inside the window with CANCEL_REFUND=full
    const bookingId: string | undefined = b.confirmed?.bookingId;
    const bBefore = channelBalanceB();
    const lBefore = await lnbitsBalanceSats();
    const noInvoice = await api("POST", `/api/player/bookings/${bookingId}/cancel`, undefined, { cookie });
    const listed = await api("GET", "/api/player/bookings", undefined, { cookie });
    const upcomingIds = (body: unknown) =>
      (((body as { upcoming?: Array<{ id: string }> }).upcoming ?? []) as Array<{ id: string }>).map((x) => x.id);
    const kept = upcomingIds(listed.body).includes(String(bookingId));
    record(
      "3a",
      "Self-cancel without a refund invoice",
      noInvoice.status === 409 && kept ? "PASS" : "FAIL",
      `cancel with no invoice -> HTTP ${noInvoice.status} ${JSON.stringify(noInvoice.body)}; booking kept=${kept} (LNbits cannot push sats back without the player's invoice)`,
    );
    const refundInv = lnB("addinvoice", "--amt", String(paidSats), "--memo", "regtest self-cancel refund");
    const cancel = await api("POST", `/api/player/bookings/${bookingId}/cancel`, { bolt11: refundInv.payment_request }, { cookie });
    const refunded = await waitFor(async () => (lnB("lookupinvoice", refundInv.r_hash).state === "SETTLED" ? true : null), 15_000);
    const bAfter = channelBalanceB();
    const after = await api("GET", "/api/player/bookings", undefined, { cookie });
    const gone = !upcomingIds(after.body).includes(String(bookingId));
    record(
      "3b",
      "Self-cancel inside the window, refund to node B's invoice",
      cancel.status === 200 && refunded && bAfter - bBefore === paidSats && gone ? "PASS" : "FAIL",
      `cancel -> HTTP ${cancel.status} ${JSON.stringify(cancel.body)}; node B invoice ${refunded ? "SETTLED" : "not settled"}; node B ${bBefore} -> ${bAfter} (+${bAfter - bBefore}); LNbits ${lBefore} -> ${await lnbitsBalanceSats()}; moved out of upcoming=${gone}`,
    );

    // 3c. Staff refund with a customer-provided BOLT11 from node B
    const b2 = await holdAndPay(courtId, cookie);
    const refundAmt = Number(b2.decoded.num_satoshis);
    const inv = lnB("addinvoice", "--amt", String(refundAmt), "--memo", "regtest refund");
    const rb0 = channelBalanceB();
    const refund = await api("POST", `/api/admin/bookings/${b2.confirmed?.bookingId}/refund`, { reason: "regtest refund", bolt11: inv.payment_request }, admin);
    const settled = await waitFor(async () => {
      const i = lnB("lookupinvoice", inv.r_hash);
      return i.state === "SETTLED" ? i : null;
    }, 15_000);
    record(
      "3c",
      "Staff refund to a BOLT11 from node B",
      refund.status === 200 && settled ? "PASS" : "FAIL",
      `refund -> HTTP ${refund.status} ${JSON.stringify(refund.body)}; node B invoice ${settled ? "SETTLED" : "not settled"}; node B ${rb0} -> ${channelBalanceB()}`,
    );

    // 3d. Refund must not exceed what was paid
    const b3 = await holdAndPay(courtId, cookie);
    const big = lnB("addinvoice", "--amt", String(Number(b3.decoded.num_satoshis) * 4), "--memo", "too big");
    const over = await api("POST", `/api/admin/bookings/${b3.confirmed?.bookingId}/refund`, { reason: "overpay check", bolt11: big.payment_request }, admin);
    await sleep(1500);
    const bigState = lnB("lookupinvoice", big.r_hash).state;
    record(
      "3d",
      "Refund larger than the payment is refused",
      over.status >= 400 && bigState !== "SETTLED" ? "PASS" : "FAIL",
      `refund of ${Number(b3.decoded.num_satoshis) * 4} sats for a ${b3.decoded.num_satoshis}-sat booking -> HTTP ${over.status} ${JSON.stringify(over.body)}; node B invoice ${bigState}`,
    );

    // 4. Underpaid / expired
    const slot4 = await newSlot(courtId);
    const hold4 = await api("POST", "/api/holds", { slotId: slot4 }, { cookie });
    const bolt4: string = hold4.body.hold.bolt11;
    const under = lnBTry("payinvoice", "--force", "--amt", "1", bolt4);
    record("4a", "Underpayment of a fixed-amount invoice", under.ok ? "FAIL" : "PASS", `lncli payinvoice --amt 1 -> ${under.ok ? "accepted!" : under.out.trim().split("\n").pop()}`);
    console.log("        waiting 65 s for the 1-minute hold to expire …");
    await sleep(65_000);
    const h4 = await api("GET", `/api/holds/${hold4.body.hold.id}`);
    const slots4 = await api("GET", `/api/slots?courtId=${courtId}`);
    const late = lnBTry("payinvoice", "--force", "--json", bolt4);
    const lateOk = late.ok && /SUCCEEDED/.test(late.out);
    await sleep(2000);
    const h4b = await api("GET", `/api/holds/${hold4.body.hold.id}`);
    record(
      "4b",
      "Paying after the hold expired",
      !lateOk ? "PASS" : "FAIL",
      `hold after 65 s: ${h4.body.hold?.status ?? h4.status}; late payinvoice ${lateOk ? "SUCCEEDED (sats taken, no booking)" : "refused: " + late.out.trim().split("\n").pop()}; hold after: ${h4b.body.hold?.status ?? h4b.status}`,
    );
    const forged = await fetch(`${BASE}/api/webhooks/lnbits/wrong_secret_0123456789`, { method: "POST", body: "{}" });
    const slot5 = await newSlot(courtId);
    const hold5 = await api("POST", "/api/holds", { slotId: slot5 }, { cookie });
    const fake = await api("POST", `/api/webhooks/lnbits/regtest_webhook_secret_0123456789`, { payment_hash: hold5.body.hold.paymentHash ?? lnB("decodepayreq", hold5.body.hold.bolt11).payment_hash, paid: true });
    const h5 = await api("GET", `/api/holds/${hold5.body.hold.id}`);
    record(
      "4c",
      "Webhook forgery",
      forged.status === 401 && h5.body.hold?.status !== "paid" ? "PASS" : "FAIL",
      `wrong path secret -> HTTP ${forged.status}; right secret but unpaid invoice claims paid -> ${JSON.stringify(fake.body)}, hold=${h5.body.hold?.status}`,
    );

    // 5. LNURL-auth enrollment + door
    const seed = sha256(new TextEncoder().encode("regtest throwaway wallet seed " + Date.now()));
    const bDoor0 = channelBalanceB();
    const lDoor0 = await lnbitsBalanceSats();
    const m = await api("POST", "/api/admin/members", { label: "RT-1" }, admin);
    const memberId: string = m.body.member.id;
    const enroll = await api("POST", `/api/admin/members/${memberId}/enroll`, undefined, admin);
    const strictEnroll = await walletLogin(enroll.body.challenge.lnurl, seed, "strict");
    record("5a", "Enrollment QR readable by a spec-strict LUD-04 wallet", strictEnroll.ok ? "PASS" : "FAIL", strictEnroll.detail);
    let enrolled = strictEnroll;
    if (!strictEnroll.ok) {
      const again = await api("POST", `/api/admin/members/${memberId}/enroll`, undefined, admin);
      enrolled = await walletLogin(again.body.challenge.lnurl, seed, "lenient");
      record("5b", "Enrollment with a lenient wallet (GETs the JSON)", enrolled.ok ? "PASS" : "FAIL", enrolled.detail);
    }
    const doorQr = async () => (await api("POST", "/api/access/challenges", { area: "lounge" })).body.challenge.lnurl as string;
    const mode = strictEnroll.ok ? "strict" : "lenient";
    const open1 = await walletLogin(await doorQr(), seed, mode);
    const otherDomain = linkingKey(seed, "other.example").pub !== enrolled.pub;
    record("5c", "Door unlock for an active member", open1.ok ? "PASS" : "FAIL", `${open1.detail}; linking key is per-domain: ${otherDomain}`);
    const unknown = await walletLogin(await doorQr(), sha256(new TextEncoder().encode("stranger")), mode);
    record("5d", "Door denies an unknown wallet", !unknown.ok ? "PASS" : "FAIL", unknown.detail);
    await api("POST", `/api/admin/members/${memberId}/revoke`, undefined, admin);
    const revoked = await walletLogin(await doorQr(), seed, mode);
    record("5e", "Door denies a revoked member", !revoked.ok ? "PASS" : "FAIL", revoked.detail);
    await api("POST", `/api/admin/members/${memberId}/restore`, undefined, admin);
    const audit = await api("GET", "/api/admin/audit", undefined, admin);
    record(
      "5f",
      "No sats move during enrollment or door access",
      channelBalanceB() === bDoor0 && (await lnbitsBalanceSats()) === lDoor0 ? "PASS" : "FAIL",
      `node B ${bDoor0} -> ${channelBalanceB()}; LNbits ${lDoor0} -> ${await lnbitsBalanceSats()}; audit rows: ${JSON.stringify((audit.body.audit ?? audit.body.rows ?? []).slice(0, 4).map((a: any) => `${a.result}:${a.reason}`))}`,
    );

    // 6. NFC (NTAG 424 SUN) in software
    const { diversifyNtagKey } = await import("../../src/nfc/diversify.js");
    const { fromHex, toHex } = await import("../../src/nfc/bytes.js");
    const { counterToLe, encryptPiccData, sunCmac } = await import("../../src/nfc/sun.js");
    const UID = "04de5f1eacc040";
    const sun = (counter: number) => {
      const uid = fromHex(UID);
      const fileRead = diversifyNtagKey(fromHex("00112233445566778899aabbccddeeff"), uid, 3, "club-box");
      return {
        kind: "sun",
        area: "lounge",
        piccDataHex: toHex(encryptPiccData(fromHex("00000000000000000000000000000000"), uid, counter, fromHex("da5cf60941"))),
        cmacHex: toHex(sunCmac(fileRead, uid, counterToLe(counter))),
      };
    };
    const card = await api("POST", `/api/admin/members/${memberId}/cards`, { uid: UID, scheme: "ntag424-sun", label: "card" }, admin);
    const tap1 = await api("POST", "/api/access/nfc/reader", sun(1));
    const tap1again = await api("POST", "/api/access/nfc/reader", sun(1));
    const uidOnly = await api("POST", "/api/access/nfc/uid", { uid: UID, area: "lounge" });
    record(
      "6",
      "NFC card (simulated NTAG 424 SUN tap)",
      card.status === 201 && tap1.status === 200 && tap1again.status === 403 && uidOnly.status === 403 ? "PASS" : "FAIL",
      `issue card HTTP ${card.status}; first tap HTTP ${tap1.status}; replayed tap HTTP ${tap1again.status}; UID-only tap HTTP ${uidOnly.status} (UID mode off)`,
    );

    // 7. Vending / allowance
    const vending = await api("GET", "/api/vending");
    record("7", "Vending / member allowance", "N/A", `No vending or allowance code exists yet (roadmap only). GET /api/vending -> HTTP ${vending.status}.`);
  } finally {
    club?.kill();
    smtp.close();
  }
  const out = path.join(stateDir, `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify({ results, clubLog: clubLog.join("").split("\n").slice(-200) }, null, 2));
  console.log(`\nresults written to ${out}`);
  if (results.some((r) => r.result === "FAIL")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  club?.kill();
  process.exit(2);
});
