// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { one } from "../db.js";
import { AppError } from "../errors.js";
import { translate } from "../i18n/catalog.js";
import { canonicalizeLocale, type LocaleId } from "../i18n/locales.js";
import { localeForRecipient } from "../i18n/preference.js";
import { newId } from "../ids.js";
import type { Notifier } from "../notify/types.js";
import { sendTransactional } from "../notify/service.js";

const CODE_ALPHABET = "0123456789";

export type PlayerView = {
  id: string;
  email: string;
  phone: string | null;
  memberId: string | null;
  preferredLocale: LocaleId | null;
};

export async function requestPlayerCode(
  db: Database.Database,
  notifier: Notifier,
  config: AppConfig,
  email: string,
  now: Date,
  hintLocale?: string | null,
): Promise<void> {
  const code = mintCode();
  const expires = new Date(now.getTime() + 15 * 60_000).toISOString();
  db.prepare(
    `INSERT INTO player_codes (id, email, code_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(newId("pcode"), email, hashCode(code), expires, now.toISOString());
  const link = `${config.publicBaseUrl}/account`;
  const locale = localeForRecipient(db, { email, hint: hintLocale });
  await sendTransactional(
    notifier,
    {
      channel: "email",
      kind: "transactional",
      to: email,
      subject: translate(locale, "email.login.subject"),
      text: translate(locale, "email.login.text", { code, link }),
    },
    { db, publicBaseUrl: config.publicBaseUrl },
  );
}

export function openPlayerSession(
  db: Database.Database,
  email: string,
  code: string,
  now: Date,
  ttlHours: number,
): { token: string; player: PlayerView } | null {
  const row = one<{ id: string; code_hash: string }>(
    db,
    `SELECT id, code_hash FROM player_codes
     WHERE email = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    email,
    now.toISOString(),
  );
  if (!row || !codesMatch(row.code_hash, hashCode(code))) return null;
  const used = db
    .prepare("UPDATE player_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .run(now.toISOString(), row.id);
  if (used.changes !== 1) return null;
  const player = ensurePlayer(db, email, now);
  const token = randomBytes(32).toString("hex");
  const expires = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
  db.prepare(
    `INSERT INTO player_sessions (id, player_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(newId("psess"), player.id, sha256(token), expires, now.toISOString());
  return { token, player };
}

export function playerFromRequest(
  db: Database.Database,
  headers: IncomingHttpHeaders,
  now: Date,
): PlayerView | null {
  const token = readCookie(headers, "player_session");
  if (!token) return null;
  const row = one<{
    id: string;
    email: string;
    phone: string | null;
    member_id: string | null;
    preferred_locale: string | null;
  }>(
    db,
    `SELECT p.id, p.email, p.phone, p.member_id, p.preferred_locale
     FROM player_sessions s
     JOIN players p ON p.id = s.player_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token),
    now.toISOString(),
  );
  if (!row) return null;
  return playerView(row);
}

export function playerIsPayingMember(db: Database.Database, playerId: string): boolean {
  const player = one<{ email: string; member_id: string | null }>(
    db,
    "SELECT email, member_id FROM players WHERE id = ?",
    playerId,
  );
  if (!player) return false;
  const member = player.member_id
    ? one<{ access_scope: string | null; status: string }>(
        db,
        "SELECT access_scope, status FROM members WHERE id = ?",
        player.member_id,
      )
    : one<{ access_scope: string | null; status: string }>(
        db,
        `SELECT access_scope, status FROM members
         WHERE lower(email) = ? AND status = 'active'
         ORDER BY created_at ASC LIMIT 1`,
        player.email,
      );
  if (!member || member.status !== "active") return false;
  return member.access_scope !== "booking";
}

export function attachPlayerMember(db: Database.Database, playerId: string, now: Date): string | null {
  const player = one<{ email: string; member_id: string | null }>(
    db,
    "SELECT email, member_id FROM players WHERE id = ?",
    playerId,
  );
  if (!player) return null;
  if (player.member_id) return player.member_id;
  const existing = one<{ id: string }>(
    db,
    "SELECT id FROM members WHERE lower(email) = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1",
    player.email,
  );
  if (existing) {
    db.prepare("UPDATE players SET member_id = ? WHERE id = ?").run(existing.id, playerId);
    return existing.id;
  }
  const memberId = newId("mem");
  db.prepare(
    `INSERT INTO members (id, label, status, created_at, email, access_scope)
     VALUES (?, ?, 'active', ?, ?, 'booking')`,
  ).run(memberId, player.email, now.toISOString(), player.email);
  db.prepare("UPDATE players SET member_id = ? WHERE id = ?").run(memberId, playerId);
  return memberId;
}

export function playerCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `player_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function ensurePlayer(db: Database.Database, email: string, now: Date): PlayerView {
  const existing = one<{
    id: string;
    email: string;
    phone: string | null;
    member_id: string | null;
    preferred_locale: string | null;
  }>(db, "SELECT id, email, phone, member_id, preferred_locale FROM players WHERE email = ?", email);
  if (existing) return playerView(existing);
  const id = newId("player");
  db.prepare("INSERT INTO players (id, email, phone, member_id, created_at) VALUES (?, ?, NULL, NULL, ?)").run(
    id,
    email,
    now.toISOString(),
  );
  return { id, email, phone: null, memberId: null, preferredLocale: null };
}

function playerView(row: {
  id: string;
  email: string;
  phone: string | null;
  member_id: string | null;
  preferred_locale: string | null;
}): PlayerView {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    memberId: row.member_id,
    preferredLocale: canonicalizeLocale(row.preferred_locale),
  };
}

function mintCode(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function hashCode(code: string): string {
  return sha256(code);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codesMatch(stored: string, incoming: string): boolean {
  const left = Buffer.from(stored);
  const right = Buffer.from(incoming);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function readCookie(headers: IncomingHttpHeaders, name: string): string {
  const raw = headers.cookie;
  if (typeof raw !== "string") return "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 200) {
    throw new AppError(400, "email must be an email address");
  }
  return email;
}
