// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import { one } from "../db.js";

export const ALLOWANCE_PERIODS = ["visit", "day", "week", "month"] as const;
export type AllowancePeriod = (typeof ALLOWANCE_PERIODS)[number];

export function isAllowancePeriod(value: string): value is AllowancePeriod {
  switch (value) {
    case "visit":
    case "day":
    case "week":
    case "month":
      return true;
    default:
      return false;
  }
}

/**
 * Window key for allowance draws. A new key starts a fresh allowance.
 * Unused amount from an older key is not added on. This app does not pay that remainder out.
 */
export function periodKeyFor(
  db: Database.Database,
  period: AllowancePeriod,
  memberId: string,
  now: Date,
  timeZone: string,
  checkinStaleMinutes: number,
): string | null {
  switch (period) {
    case "visit":
      return openVisitKey(db, memberId, now, checkinStaleMinutes);
    case "day":
    case "week":
    case "month":
      return civilPeriodKey(period, now, timeZone);
    default: {
      const unknown: never = period;
      throw new Error(`Unknown allowance period: ${String(unknown)}`);
    }
  }
}

function civilPeriodKey(period: "day" | "week" | "month", now: Date, timeZone: string): string {
  const civil = civilYmd(now, timeZone);
  switch (period) {
    case "day":
      return `day:${civil.year}-${civil.month}-${civil.day}`;
    case "month":
      return `month:${civil.year}-${civil.month}`;
    case "week":
      return isoWeekKey(Number(civil.year), Number(civil.month), Number(civil.day));
    default: {
      const unknown: never = period;
      throw new Error(`Unknown civil period: ${String(unknown)}`);
    }
  }
}

function openVisitKey(
  db: Database.Database,
  memberId: string,
  now: Date,
  checkinStaleMinutes: number,
): string | null {
  const earliest = new Date(now.getTime() - checkinStaleMinutes * 60_000).toISOString();
  const row = one<{ id: string }>(
    db,
    `SELECT id FROM checkins
     WHERE member_id = ? AND checked_out_at IS NULL AND arrived_at > ?
     ORDER BY arrived_at DESC
     LIMIT 1`,
    memberId,
    earliest,
  );
  if (!row) return null;
  return `visit:${row.id}`;
}

function civilYmd(date: Date, timeZone: string): { year: string; month: string; day: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = map.year;
  const month = map.month;
  const day = map.day;
  if (!year || !month || !day) throw new Error("missing civil date");
  return { year, month, day };
}

/**
 * ISO week of a civil date. Thursday decides the year.
 * Both instants are UTC midnights, so the day count is an integer.
 */
export function isoWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const diffDays = (thursday.getTime() - yearStart) / 86_400_000;
  if (!Number.isInteger(diffDays)) throw new Error("week math was not an integer");
  const week = Math.floor(diffDays / 7) + 1;
  return `week:${isoYear}-W${String(week).padStart(2, "0")}`;
}
