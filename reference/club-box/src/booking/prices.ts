import type Database from "better-sqlite3";
import { many } from "../db.js";
import { zonedClock } from "../time.js";

export type PriceQuoteInput = {
  courtId: string;
  startsAt: string;
  priceMinor: number;
};

type RuleRow = {
  court_id: string | null;
  days: string;
  start_min: number;
  end_min: number;
  member_price_minor: number;
  guest_price_minor: number;
};

/** Slot price after peak and member rules. The stored slot price is the fallback. */
export function quotePrice(
  db: Database.Database,
  slot: PriceQuoteInput,
  member: boolean,
  timeZone: string,
): number {
  const rules = many<RuleRow>(
    db,
    `SELECT court_id, days, start_min, end_min, member_price_minor, guest_price_minor
     FROM price_rules
     ORDER BY created_at ASC`,
  );
  if (rules.length === 0) return slot.priceMinor;
  const clock = zonedClock(new Date(slot.startsAt), timeZone);
  const matches = rules.filter((rule) => ruleMatches(rule, slot.courtId, clock.weekday, clock.minutes));
  const courtSpecific = matches.filter((rule) => rule.court_id === slot.courtId);
  const pool = courtSpecific.length > 0 ? courtSpecific : matches.filter((rule) => rule.court_id === null);
  const chosen = pool[0];
  if (!chosen) return slot.priceMinor;
  return member ? chosen.member_price_minor : chosen.guest_price_minor;
}

function ruleMatches(rule: RuleRow, courtId: string, weekday: number, minutes: number): boolean {
  if (rule.court_id !== null && rule.court_id !== courtId) return false;
  const days = rule.days.split(",").filter((part) => part.length > 0);
  if (days.length > 0 && !days.includes(String(weekday))) return false;
  if (rule.start_min === rule.end_min) return true;
  if (rule.start_min < rule.end_min) return minutes >= rule.start_min && minutes < rule.end_min;
  return minutes >= rule.start_min || minutes < rule.end_min;
}
