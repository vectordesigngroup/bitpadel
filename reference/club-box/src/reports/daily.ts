import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { log } from "../log.js";
import type { Notifier } from "../notify/types.js";
import { sendTransactional } from "../notify/service.js";
import { zonedClock, zonedLocalToUtc } from "../time.js";

export type DailySummary = {
  date: string;
  currency: string;
  methods: Array<{ method: string; count: number; amountMinor: number }>;
  refunds: { count: number; amountMinor: number };
};

type MoneyRow = { method: string; count: number; amount: number };

export function dailySummary(db: Database.Database, config: AppConfig, date: string): DailySummary {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, "date must be YYYY-MM-DD");
  const { fromIso, toIso } = dayBounds(date, config.clubTimeZone);
  const sales = db
    .prepare(
      `SELECT payment_method AS method, COUNT(*) AS count, SUM(amount_minor) AS amount
       FROM (
         SELECT payment_method, amount_minor, confirmed_at FROM bookings
         UNION ALL
         SELECT payment_method, amount_minor, confirmed_at FROM cancelled_bookings
       )
       WHERE confirmed_at >= ? AND confirmed_at <= ?
       GROUP BY payment_method
       ORDER BY payment_method ASC`,
    )
    .all(fromIso, toIso) as MoneyRow[];
  const refund = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS amount
       FROM refunds WHERE created_at >= ? AND created_at <= ?`,
    )
    .get(fromIso, toIso) as { count: number; amount: number };
  return {
    date,
    currency: config.currency,
    methods: sales.map((row) => ({ method: row.method, count: row.count, amountMinor: row.amount })),
    refunds: { count: refund.count, amountMinor: refund.amount },
  };
}

export function summaryText(summary: DailySummary): string {
  const lines = [`Sales for ${summary.date} (${summary.currency} minor units)`];
  if (summary.methods.length === 0) lines.push("No payments.");
  for (const row of summary.methods) {
    lines.push(`${row.method}: ${row.count} payment(s), ${row.amountMinor}`);
  }
  lines.push(`Refunds: ${summary.refunds.count}, ${summary.refunds.amountMinor}`);
  return lines.join("\n");
}

export async function maybeSendDailySummary(
  db: Database.Database,
  notifier: Notifier,
  config: AppConfig,
  now: Date,
): Promise<boolean> {
  if (!config.dailySummaryEmail) return false;
  const clock = zonedClock(now, config.clubTimeZone);
  if (clock.minutes < 21 * 60) return false;
  const date = clubDate(now, config.clubTimeZone);
  const existing = db.prepare("SELECT club_date FROM summary_log WHERE club_date = ?").get(date) as
    | { club_date: string }
    | undefined;
  if (existing) return false;
  const summary = dailySummary(db, config, date);
  try {
    await sendTransactional(notifier, {
      channel: "email",
      kind: "transactional",
      to: config.dailySummaryEmail,
      subject: `Daily sales ${date}`,
      text: summaryText(summary),
    });
  } catch (error) {
    log("error", "daily summary failed", { error: error instanceof Error ? error.message : "error" });
    return false;
  }
  db.prepare("INSERT INTO summary_log (club_date, sent_at) VALUES (?, ?)").run(date, now.toISOString());
  return true;
}

export function clubDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

function dayBounds(date: string, timeZone: string): { fromIso: string; toIso: string } {
  let start: Date;
  try {
    start = zonedLocalToUtc(date, "00:00", timeZone);
  } catch {
    throw new AppError(400, "date must be YYYY-MM-DD");
  }
  const end = new Date(start.getTime() + 86_400_000 - 1);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}
