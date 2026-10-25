// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { one } from "../db.js";

export type EntryGrant =
  | { ok: true; reason: "hours" | "booking-window" }
  | { ok: false; reason: "outside-hours" | "no-booking" };

/**
 * Members enter during area hours. A confirmed booking also opens the entry
 * pulse in the club's before/after window, including unstaffed hours.
 * Booking-only credentials (created from a player account) do not enter
 * outside that window. Fire release stays in hardware.
 */
export function entryGrant(
  db: Database.Database,
  config: AppConfig,
  memberId: string,
  now: Date,
  areaOpen: boolean,
): EntryGrant {
  const member = one<{ access_scope: string | null }>(
    db,
    "SELECT access_scope FROM members WHERE id = ?",
    memberId,
  );
  const scope = member?.access_scope === "booking" ? "booking" : "member";
  const covered = config.bookingEntry && bookingCovers(db, memberId, now, config);
  if (covered) return { ok: true, reason: "booking-window" };
  if (areaOpen && scope === "member") return { ok: true, reason: "hours" };
  if (!areaOpen) return { ok: false, reason: "outside-hours" };
  return { ok: false, reason: "no-booking" };
}

export function bookingCovers(db: Database.Database, memberId: string, now: Date, config: AppConfig): boolean {
  const before = config.bookingEntryBeforeMinutes * 60_000;
  const after = config.bookingEntryAfterMinutes * 60_000;
  const nowMs = now.getTime();
  const rows = db
    .prepare(
      `SELECT s.starts_at, s.ends_at
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       WHERE b.member_id = ?`,
    )
    .all(memberId) as Array<{ starts_at: string; ends_at: string }>;
  return rows.some((slot) => {
    const start = Date.parse(slot.starts_at) - before;
    const end = Date.parse(slot.ends_at) + after;
    return nowMs >= start && nowMs <= end;
  });
}
