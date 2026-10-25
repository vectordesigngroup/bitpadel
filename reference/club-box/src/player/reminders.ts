import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import type { Notifier } from "../notify/types.js";
import { sendTransactional } from "../notify/service.js";
import { log } from "../log.js";

/**
 * Booking reminders are opt-in at checkout and are sent as transactional
 * messages. They do not consult the marketing consent list.
 */
export async function runDueReminders(
  db: Database.Database,
  notifier: Notifier,
  config: AppConfig,
  now: Date,
): Promise<number> {
  const horizon = new Date(now.getTime() + config.reminderHoursBefore * 3_600_000).toISOString();
  const rows = db
    .prepare(
      `SELECT b.id, s.starts_at, c.name AS court_name, h.reminder_email, h.reminder_sms,
              h.reminder_phone, h.receipt_email, p.email AS player_email
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       JOIN courts c ON c.id = s.court_id
       JOIN holds h ON h.id = b.hold_id
       LEFT JOIN players p ON p.id = b.player_id
       WHERE s.starts_at > ? AND s.starts_at <= ?`,
    )
    .all(now.toISOString(), horizon) as Array<{
    id: string;
    starts_at: string;
    court_name: string;
    reminder_email: number;
    reminder_sms: number;
    reminder_phone: string | null;
    receipt_email: string | null;
    player_email: string | null;
  }>;
  let sent = 0;
  for (const row of rows) {
    const when = new Date(row.starts_at).toISOString();
    const text = `Reminder: ${row.court_name} starts at ${when}. This is a booking reminder, not marketing.`;
    if (row.reminder_email === 1) {
      const to = row.player_email || row.receipt_email;
      if (to && (await sendOnce(db, notifier, row.id, "email", to, `Reminder for ${row.court_name}`, text, now))) {
        sent += 1;
      }
    }
    if (row.reminder_sms === 1 && row.reminder_phone) {
      if (await sendOnce(db, notifier, row.id, "sms", row.reminder_phone, null, text, now)) sent += 1;
    }
  }
  return sent;
}

async function sendOnce(
  db: Database.Database,
  notifier: Notifier,
  bookingId: string,
  channel: "email" | "sms",
  to: string,
  subject: string | null,
  text: string,
  now: Date,
): Promise<boolean> {
  const inserted = db
    .prepare("INSERT OR IGNORE INTO reminder_log (booking_id, channel, sent_at) VALUES (?, ?, ?)")
    .run(bookingId, channel, now.toISOString());
  if (inserted.changes !== 1) return false;
  try {
    await sendTransactional(notifier, { channel, kind: "transactional", to, subject, text });
    return true;
  } catch (error) {
    db.prepare("DELETE FROM reminder_log WHERE booking_id = ? AND channel = ?").run(bookingId, channel);
    log("error", "reminder failed", { error: error instanceof Error ? error.message : "error" });
    return false;
  }
}
