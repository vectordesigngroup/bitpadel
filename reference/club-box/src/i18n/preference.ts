// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import { loadClubBrand } from "../brand/store.js";
import { one } from "../db.js";
import { canonicalizeLocale, type LocaleId } from "./locales.js";

/**
 * Language for email and SMS.
 * Saved player or member language wins, then a booking or page hint, then the club default.
 */
export function localeForRecipient(
  db: Database.Database,
  input: {
    playerId?: string | null;
    memberId?: string | null;
    email?: string | null;
    phone?: string | null;
    hint?: string | null;
  },
): LocaleId {
  const saved =
    localeFromPlayerId(db, input.playerId) ??
    localeFromMemberId(db, input.memberId) ??
    localeFromEmail(db, input.email) ??
    localeFromPhone(db, input.phone);
  if (saved) return saved;
  return canonicalizeLocale(input.hint) ?? clubLocale(db);
}

export function clubLocale(db: Database.Database): LocaleId {
  return canonicalizeLocale(loadClubBrand(db).defaultLocale) ?? "en";
}

export function savePlayerLocale(db: Database.Database, playerId: string, locale: LocaleId | null): void {
  db.prepare("UPDATE players SET preferred_locale = ? WHERE id = ?").run(locale, playerId);
  const row = one<{ member_id: string | null }>(db, "SELECT member_id FROM players WHERE id = ?", playerId);
  if (row?.member_id) {
    db.prepare("UPDATE members SET preferred_locale = ? WHERE id = ?").run(locale, row.member_id);
  }
}

export function saveMemberLocale(db: Database.Database, memberId: string, locale: LocaleId | null): void {
  db.prepare("UPDATE members SET preferred_locale = ? WHERE id = ?").run(locale, memberId);
  db.prepare("UPDATE players SET preferred_locale = ? WHERE member_id = ?").run(locale, memberId);
}

function localeFromPlayerId(db: Database.Database, playerId: string | null | undefined): LocaleId | null {
  if (!playerId) return null;
  const row = one<{ preferred_locale: string | null }>(
    db,
    "SELECT preferred_locale FROM players WHERE id = ?",
    playerId,
  );
  return canonicalizeLocale(row?.preferred_locale);
}

function localeFromMemberId(db: Database.Database, memberId: string | null | undefined): LocaleId | null {
  if (!memberId) return null;
  const row = one<{ preferred_locale: string | null }>(
    db,
    "SELECT preferred_locale FROM members WHERE id = ?",
    memberId,
  );
  return canonicalizeLocale(row?.preferred_locale);
}

function localeFromEmail(db: Database.Database, email: string | null | undefined): LocaleId | null {
  const value = email?.trim();
  if (!value) return null;
  const player = one<{ preferred_locale: string | null }>(
    db,
    "SELECT preferred_locale FROM players WHERE lower(email) = lower(?) AND preferred_locale IS NOT NULL LIMIT 1",
    value,
  );
  const fromPlayer = canonicalizeLocale(player?.preferred_locale);
  if (fromPlayer) return fromPlayer;
  const member = one<{ preferred_locale: string | null }>(
    db,
    "SELECT preferred_locale FROM members WHERE lower(email) = lower(?) AND preferred_locale IS NOT NULL LIMIT 1",
    value,
  );
  return canonicalizeLocale(member?.preferred_locale);
}

function localeFromPhone(db: Database.Database, phone: string | null | undefined): LocaleId | null {
  const value = phone?.trim();
  if (!value) return null;
  const player = one<{ preferred_locale: string | null }>(
    db,
    "SELECT preferred_locale FROM players WHERE phone = ? AND preferred_locale IS NOT NULL LIMIT 1",
    value,
  );
  const fromPlayer = canonicalizeLocale(player?.preferred_locale);
  if (fromPlayer) return fromPlayer;
  const member = one<{ preferred_locale: string | null }>(
    db,
    "SELECT preferred_locale FROM members WHERE phone = ? AND preferred_locale IS NOT NULL LIMIT 1",
    value,
  );
  return canonicalizeLocale(member?.preferred_locale);
}
