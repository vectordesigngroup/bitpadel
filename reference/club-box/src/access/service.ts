import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { immediate, one } from "../db.js";
import { AppError, LnurlError } from "../errors.js";
import { newId, newK1 } from "../ids.js";
import { log } from "../log.js";
import type { RateLimiter } from "../rate-limit.js";
import { minutesOfDay } from "../time.js";
import { encodeLnurl } from "./lnurl.js";
import { verifyLnurlAuthSignature } from "./verify.js";
import type { DoorController } from "../doors/types.js";

export type AccessDeps = {
  config: AppConfig;
  db: Database.Database;
  door: DoorController;
  now: () => Date;
  callbacks: RateLimiter;
};

export type ChallengeView = {
  k1: string;
  purpose: "unlock" | "enroll";
  area: string | null;
  memberId: string | null;
  expiresAt: string;
  lnurl: string;
  httpsUrl: string;
};

export type ChallengeStatus = {
  k1: string;
  purpose: "unlock" | "enroll";
  area: string | null;
  expiresAt: string;
  status: "pending" | "expired" | "unlocked" | "denied" | "enrolled";
  reason: string | null;
};

export type MemberKeyView = {
  id: string;
  pubkey: string;
  enrolledAt: string;
  revokedAt: string | null;
};

export type MemberView = {
  id: string;
  label: string;
  status: "active" | "revoked";
  createdAt: string;
  keys: MemberKeyView[];
};

export type AuditView = {
  id: string;
  at: string;
  area: string | null;
  k1: string | null;
  pubkey: string | null;
  memberId: string | null;
  result: string;
  reason: string;
  doorResult: string | null;
};

type ChallengeRow = {
  k1: string;
  purpose: string;
  member_id: string | null;
  area: string | null;
  expires_at: string;
  used_at: string | null;
  outcome: string | null;
};

type KeyMember = {
  id: string;
  status: string;
  revoked_at: string | null;
};

export function createMember(db: Database.Database, label: string, now: Date): MemberView {
  const id = newId("mem");
  db.prepare("INSERT INTO members (id, label, status, created_at) VALUES (?, ?, 'active', ?)").run(
    id,
    label,
    now.toISOString(),
  );
  return { id, label, status: "active", createdAt: now.toISOString(), keys: [] };
}

export function listMembers(db: Database.Database): MemberView[] {
  const members = db
    .prepare("SELECT id, label, status, created_at FROM members ORDER BY created_at ASC")
    .all() as Array<{ id: string; label: string; status: string; created_at: string }>;
  const keys = db
    .prepare(
      "SELECT id, member_id, pubkey, enrolled_at, revoked_at FROM linking_keys ORDER BY enrolled_at ASC",
    )
    .all() as Array<{
    id: string;
    member_id: string;
    pubkey: string;
    enrolled_at: string;
    revoked_at: string | null;
  }>;
  return members.map((member) => ({
    id: member.id,
    label: member.label,
    status: member.status === "revoked" ? "revoked" : "active",
    createdAt: member.created_at,
    keys: keys
      .filter((key) => key.member_id === member.id)
      .map((key) => ({
        id: key.id,
        pubkey: key.pubkey,
        enrolledAt: key.enrolled_at,
        revokedAt: key.revoked_at,
      })),
  }));
}

export function setMemberStatus(
  db: Database.Database,
  memberId: string,
  status: "active" | "revoked",
): void {
  const existing = one<{ id: string }>(db, "SELECT id FROM members WHERE id = ?", memberId);
  if (!existing) throw new AppError(404, "Membership was not found");
  db.prepare("UPDATE members SET status = ? WHERE id = ?").run(status, memberId);
}

export function revokeKey(db: Database.Database, keyId: string, now: Date): void {
  const existing = one<{ revoked_at: string | null }>(
    db,
    "SELECT revoked_at FROM linking_keys WHERE id = ?",
    keyId,
  );
  if (!existing) throw new AppError(404, "Linking key was not found");
  if (existing.revoked_at) return;
  db.prepare("UPDATE linking_keys SET revoked_at = ? WHERE id = ?").run(now.toISOString(), keyId);
}

export function mintUnlockChallenge(deps: AccessDeps, area: string): ChallengeView {
  const now = deps.now();
  if (!areaIsOpen(now, area, deps.config)) {
    throw new AppError(403, "That area is closed right now");
  }
  return insertChallenge(deps, { purpose: "unlock", area, memberId: null });
}

export function mintEnrollChallenge(deps: AccessDeps, memberId: string): ChallengeView {
  const member = one<{ status: string }>(
    deps.db,
    "SELECT status FROM members WHERE id = ?",
    memberId,
  );
  if (!member) throw new AppError(404, "Membership was not found");
  if (member.status !== "active") throw new AppError(409, "Membership is not active");
  return insertChallenge(deps, { purpose: "enroll", area: null, memberId });
}

export function lnurlDocument(
  deps: AccessDeps,
  k1: string,
  purpose: "unlock" | "enroll",
): { tag: "login"; k1: string; callback: string; action: "login" | "register" } {
  const challenge = loadChallenge(deps.db, k1);
  if (!challenge || challenge.purpose !== purpose) {
    throw new LnurlError("This code is not valid. Scan the screen again.");
  }
  if (challenge.used_at) throw new LnurlError("This code was already used. Scan the screen again.");
  if (challenge.expires_at <= deps.now().toISOString()) {
    throw new LnurlError("This code expired. Scan the screen again.");
  }
  const callback =
    purpose === "unlock"
      ? `${deps.config.publicBaseUrl}/api/access/callback`
      : `${deps.config.publicBaseUrl}/api/access/enroll/callback`;
  return {
    tag: "login",
    k1: challenge.k1,
    callback,
    action: purpose === "unlock" ? "login" : "register",
  };
}

export function challengeStatus(deps: AccessDeps, k1: string): ChallengeStatus | null {
  const challenge = loadChallenge(deps.db, k1);
  if (!challenge) return null;
  const purpose = challengePurpose(challenge.purpose);
  if (!purpose) return null;
  const base = {
    k1: challenge.k1,
    purpose,
    area: challenge.area,
    expiresAt: challenge.expires_at,
  };
  if (!challenge.used_at || challenge.outcome === "opening") {
    if (challenge.expires_at <= deps.now().toISOString() && !challenge.used_at) {
      return { ...base, status: "expired", reason: "expired" };
    }
    return { ...base, status: "pending", reason: null };
  }
  if (challenge.outcome === "unlocked") return { ...base, status: "unlocked", reason: "unlocked" };
  if (challenge.outcome === "enrolled") return { ...base, status: "enrolled", reason: "enrolled" };
  return { ...base, status: "denied", reason: challenge.outcome ?? "denied" };
}

export function challengeQrText(deps: AccessDeps, k1: string): string | null {
  const status = challengeStatus(deps, k1);
  if (!status || status.status === "expired") return null;
  return status.purpose === "enroll"
    ? encodeLnurl(`${deps.config.publicBaseUrl}/api/access/enroll/lnurl?k1=${k1}`)
    : encodeLnurl(`${deps.config.publicBaseUrl}/api/access/lnurl?k1=${k1}`);
}

export async function handleUnlock(
  deps: AccessDeps,
  input: { k1: string; sig: string; key: string; ip: string },
): Promise<{ status: "OK" }> {
  guardCallback(deps, input, null);
  const decision = immediate(deps.db, () => decideUnlock(deps, input));
  if (!decision.ok) throw new LnurlError(decision.message);
  const pulse = await deps.door.pulseEntry({
    area: decision.area,
    requestId: decision.auditId,
    pulseMs: deps.config.doorPulseMs,
  });
  deps.db
    .prepare("UPDATE challenges SET outcome = ? WHERE k1 = ?")
    .run(pulse.ok ? "unlocked" : "door-failed", input.k1.toLowerCase());
  if (!pulse.ok) {
    writeAudit(deps.db, {
      id: decision.auditId,
      at: deps.now().toISOString(),
      area: decision.area,
      k1: input.k1.toLowerCase(),
      pubkey: input.key.toLowerCase(),
      memberId: decision.memberId,
      result: "error",
      reason: pulse.reason === "rejected" ? "door-rejected" : "door-unreachable",
      doorResult: pulse.reason,
    });
    log("error", "entry pulse failed", { area: decision.area, reason: pulse.reason });
    throw new LnurlError("Entry controller did not respond. Use a fob, PIN, or staff.");
  }
  writeAudit(deps.db, {
    id: decision.auditId,
    at: deps.now().toISOString(),
    area: decision.area,
    k1: input.k1.toLowerCase(),
    pubkey: input.key.toLowerCase(),
    memberId: decision.memberId,
    result: "unlocked",
    reason: "unlocked",
    doorResult: "pulsed",
  });
  log("info", "entry pulsed", { area: decision.area });
  return { status: "OK" };
}

export function handleEnroll(
  deps: AccessDeps,
  input: { k1: string; sig: string; key: string; ip: string },
): { status: "OK" } {
  guardCallback(deps, input, null);
  const decision = immediate(deps.db, () => decideEnroll(deps, input));
  if (!decision.ok) throw new LnurlError(decision.message);
  return { status: "OK" };
}

export function listAudit(db: Database.Database, limit: number): AuditView[] {
  const rows = db
    .prepare(
      `SELECT id, at, area, k1, pubkey, member_id, result, reason, door_result
       FROM access_audit ORDER BY at DESC, rowid DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    at: string;
    area: string | null;
    k1: string | null;
    pubkey: string | null;
    member_id: string | null;
    result: string;
    reason: string;
    door_result: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    area: row.area,
    k1: row.k1,
    pubkey: row.pubkey,
    memberId: row.member_id,
    result: row.result,
    reason: row.reason,
    doorResult: row.door_result,
  }));
}

function guardCallback(
  deps: AccessDeps,
  input: { k1: string; sig: string; key: string; ip: string },
  area: string | null,
): void {
  if (!deps.callbacks.allow(`ip:${input.ip}`)) {
    writeAudit(deps.db, {
      id: newId("aud"),
      at: deps.now().toISOString(),
      area,
      k1: isK1(input.k1) ? input.k1.toLowerCase() : null,
      pubkey: null,
      memberId: null,
      result: "denied",
      reason: "rate-limited",
      doorResult: null,
    });
    throw new LnurlError("Too many attempts. Wait, then scan the new code.");
  }
}

type Denial = { ok: false; message: string };
type UnlockOk = { ok: true; area: string; memberId: string; auditId: string };

function decideUnlock(deps: AccessDeps, input: { k1: string; sig: string; key: string }): UnlockOk | Denial {
  const nowIso = deps.now().toISOString();
  const k1 = input.k1.toLowerCase();
  const key = input.key.toLowerCase();
  if (!isK1(k1) || !isSignature(input.sig) || !isPubkey(key)) {
    deny(deps, { k1: isK1(k1) ? k1 : null, pubkey: null, area: null, memberId: null, reason: "malformed" });
    return { ok: false, message: "Malformed sign-in." };
  }
  if (!deps.callbacks.allow(`key:${key}`)) {
    deny(deps, { k1, pubkey: key, area: null, memberId: null, reason: "rate-limited" });
    return { ok: false, message: "Too many attempts. Wait, then scan the new code." };
  }
  const challenge = loadChallenge(deps.db, k1);
  if (!challenge || challenge.purpose !== "unlock") {
    deny(deps, { k1, pubkey: key, area: null, memberId: null, reason: "unknown-challenge" });
    return { ok: false, message: "This code is not valid. Scan the screen again." };
  }
  if (challenge.used_at) {
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: null, reason: "replay" });
    return { ok: false, message: "This code was already used. Scan the screen again." };
  }
  if (challenge.expires_at <= nowIso) {
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: null, reason: "expired" });
    return { ok: false, message: "This code expired. Scan the screen again." };
  }
  if (!verifyLnurlAuthSignature(k1, input.sig, key)) {
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: null, reason: "bad-signature" });
    return { ok: false, message: "Signature did not verify." };
  }
  if (!consumeChallenge(deps.db, k1, nowIso, "opening")) {
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: null, reason: "replay" });
    return { ok: false, message: "This code was already used. Scan the screen again." };
  }
  const member = one<KeyMember>(
    deps.db,
    `SELECT m.id, m.status, k.revoked_at
     FROM linking_keys k
     JOIN members m ON m.id = k.member_id
     WHERE k.pubkey = ?`,
    key,
  );
  if (!member) {
    finishChallenge(deps.db, k1, "unknown-key");
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: null, reason: "unknown-key" });
    return { ok: false, message: "This wallet is not enrolled." };
  }
  if (member.status !== "active" || member.revoked_at) {
    finishChallenge(deps.db, k1, "member-inactive");
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: member.id, reason: "member-inactive" });
    return { ok: false, message: "Membership is not active." };
  }
  if (!challenge.area || !deps.config.areas.includes(challenge.area)) {
    finishChallenge(deps.db, k1, "unknown-area");
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: member.id, reason: "unknown-area" });
    return { ok: false, message: "That area is not available." };
  }
  if (!areaIsOpen(deps.now(), challenge.area, deps.config)) {
    finishChallenge(deps.db, k1, "outside-hours");
    deny(deps, { k1, pubkey: key, area: challenge.area, memberId: member.id, reason: "outside-hours" });
    return { ok: false, message: "That area is closed right now." };
  }
  return { ok: true, area: challenge.area, memberId: member.id, auditId: newId("aud") };
}

function decideEnroll(
  deps: AccessDeps,
  input: { k1: string; sig: string; key: string },
): { ok: true } | Denial {
  const nowIso = deps.now().toISOString();
  const k1 = input.k1.toLowerCase();
  const key = input.key.toLowerCase();
  if (!isK1(k1) || !isSignature(input.sig) || !isPubkey(key)) {
    deny(deps, { k1: isK1(k1) ? k1 : null, pubkey: null, area: null, memberId: null, reason: "malformed" });
    return { ok: false, message: "Malformed sign-in." };
  }
  if (!deps.callbacks.allow(`key:${key}`)) {
    deny(deps, { k1, pubkey: key, area: null, memberId: null, reason: "rate-limited" });
    return { ok: false, message: "Too many attempts. Wait, then scan the new code." };
  }
  const challenge = loadChallenge(deps.db, k1);
  if (!challenge || challenge.purpose !== "enroll" || !challenge.member_id) {
    deny(deps, { k1, pubkey: key, area: null, memberId: null, reason: "unknown-challenge" });
    return { ok: false, message: "This enrollment code is not valid." };
  }
  if (challenge.used_at) {
    deny(deps, { k1, pubkey: key, area: null, memberId: challenge.member_id, reason: "replay" });
    return { ok: false, message: "This code was already used." };
  }
  if (challenge.expires_at <= nowIso) {
    deny(deps, { k1, pubkey: key, area: null, memberId: challenge.member_id, reason: "expired" });
    return { ok: false, message: "This code expired. Ask staff for a new one." };
  }
  if (!verifyLnurlAuthSignature(k1, input.sig, key)) {
    deny(deps, { k1, pubkey: key, area: null, memberId: challenge.member_id, reason: "bad-signature" });
    return { ok: false, message: "Signature did not verify." };
  }
  if (!consumeChallenge(deps.db, k1, nowIso, "enrolled")) {
    deny(deps, { k1, pubkey: key, area: null, memberId: challenge.member_id, reason: "replay" });
    return { ok: false, message: "This code was already used." };
  }
  const member = one<{ status: string }>(
    deps.db,
    "SELECT status FROM members WHERE id = ?",
    challenge.member_id,
  );
  if (!member || member.status !== "active") {
    finishChallenge(deps.db, k1, "member-inactive");
    deny(deps, { k1, pubkey: key, area: null, memberId: challenge.member_id, reason: "member-inactive" });
    return { ok: false, message: "Membership is not active." };
  }
  const existing = one<{ id: string; member_id: string; revoked_at: string | null }>(
    deps.db,
    "SELECT id, member_id, revoked_at FROM linking_keys WHERE pubkey = ?",
    key,
  );
  if (existing && existing.member_id !== challenge.member_id) {
    finishChallenge(deps.db, k1, "key-in-use");
    deny(deps, { k1, pubkey: key, area: null, memberId: challenge.member_id, reason: "key-in-use" });
    return { ok: false, message: "This wallet is enrolled to another membership." };
  }
  if (existing && existing.revoked_at) {
    deps.db
      .prepare("UPDATE linking_keys SET revoked_at = NULL, enrolled_at = ? WHERE id = ?")
      .run(nowIso, existing.id);
  } else if (!existing) {
    deps.db
      .prepare(
        "INSERT INTO linking_keys (id, member_id, pubkey, enrolled_at, revoked_at) VALUES (?, ?, ?, ?, NULL)",
      )
      .run(newId("key"), challenge.member_id, key, nowIso);
  }
  writeAudit(deps.db, {
    id: newId("aud"),
    at: nowIso,
    area: null,
    k1,
    pubkey: key,
    memberId: challenge.member_id,
    result: "enrolled",
    reason: existing && !existing.revoked_at ? "already-enrolled" : "enrolled",
    doorResult: null,
  });
  return { ok: true };
}

function insertChallenge(
  deps: AccessDeps,
  input: { purpose: "unlock" | "enroll"; area: string | null; memberId: string | null },
): ChallengeView {
  const now = deps.now();
  const k1 = newK1();
  const expiresAt = new Date(now.getTime() + deps.config.k1TtlSeconds * 1000).toISOString();
  deps.db
    .prepare(
      `INSERT INTO challenges (k1, purpose, member_id, area, expires_at, used_at, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .run(k1, input.purpose, input.memberId, input.area, expiresAt, now.toISOString());
  const path = input.purpose === "enroll" ? "/api/access/enroll/lnurl" : "/api/access/lnurl";
  const httpsUrl = `${deps.config.publicBaseUrl}${path}?k1=${k1}`;
  return {
    k1,
    purpose: input.purpose,
    area: input.area,
    memberId: input.memberId,
    expiresAt,
    httpsUrl,
    lnurl: encodeLnurl(httpsUrl),
  };
}

function loadChallenge(db: Database.Database, k1: string): ChallengeRow | undefined {
  if (!isK1(k1)) return undefined;
  return one<ChallengeRow>(
    db,
    "SELECT k1, purpose, member_id, area, expires_at, used_at, outcome FROM challenges WHERE k1 = ?",
    k1.toLowerCase(),
  );
}

function consumeChallenge(db: Database.Database, k1: string, nowIso: string, outcome: string): boolean {
  const info = db
    .prepare("UPDATE challenges SET used_at = ?, outcome = ? WHERE k1 = ? AND used_at IS NULL")
    .run(nowIso, outcome, k1);
  return info.changes === 1;
}

function finishChallenge(db: Database.Database, k1: string, outcome: string): void {
  db.prepare("UPDATE challenges SET outcome = ? WHERE k1 = ?").run(outcome, k1);
}

function deny(
  deps: AccessDeps,
  row: {
    k1: string | null;
    pubkey: string | null;
    area: string | null;
    memberId: string | null;
    reason: string;
  },
): void {
  writeAudit(deps.db, {
    id: newId("aud"),
    at: deps.now().toISOString(),
    area: row.area,
    k1: row.k1,
    pubkey: row.pubkey,
    memberId: row.memberId,
    result: "denied",
    reason: row.reason,
    doorResult: null,
  });
}

function writeAudit(
  db: Database.Database,
  row: {
    id: string;
    at: string;
    area: string | null;
    k1: string | null;
    pubkey: string | null;
    memberId: string | null;
    result: string;
    reason: string;
    doorResult: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO access_audit (id, at, area, k1, pubkey, member_id, result, reason, door_result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.at, row.area, row.k1, row.pubkey, row.memberId, row.result, row.reason, row.doorResult);
}

function areaIsOpen(now: Date, area: string, config: AppConfig): boolean {
  const window = config.areaHours[area];
  if (!window) return true;
  const minutes = minutesOfDay(now, config.clubTimeZone);
  if (window.startMin < window.endMin) {
    return minutes >= window.startMin && minutes < window.endMin;
  }
  return minutes >= window.startMin || minutes < window.endMin;
}

function challengePurpose(value: string): "unlock" | "enroll" | null {
  if (value === "unlock" || value === "enroll") return value;
  return null;
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
