// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { AccessDeps } from "../access/service.js";
import { encodeLnurl } from "../access/lnurl.js";
import { verifyLnurlAuthSignature } from "../access/verify.js";
import { one } from "../db.js";
import { AppError, LnurlError } from "../errors.js";
import { newK1 } from "../ids.js";
import { authenticateCard, type CardProof } from "../nfc/entry.js";

export type VendChallengeView = {
  k1: string;
  deviceId: string;
  expiresAt: string;
  httpsUrl: string;
  lnurl: string;
  status: "pending" | "verified" | "consumed" | "expired";
  memberId: string | null;
};

type ChallengeRow = {
  k1: string;
  device_id: string;
  member_id: string | null;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
};

/**
 * Mint an LNURL-auth challenge for a vending device. The wallet signature does not move sats
 * and does not pulse a door. The device charges only after the challenge is verified.
 */
export function mintVendChallenge(deps: AccessDeps, deviceId: string): VendChallengeView {
  const now = deps.now();
  const k1 = newK1();
  const expiresAt = new Date(now.getTime() + deps.config.k1TtlSeconds * 1000).toISOString();
  deps.db
    .prepare(
      `INSERT INTO vend_challenges (k1, device_id, member_id, expires_at, verified_at, consumed_at, created_at)
       VALUES (?, ?, NULL, ?, NULL, NULL, ?)`,
    )
    .run(k1, deviceId, expiresAt, now.toISOString());
  return viewOf(deps, {
    k1,
    device_id: deviceId,
    member_id: null,
    expires_at: expiresAt,
    verified_at: null,
    consumed_at: null,
  });
}

export function vendChallengeStatus(deps: AccessDeps, k1: string, deviceId: string | null): VendChallengeView | null {
  const row = loadChallenge(deps, k1);
  if (!row) return null;
  if (deviceId && row.device_id !== deviceId) return null;
  return viewOf(deps, row);
}

export function vendLnurlDocument(deps: AccessDeps, k1: string): { tag: "login"; k1: string; callback: string; action: "login" } {
  const row = loadChallenge(deps, k1);
  if (!row) throw new LnurlError("This code is not valid. Scan the screen again.");
  if (row.consumed_at || row.verified_at) throw new LnurlError("This code was already used. Scan the screen again.");
  if (row.expires_at <= deps.now().toISOString()) throw new LnurlError("This code expired. Scan the screen again.");
  return {
    tag: "login",
    k1: row.k1,
    callback: `${deps.config.publicBaseUrl}/api/devices/vending/callback`,
    action: "login",
  };
}

export function handleVendLogin(
  deps: AccessDeps,
  input: { k1: string; sig: string; key: string; ip: string },
): { status: "OK" } {
  if (!deps.callbacks.allow(`ip:${input.ip}`)) {
    throw new LnurlError("Too many attempts. Wait, then scan the new code.");
  }
  const k1 = input.k1.toLowerCase();
  const key = input.key.toLowerCase();
  if (!isK1(k1) || !isSignature(input.sig) || !isPubkey(key)) {
    throw new LnurlError("Malformed sign-in.");
  }
  if (!deps.callbacks.allow(`key:${key}`)) {
    throw new LnurlError("Too many attempts. Wait, then scan the new code.");
  }
  const row = loadChallenge(deps, k1);
  if (!row) throw new LnurlError("This code is not valid. Scan the screen again.");
  if (row.consumed_at || row.verified_at) throw new LnurlError("This code was already used. Scan the screen again.");
  if (row.expires_at <= deps.now().toISOString()) throw new LnurlError("This code expired. Scan the screen again.");
  if (!verifyLnurlAuthSignature(k1, input.sig, key)) throw new LnurlError("Signature did not verify.");
  const member = one<{ id: string; status: string; revoked_at: string | null }>(
    deps.db,
    `SELECT m.id, m.status, k.revoked_at
     FROM linking_keys k
     JOIN members m ON m.id = k.member_id
     WHERE k.pubkey = ?`,
    key,
  );
  if (!member) throw new LnurlError("This wallet is not enrolled.");
  if (member.status !== "active" || member.revoked_at) throw new LnurlError("Membership is not active.");
  const nowIso = deps.now().toISOString();
  const updated = deps.db
    .prepare(
      `UPDATE vend_challenges
       SET member_id = ?, verified_at = ?
       WHERE k1 = ? AND verified_at IS NULL AND consumed_at IS NULL`,
    )
    .run(member.id, nowIso, row.k1);
  if (updated.changes !== 1) throw new LnurlError("This code was already used. Scan the screen again.");
  return { status: "OK" };
}

/** Mark a verified challenge used. Call this inside the charge transaction. */
export function consumeVendChallenge(deps: AccessDeps, k1: string, deviceId: string, memberId: string): void {
  const info = deps.db
    .prepare(
      `UPDATE vend_challenges
       SET consumed_at = ?
       WHERE k1 = ? AND device_id = ? AND member_id = ? AND verified_at IS NOT NULL AND consumed_at IS NULL
         AND expires_at > ?`,
    )
    .run(deps.now().toISOString(), k1.toLowerCase(), deviceId, memberId, deps.now().toISOString());
  if (info.changes !== 1) throw new AppError(409, "This code was already used");
}

export function memberFromVendChallenge(deps: AccessDeps, k1: string, deviceId: string): string {
  const row = loadChallenge(deps, k1);
  if (!row || row.device_id !== deviceId) throw new AppError(404, "Code not found");
  if (row.expires_at <= deps.now().toISOString()) throw new AppError(403, "This code expired");
  if (!row.member_id || !row.verified_at) throw new AppError(409, "The wallet has not signed this code yet");
  if (row.consumed_at) throw new AppError(409, "This code was already used");
  return row.member_id;
}

export function memberFromCard(deps: AccessDeps, proof: CardProof): string {
  return authenticateCard(deps, proof).memberId;
}

function viewOf(deps: AccessDeps, row: ChallengeRow): VendChallengeView {
  const httpsUrl = `${deps.config.publicBaseUrl}/api/devices/vending/lnurl?tag=login&k1=${row.k1}`;
  return {
    k1: row.k1,
    deviceId: row.device_id,
    expiresAt: row.expires_at,
    httpsUrl,
    lnurl: encodeLnurl(httpsUrl),
    status: statusOf(row, deps.now().toISOString()),
    memberId: row.member_id,
  };
}

function statusOf(row: ChallengeRow, nowIso: string): VendChallengeView["status"] {
  if (row.consumed_at) return "consumed";
  if (row.expires_at <= nowIso && !row.verified_at) return "expired";
  if (row.verified_at) return "verified";
  return "pending";
}

function loadChallenge(deps: AccessDeps, k1: string): ChallengeRow | undefined {
  if (!isK1(k1)) return undefined;
  return one<ChallengeRow>(
    deps.db,
    `SELECT k1, device_id, member_id, expires_at, verified_at, consumed_at
     FROM vend_challenges WHERE k1 = ?`,
    k1.toLowerCase(),
  );
}

function isK1(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

function isPubkey(value: string): boolean {
  return /^(02|03)[0-9a-fA-F]{64}$/.test(value);
}

function isSignature(value: string): boolean {
  return /^[0-9a-fA-F]{64,160}$/.test(value);
}
