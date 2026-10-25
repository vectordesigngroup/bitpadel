// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { etc } from "@noble/secp256k1";
import { decodeLnurl } from "../src/access/lnurl.js";
import { verifyLnurlAuthSignature } from "../src/access/verify.js";
import {
  ADMIN_TOKEN,
  adminHeaders,
  api,
  compactToDer,
  freshKey,
  signK1,
  startTestApp,
} from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("LNURL-auth accepts compact, recoverable, and DER signatures", async () => {
  const signer = await freshKey();
  const k1 = etc.bytesToHex(etc.randomBytes(32));
  const compact = await signK1(signer.privateKey, k1);
  assert.equal(verifyLnurlAuthSignature(k1, compact, signer.pubkey), true);
  assert.equal(verifyLnurlAuthSignature(k1.toUpperCase(), compact.toUpperCase(), signer.pubkey.toUpperCase()), true);
  assert.equal(verifyLnurlAuthSignature(k1, `${compact}00`, signer.pubkey), true);
  assert.equal(verifyLnurlAuthSignature(k1, compactToDer(compact), signer.pubkey), true);

  const other = await freshKey();
  assert.equal(verifyLnurlAuthSignature(k1, compact, other.pubkey), false);
  const flipped = etc.bytesToHex(etc.randomBytes(32));
  assert.equal(verifyLnurlAuthSignature(flipped, compact, signer.pubkey), false);
  assert.equal(verifyLnurlAuthSignature(k1, compact.slice(0, -2) + (compact.endsWith("00") ? "01" : "00"), signer.pubkey), false);
  assert.equal(verifyLnurlAuthSignature("zz", compact, signer.pubkey), false);
  assert.equal(verifyLnurlAuthSignature(k1, "1234", signer.pubkey), false);
});

test("enrolled active member unlocks once, and a bad signature does not burn the code", async () => {
  const app = await startTestApp();
  try {
    const member = await api(app.baseUrl, "/api/admin/members", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ label: "membership-number" }),
    });
    assert.equal(member.status, 201);
    const memberId = (member.body.member as { id: string }).id;
    const enroll = await api(app.baseUrl, `/api/admin/members/${memberId}/enroll`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(enroll.status, 201);
    const enrollChallenge = enroll.body.challenge as { k1: string; lnurl: string; httpsUrl: string };
    assert.equal(decodeLnurl(enrollChallenge.lnurl), enrollChallenge.httpsUrl);

    const signer = await freshKey();
    const enrollSig = await signK1(signer.privateKey, enrollChallenge.k1);
    const enrolled = await api(
      app.baseUrl,
      `/api/access/enroll/callback?k1=${enrollChallenge.k1}&sig=${enrollSig}&key=${signer.pubkey}`,
    );
    assert.equal(enrolled.status, 200);
    assert.equal(enrolled.body.status, "OK");
    assert.equal(app.door.pulses.length, 0);

    const door = await api(app.baseUrl, "/api/access/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area: "lounge" }),
    });
    assert.equal(door.status, 201);
    const challenge = door.body.challenge as { k1: string; lnurl: string };
    const login = await api(app.baseUrl, `/api/access/lnurl?k1=${challenge.k1}`);
    assert.equal(login.body.tag, "login");
    assert.equal(login.body.k1, challenge.k1);
    assert.equal(typeof login.body.callback, "string");

    const bad = await api(
      app.baseUrl,
      `/api/access/callback?k1=${challenge.k1}&sig=${"ab".repeat(32)}&key=${signer.pubkey}`,
    );
    assert.equal(bad.body.status, "ERROR");
    assert.equal(app.door.pulses.length, 0);

    const goodSig = await signK1(signer.privateKey, challenge.k1);
    const opened = await api(
      app.baseUrl,
      `/api/access/callback?k1=${challenge.k1}&sig=${goodSig}&key=${signer.pubkey}`,
    );
    assert.equal(opened.body.status, "OK");
    assert.equal(app.door.pulses.length, 1);
    assert.equal(app.door.pulses[0]?.area, "lounge");
    assert.equal(app.door.pulses[0]?.pulseMs, app.config.doorPulseMs);

    const replay = await api(
      app.baseUrl,
      `/api/access/callback?k1=${challenge.k1}&sig=${goodSig}&key=${signer.pubkey}`,
    );
    assert.equal(replay.body.status, "ERROR");
    assert.match(String(replay.body.reason), /already used/i);
    assert.equal(app.door.pulses.length, 1);

    const status = await api(app.baseUrl, `/api/access/challenges/${challenge.k1}`);
    assert.equal((status.body.challenge as { status: string }).status, "unlocked");
    const audit = await api(app.baseUrl, "/api/admin/audit", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    assert.equal(audit.status, 200);
    const rows = audit.body.audit as Array<{ result: string }>;
    assert.ok(rows.some((row) => row.result === "unlocked"));
  } finally {
    await app.close();
  }
});

test("expired, unknown, revoked, and out-of-hours signatures do not pulse the door", async () => {
  const app = await startTestApp({
    ACCESS_AREA_HOURS: "lounge=09:00-10:00",
    CLUB_TIMEZONE: "UTC",
    K1_TTL_SECONDS: "30",
  });
  try {
    app.setNow(new Date("2026-06-01T09:30:00.000Z"));
    const signer = await freshKey();
    const member = await api(app.baseUrl, "/api/admin/members", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ label: "membership-number" }),
    });
    const memberId = (member.body.member as { id: string }).id;
    await enroll(app.baseUrl, memberId, signer);

    const expiredMint = await api(app.baseUrl, "/api/access/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area: "lounge" }),
    });
    const expiredK1 = (expiredMint.body.challenge as { k1: string }).k1;
    app.setNow(new Date("2026-06-01T09:31:00.000Z"));
    const expiredSig = await signK1(signer.privateKey, expiredK1);
    const expired = await api(
      app.baseUrl,
      `/api/access/callback?k1=${expiredK1}&sig=${expiredSig}&key=${signer.pubkey}`,
    );
    assert.equal(expired.body.status, "ERROR");
    assert.match(String(expired.body.reason), /expired/i);

    app.setNow(new Date("2026-06-01T09:30:00.000Z"));
    const stranger = await freshKey();
    const strangerMint = await mint(app.baseUrl);
    const strangerSig = await signK1(stranger.privateKey, strangerMint);
    const strangerResult = await api(
      app.baseUrl,
      `/api/access/callback?k1=${strangerMint}&sig=${strangerSig}&key=${stranger.pubkey}`,
    );
    assert.match(String(strangerResult.body.reason), /not enrolled/i);

    await api(app.baseUrl, `/api/admin/members/${memberId}/revoke`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const revokedMint = await mint(app.baseUrl);
    const revokedSig = await signK1(signer.privateKey, revokedMint);
    const revoked = await api(
      app.baseUrl,
      `/api/access/callback?k1=${revokedMint}&sig=${revokedSig}&key=${signer.pubkey}`,
    );
    assert.match(String(revoked.body.reason), /not active/i);

    await api(app.baseUrl, `/api/admin/members/${memberId}/restore`, {
      method: "POST",
      headers: adminHeaders(),
    });
    app.setNow(new Date("2026-06-01T15:00:00.000Z"));
    const closed = await api(app.baseUrl, "/api/access/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area: "lounge" }),
    });
    assert.equal(closed.status, 403);
    assert.equal(app.door.pulses.length, 0);
  } finally {
    await app.close();
  }
});

test("callback rate limit trips before another signature is accepted", async () => {
  const app = await startTestApp({ RATE_LIMIT_MAX: "2" });
  try {
    const mintResult = await mint(app.baseUrl);
    const signer = await freshKey();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await api(
        app.baseUrl,
        `/api/access/callback?k1=${mintResult}&sig=${"11".repeat(32)}&key=${signer.pubkey}`,
      );
      assert.equal(response.body.status, "ERROR");
      assert.match(String(response.body.reason), /did not verify/i);
    }
    const limited = await api(
      app.baseUrl,
      `/api/access/callback?k1=${mintResult}&sig=${"11".repeat(32)}&key=${signer.pubkey}`,
    );
    assert.match(String(limited.body.reason), /too many/i);
    assert.equal(app.door.pulses.length, 0);
  } finally {
    await app.close();
  }
});

test("kiosk page states entry-only and free egress without the API", () => {
  const html = readFileSync(path.join(here, "..", "public", "kiosk.html"), "utf8");
  assert.match(html, /cannot lock a door shut/i);
  assert.match(html, /Leaving does not use this service/);
});

async function enroll(
  baseUrl: string,
  memberId: string,
  signer: { privateKey: Uint8Array; pubkey: string },
): Promise<void> {
  const challenge = await api(baseUrl, `/api/admin/members/${memberId}/enroll`, {
    method: "POST",
    headers: adminHeaders(),
  });
  const k1 = (challenge.body.challenge as { k1: string }).k1;
  const sig = await signK1(signer.privateKey, k1);
  const result = await api(baseUrl, `/api/access/enroll/callback?k1=${k1}&sig=${sig}&key=${signer.pubkey}`);
  assert.equal(result.body.status, "OK");
}

async function mint(baseUrl: string): Promise<string> {
  const door = await api(baseUrl, "/api/access/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "lounge" }),
  });
  assert.equal(door.status, 201);
  return (door.body.challenge as { k1: string }).k1;
}
