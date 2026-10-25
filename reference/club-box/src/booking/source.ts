// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import { many } from "../db.js";

/** Where a court occupancy row came from. Lightning is native. Playtomic is read-only import. */
export type BookingSourceId = "lightning" | "playtomic";

export type CalendarBlock = {
  source: BookingSourceId;
  courtId: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  /** Public label. Never a player name or email. */
  label: string;
};

export type BookingSource = {
  readonly id: BookingSourceId;
  blocks(db: Database.Database, from: string | null, to: string | null): CalendarBlock[];
};

export const lightningSource: BookingSource = {
  id: "lightning",
  blocks(db, from, to) {
    const rows = many<{
      court_id: string;
      court_name: string;
      starts_at: string;
      ends_at: string;
      status: string;
    }>(
      db,
      `SELECT s.court_id, c.name AS court_name, s.starts_at, s.ends_at, s.status
       FROM slots s
       JOIN courts c ON c.id = s.court_id
       WHERE s.status IN ('held', 'booked')
         AND (? IS NULL OR s.starts_at >= ?)
         AND (? IS NULL OR s.starts_at < ?)
       ORDER BY s.starts_at ASC
       LIMIT 500`,
      from,
      from,
      to,
      to,
    );
    return rows.map((row) => ({
      source: "lightning",
      courtId: row.court_id,
      courtName: row.court_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      label: row.status === "booked" ? "Lightning booking" : "Lightning hold",
    }));
  },
};

export const playtomicSource: BookingSource = {
  id: "playtomic",
  blocks(db, from, to) {
    const rows = many<{
      court_id: string;
      court_name: string;
      starts_at: string;
      ends_at: string;
    }>(
      db,
      `SELECT e.court_id, c.name AS court_name, e.starts_at, e.ends_at
       FROM external_bookings e
       JOIN courts c ON c.id = e.court_id
       WHERE e.source = 'playtomic'
         AND e.status = 'active'
         AND e.court_id IS NOT NULL
         AND (? IS NULL OR e.starts_at >= ?)
         AND (? IS NULL OR e.starts_at < ?)
       ORDER BY e.starts_at ASC
       LIMIT 500`,
      from,
      from,
      to,
      to,
    );
    return rows.map((row) => ({
      source: "playtomic",
      courtId: row.court_id,
      courtName: row.court_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      label: "Imported booking",
    }));
  },
};

export const bookingSources: readonly BookingSource[] = [lightningSource, playtomicSource];

export function listCalendar(db: Database.Database, from: string | null, to: string | null): CalendarBlock[] {
  return bookingSources.flatMap((source) => source.blocks(db, from, to));
}
