import assert from "node:assert/strict";
import test from "node:test";
import { diversifyDesfireKey, diversifyNtagKey } from "../src/nfc/diversify.js";
import { aesCmac, truncateMac } from "../src/nfc/aes.js";
import { fromHex, toHex } from "../src/nfc/bytes.js";
import { counterToLe, encryptPiccData, sunCmac } from "../src/nfc/sun.js";
import {
  ADMIN_TOKEN,
  api,
  freshKey,
  signK1,
  startTestApp,
  type RunningApp,
} from "./helpers.js";

const UID = "04de5f1eacc040";
const MASTER = "00112233445566778899aabbccddeeff";
const META = "00000000000000000000000000000000";

test("profiles, guests, and privacy stay separate from marketing", async () => {
  const app = await startTestApp({
    GUEST_LIMIT: "2",
    STAFF_TOKEN: "test-staff-token-0123456789",
    CHECKIN_STALE_MINUTES: "30",
  });
  try {
    const member = await api(app.baseUrl, "/api/admin/members", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ label: "M-100" }),
    });
    const memberId = (member.body.member as { id: string }).id;
    const profile = await api(app.baseUrl, `/api/admin/members/${memberId}/profile`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        displayName: "Placeholder Member",
        phone: "5550100",
        email: "member@example.invalid",
        membershipType: "standard",
      }),
    });
    assert.equal(profile.status, 200);
    const png = Buffer.from("89504e470d0a1a0a0000", "hex");
    const photo = await api(app.baseUrl, `/api/admin/members/${memberId}/photo`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ contentType: "image/png", data: png.toString("base64") }),
    });
    assert.equal(photo.status, 200);
    const household = await api(app.baseUrl, "/api/admin/households", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ label: "Placeholder household", primaryMemberId: memberId }),
    });
    assert.equal(household.status, 201);
    const dependent = await api(app.baseUrl, "/api/admin/members", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ label: "M-101" }),
    });
    const dependentId = (dependent.body.member as { id: string }).id;
    const linked = await api(app.baseUrl, `/api/admin/households/${(household.body as { id: string }).id}/members`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ memberId: dependentId, role: "dependent" }),
    });
    assert.equal(linked.status, 200);
    const checkin = await unlock(app, memberId);
    assert.equal(checkin.displayName, "Placeholder Member");
    assert.equal(checkin.hasPhoto, true);
    assert.equal("email" in checkin, false);
    const counted = await api(app.baseUrl, `/api/checkins/${checkin.id}/guest-count`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: checkin.token, guestCount: 1 }),
    });
    assert.equal(counted.status, 200);
    const declined = await api(app.baseUrl, `/api/checkins/${checkin.id}/guests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: checkin.token,
        displayName: "Placeholder Guest",
        contactKind: "email",
        contactValue: "guest@example.invalid",
        waiverAccepted: true,
        marketingConsent: false,
      }),
    });
    assert.equal(declined.status, 201);
    const quiet = await fetch(`${app.baseUrl}/api/admin/marketing.csv`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    assert.equal((await quiet.text()).trim(), "contact_kind,contact_value,consented_at,consent_text_version,source");
    const guestId = String(declined.body.guestId);
    const privacyToken = String(declined.body.privacyToken);
    const removed = await api(app.baseUrl, `/api/checkins/${checkin.id}/guests/${guestId}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: checkin.token }),
    });
    assert.equal(removed.status, 200);
    const still = await api(app.baseUrl, `/api/checkins/${checkin.id}?token=${checkin.token}`);
    assert.equal((still.body.checkin as { guestCount: number }).guestCount, 1);
    const opted = await api(app.baseUrl, `/api/checkins/${checkin.id}/guests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: checkin.token,
        displayName: "Placeholder Guest",
        contactKind: "email",
        contactValue: "guest@example.invalid",
        waiverAccepted: true,
        marketingConsent: true,
      }),
    });
    assert.equal(opted.status, 201);
    const csv = await fetch(`${app.baseUrl}/api/admin/marketing.csv`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    const exported = await csv.text();
    assert.match(exported, /guest@example.invalid/);
    assert.doesNotMatch(exported, /privacy|book/);
    const unsub = await api(app.baseUrl, "/api/privacy/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: String(opted.body.privacyToken) }),
    });
    assert.equal(unsub.status, 200);
    const deleted = await api(app.baseUrl, "/api/privacy/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: privacyToken }),
    });
    assert.equal(deleted.status, 200);
    const onsite = await api(app.baseUrl, "/api/staff/onsite", {
      headers: { authorization: "Bearer test-staff-token-0123456789" },
    });
    assert.equal((onsite.body.members as unknown[]).length, 1);
    app.setNow(new Date(app.now().getTime() + 31 * 60_000));
    const later = await api(app.baseUrl, "/api/staff/onsite", {
      headers: { authorization: "Bearer test-staff-token-0123456789" },
    });
    assert.equal((later.body.members as unknown[]).length, 0);
    assert.equal(later.body.headcount, 0);
  } finally {
    await app.close();
  }
});

test("SUN cards reject replays and revoked credentials, and UID mode stays off", async () => {
  const app = await startTestApp({
    NFC_MASTER_KEY: MASTER,
    NFC_SDM_META_READ_KEY: META,
    NFC_SYSTEM_ID: "club-box",
    GUEST_LIMIT: "0",
  });
  try {
    const memberId = await member(app);
    const issued = await api(app.baseUrl, `/api/admin/members/${memberId}/cards`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ uid: UID, scheme: "ntag424-sun", label: "card" }),
    });
    assert.equal(issued.status, 201);
    const uidOnly = await api(app.baseUrl, "/api/access/nfc/uid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: UID, area: "lounge" }),
    });
    assert.equal(uidOnly.status, 403);
    const first = await api(app.baseUrl, "/api/access/nfc/reader", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sunBody(1)),
    });
    assert.equal(first.status, 200);
    const replay = await api(app.baseUrl, "/api/access/nfc/reader", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sunBody(1)),
    });
    assert.equal(replay.status, 403);
    const cardId = (issued.body.card as { id: string }).id;
    await api(app.baseUrl, `/api/admin/cards/${cardId}/revoke`, { method: "POST", headers: auth() });
    const revoked = await api(app.baseUrl, "/api/access/nfc/reader", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sunBody(2)),
    });
    assert.equal(revoked.status, 403);
  } finally {
    await app.close();
  }
});

test("DESFire proof uses the diversified application key", async () => {
  const app = await startTestApp({
    NFC_MASTER_KEY: MASTER,
    NFC_SDM_META_READ_KEY: META,
    NFC_SYSTEM_ID: "club-box",
  });
  try {
    const memberId = await member(app);
    await api(app.baseUrl, `/api/admin/members/${memberId}/cards`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ uid: UID, scheme: "desfire", label: "desk" }),
    });
    const uid = fromHex(UID);
    const key = diversifyDesfireKey(fromHex(MASTER), uid, 1, "club-box");
    const cmac = toHex(truncateMac(aesCmac(key, Buffer.concat([uid, counterToLe(4)]))));
    const opened = await api(app.baseUrl, "/api/access/nfc/desfire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: UID, counter: 4, cmac, area: "lounge" }),
    });
    assert.equal(opened.status, 200);
    const audit = await api(app.baseUrl, "/api/admin/audit", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    const rows = audit.body.audit as Array<{ credentialType: string; result: string }>;
    assert.equal(rows.some((row) => row.credentialType === "desfire" && row.result === "unlocked"), true);
  } finally {
    await app.close();
  }
});

function sunBody(counter: number): { kind: "sun"; area: string; piccDataHex: string; cmacHex: string } {
  const uid = fromHex(UID);
  const meta = fromHex(META);
  const fileRead = diversifyNtagKey(fromHex(MASTER), uid, 3, "club-box");
  return {
    kind: "sun",
    area: "lounge",
    piccDataHex: toHex(encryptPiccData(meta, uid, counter, fromHex("da5cf60941"))),
    cmacHex: toHex(sunCmac(fileRead, uid, counterToLe(counter))),
  };
}

async function member(app: RunningApp): Promise<string> {
  const created = await api(app.baseUrl, "/api/admin/members", {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ label: "M-100" }),
  });
  return (created.body.member as { id: string }).id;
}

async function unlock(app: RunningApp, memberId: string) {
  const wallet = await freshKey();
  const enroll = await api(app.baseUrl, `/api/admin/members/${memberId}/enroll`, {
    method: "POST",
    headers: auth(),
  });
  const enrollChallenge = enroll.body.challenge as { k1: string };
  const enrollSig = await signK1(wallet.privateKey, enrollChallenge.k1);
  const enrolled = await api(
    app.baseUrl,
    `/api/access/enroll/callback?k1=${enrollChallenge.k1}&key=${wallet.pubkey}&sig=${enrollSig}`,
  );
  assert.equal(enrolled.body.status, "OK");
  const door = await api(app.baseUrl, "/api/access/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "lounge" }),
  });
  const challenge = door.body.challenge as { k1: string };
  const sig = await signK1(wallet.privateKey, challenge.k1);
  const opened = await api(app.baseUrl, `/api/access/callback?k1=${challenge.k1}&key=${wallet.pubkey}&sig=${sig}`);
  assert.equal(opened.body.status, "OK");
  const status = await api(app.baseUrl, `/api/access/challenges/${challenge.k1}`);
  const view = (status.body.challenge as { checkin: { id: string; token: string; displayName: string; hasPhoto: boolean } }).checkin;
  return view;
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
}
