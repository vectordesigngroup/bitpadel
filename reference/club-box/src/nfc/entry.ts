import type { AccessDeps } from "../access/service.js";
import { assertAreaAvailable, finishEntry, recordAudit } from "../access/service.js";
import { isUniqueError, one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import { aesCmac, equalBytes, truncateMac } from "./aes.js";
import { fromHex } from "./bytes.js";
import { diversifyDesfireKey, diversifyNtagKey } from "./diversify.js";
import type { CardPresentation } from "./reader.js";
import { counterToLe, decryptSunPicc, verifySunMessage } from "./sun.js";

type CardRow = {
  id: string;
  member_id: string;
  scheme: string;
  status: string;
  counter: number;
  member_status: string;
};

type ResolvedCard = {
  memberId: string;
  uid: string;
  credentialType: "ntag424-sun" | "desfire" | "uid-insecure";
};

/**
 * Verify a card presentation and pulse entry.
 * SUN CMAC uses the diversified file-read key. The DESFire proof is an AES-CMAC
 * over the UID and little-endian counter after the reader has completed EV2.
 */
export async function presentCard(
  deps: AccessDeps,
  presentation: CardPresentation,
  ip: string,
): Promise<{ checkinId: string; token: string; displayName: string }> {
  if (!deps.callbacks.allow(`ip:${ip}`)) throw new AppError(429, "Too many attempts. Wait and try again.");
  if (!deps.config.bookingEntry) assertAreaAvailable(deps, presentation.area);
  const card = resolveCard(deps, presentation);
  if (!deps.callbacks.allow(`card:${card.uid}`)) throw new AppError(429, "Too many attempts. Wait and try again.");
  const view = await finishEntry(deps, {
    memberId: card.memberId,
    area: presentation.area,
    credentialType: card.credentialType,
    credentialRef: card.uid,
    k1: null,
    pubkey: null,
  });
  return { checkinId: view.id, token: view.token, displayName: view.displayName };
}

function resolveCard(deps: AccessDeps, presentation: CardPresentation): ResolvedCard {
  switch (presentation.kind) {
    case "sun":
      return resolveSun(deps, presentation);
    case "desfire":
      return resolveDesfire(deps, presentation);
    case "uid-insecure":
      return resolveUid(deps, presentation);
    default: {
      const unknown: never = presentation;
      throw new AppError(400, `Unknown card presentation ${String(unknown)}`);
    }
  }
}

function resolveSun(deps: AccessDeps, presentation: Extract<CardPresentation, { kind: "sun" }>): ResolvedCard {
  const keys = deps.config.nfc.keys;
  if (!keys.masterKey || !keys.metaReadKey) throw new AppError(503, "Card verification is not configured");
  const opened = decryptSunPicc(keys.metaReadKey, presentation.piccDataHex);
  if (!opened) throw new AppError(401, "Card authentication failed");
  const fileReadKey = diversifyNtagKey(keys.masterKey, opened.uid, 3, keys.systemId);
  const verified = verifySunMessage({
    piccDataHex: presentation.piccDataHex,
    cmacHex: presentation.cmacHex,
    metaReadKey: keys.metaReadKey,
    fileReadKey,
  });
  if (!verified) throw new AppError(401, "Card authentication failed");
  const card = loadActiveCard(deps, verified.uid, "ntag424-sun");
  advanceCounter(deps, card, verified.counter);
  return { memberId: card.member_id, uid: verified.uid.toString("hex"), credentialType: "ntag424-sun" };
}

function resolveDesfire(
  deps: AccessDeps,
  presentation: Extract<CardPresentation, { kind: "desfire" }>,
): ResolvedCard {
  const master = deps.config.nfc.keys.masterKey;
  if (!master) throw new AppError(503, "Card verification is not configured");
  let uid: Buffer;
  let presented: Buffer;
  try {
    uid = fromHex(presentation.uidHex);
    presented = fromHex(presentation.cmacHex);
  } catch {
    throw new AppError(400, "Card data is malformed");
  }
  if (uid.length !== 7 || presented.length !== 8) throw new AppError(400, "Card data is malformed");
  const key = diversifyDesfireKey(master, uid, 1, deps.config.nfc.keys.systemId);
  const mac = truncateMac(aesCmac(key, Buffer.concat([uid, counterToLe(presentation.counter)])));
  if (!equalBytes(mac, presented)) throw new AppError(401, "Card authentication failed");
  const card = loadActiveCard(deps, uid, "desfire");
  advanceCounter(deps, card, presentation.counter);
  return { memberId: card.member_id, uid: uid.toString("hex"), credentialType: "desfire" };
}

function resolveUid(deps: AccessDeps, presentation: Extract<CardPresentation, { kind: "uid-insecure" }>): ResolvedCard {
  if (deps.config.nfc.uidMode !== "insecure-dev") throw new AppError(403, "UID-only cards are disabled");
  let uid: Buffer;
  try {
    uid = fromHex(presentation.uidHex);
  } catch {
    throw new AppError(400, "Card data is malformed");
  }
  const card = loadActiveCard(deps, uid, "uid-insecure");
  return { memberId: card.member_id, uid: uid.toString("hex"), credentialType: "uid-insecure" };
}

function loadActiveCard(deps: AccessDeps, uid: Buffer, scheme: string): CardRow {
  if (uid.length !== 7) throw new AppError(400, "UID must be 7 bytes");
  const row = one<CardRow>(
    deps.db,
    `SELECT c.id, c.member_id, c.scheme, c.status, c.counter, m.status AS member_status
     FROM card_credentials c
     JOIN members m ON m.id = c.member_id
     WHERE c.uid = ?`,
    uid.toString("hex"),
  );
  if (!row || row.scheme !== scheme) {
    denyCard(deps, null, "unknown-card");
    throw new AppError(401, "This card is not enrolled");
  }
  if (row.status === "revoked" || row.status === "lost") {
    denyCard(deps, row.member_id, row.status);
    throw new AppError(403, row.status === "lost" ? "This card was reported lost" : "This card was revoked");
  }
  if (row.status !== "active" || row.member_status !== "active") {
    denyCard(deps, row.member_id, "member-inactive");
    throw new AppError(403, "Membership is not active");
  }
  return row;
}

function advanceCounter(deps: AccessDeps, card: CardRow, counter: number): void {
  const info = deps.db
    .prepare(
      "UPDATE card_credentials SET counter = ?, updated_at = ? WHERE id = ? AND status = 'active' AND counter < ?",
    )
    .run(counter, deps.now().toISOString(), card.id, counter);
  if (info.changes !== 1) {
    denyCard(deps, card.member_id, "counter-replay");
    throw new AppError(403, "This card counter was already used");
  }
}

function denyCard(deps: AccessDeps, memberId: string | null, reason: string): void {
  recordAudit(deps.db, {
    id: newId("aud"),
    at: deps.now().toISOString(),
    area: null,
    k1: null,
    pubkey: null,
    memberId,
    result: "denied",
    reason,
    doorResult: null,
    credentialType: "nfc",
    credentialRef: null,
  });
}

export function issueCard(
  db: AccessDeps["db"],
  memberId: string,
  input: { uid: string; scheme: "ntag424-sun" | "desfire" | "uid-insecure"; label: string; now: Date },
): { id: string } {
  const member = one<{ status: string }>(db, "SELECT status FROM members WHERE id = ?", memberId);
  if (!member) throw new AppError(404, "Membership was not found");
  if (member.status !== "active") throw new AppError(409, "Membership is not active");
  const uid = normalizeUid(input.uid);
  const existing = one<{ id: string; member_id: string; status: string }>(
    db,
    "SELECT id, member_id, status FROM card_credentials WHERE uid = ?",
    uid,
  );
  const nowIso = input.now.toISOString();
  if (existing && existing.status === "active" && existing.member_id !== memberId) {
    throw new AppError(409, "That card is active on another membership");
  }
  if (existing) {
    db.prepare(
      `UPDATE card_credentials
       SET member_id = ?, scheme = ?, status = 'active', counter = -1, label = ?, updated_at = ?
       WHERE id = ?`,
    ).run(memberId, input.scheme, input.label, nowIso, existing.id);
    return { id: existing.id };
  }
  const id = newId("card");
  try {
    db.prepare(
      `INSERT INTO card_credentials (id, member_id, scheme, uid, status, counter, label, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', -1, ?, ?, ?)`,
    ).run(id, memberId, input.scheme, uid, input.label, nowIso, nowIso);
  } catch (error) {
    if (isUniqueError(error)) throw new AppError(409, "That card is already enrolled");
    throw error;
  }
  return { id };
}

export function setCardStatus(db: AccessDeps["db"], cardId: string, status: "revoked" | "lost", now: Date): void {
  const info = db
    .prepare("UPDATE card_credentials SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, now.toISOString(), cardId);
  if (info.changes !== 1) throw new AppError(404, "Card was not found");
}

function normalizeUid(uid: string): string {
  const trimmed = uid.trim().toLowerCase();
  if (!/^[0-9a-f]{14}$/.test(trimmed)) throw new AppError(400, "UID must be 7 bytes of hex");
  return trimmed;
}
