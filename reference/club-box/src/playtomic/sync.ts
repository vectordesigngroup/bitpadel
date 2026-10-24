import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { immediate, isUniqueError, many, one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import type { PlaytomicBooking, PlaytomicClient, PlaytomicPayment } from "./client.js";

export type SyncReport = {
  bookings: number;
  payments: number;
  conflicts: number;
  paymentError: string | null;
};

const DAY_MS = 86_400_000;

/**
 * Pull bookings and payments, then upsert them locally.
 * Nothing in this module sends a booking or payment write to Playtomic.
 */
export async function syncPlaytomic(
  db: Database.Database,
  config: AppConfig,
  client: PlaytomicClient,
  now: Date,
): Promise<SyncReport> {
  const start = new Date(now.getTime() - 90 * DAY_MS);
  const bookingEnd = new Date(now.getTime() + 274 * DAY_MS);
  const bookings = await client.listBookings(start, bookingEnd);
  let payments: PlaytomicPayment[] = [];
  let paymentError: string | null = null;
  try {
    payments = await client.listPayments(start, now);
  } catch (error) {
    paymentError = error instanceof Error ? error.message : "payments sync failed";
  }
  const conflicts = immediate(db, () => {
    for (const booking of bookings) upsertBooking(db, config, booking, now);
    for (const payment of payments) upsertPayment(db, payment, now);
    return countOpenConflicts(db);
  });
  return { bookings: bookings.length, payments: payments.length, conflicts, paymentError };
}

function upsertBooking(db: Database.Database, config: AppConfig, booking: PlaytomicBooking, now: Date): void {
  const court = one<{ court_id: string }>(
    db,
    "SELECT court_id FROM court_source_map WHERE source = 'playtomic' AND resource_id = ?",
    booking.resourceId,
  );
  const status = booking.canceled ? "canceled" : "active";
  const row = db
    .prepare(
      `INSERT INTO external_bookings (
         id, source, external_id, resource_id, resource_name, court_id, starts_at, ends_at, status, price_text, synced_at
       ) VALUES (?, 'playtomic', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source, external_id) DO UPDATE SET
         resource_id = excluded.resource_id,
         resource_name = excluded.resource_name,
         court_id = excluded.court_id,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         status = excluded.status,
         price_text = excluded.price_text,
         synced_at = excluded.synced_at
       RETURNING id`,
    )
    .get(
      newId("ext"),
      booking.bookingId,
      booking.resourceId,
      booking.resourceName,
      court?.court_id ?? null,
      booking.startsAt,
      booking.endsAt,
      status,
      booking.priceText,
      now.toISOString(),
    ) as { id: string };
  db.prepare("DELETE FROM external_players WHERE booking_id = ?").run(row.id);
  const insertPlayer = db.prepare(
    `INSERT INTO external_players (
       id, booking_id, player_id, email, display_name, participant_type, accepts_commercial
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const player of booking.participants) {
    insertPlayer.run(
      newId("plr"),
      row.id,
      player.participantId,
      player.email,
      player.name,
      player.participantType,
      player.acceptsCommercial ? 1 : 0,
    );
    syncCommercialConsent(db, config, player.email, player.acceptsCommercial, now);
  }
  refreshConflicts(db, booking, row.id, court?.court_id ?? null, status, now);
}

function syncCommercialConsent(
  db: Database.Database,
  config: AppConfig,
  email: string | null,
  accepts: boolean,
  now: Date,
): void {
  if (!email) return;
  const normalized = email.trim().toLowerCase();
  if (!accepts) {
    db.prepare(
      `UPDATE marketing_consents
       SET unsubscribed_at = ?
       WHERE source = 'playtomic' AND contact_kind = 'email' AND lower(contact_value) = ? AND unsubscribed_at IS NULL`,
    ).run(now.toISOString(), normalized);
    return;
  }
  const existing = one<{ id: string }>(
    db,
    `SELECT id FROM marketing_consents
     WHERE source = 'playtomic' AND contact_kind = 'email' AND lower(contact_value) = ? AND unsubscribed_at IS NULL`,
    normalized,
  );
  if (existing) return;
  db.prepare(
    `INSERT INTO marketing_consents (
       id, privacy_token, contact_kind, contact_value, consent_text_version, consented_at, unsubscribed_at, source
     ) VALUES (?, ?, 'email', ?, ?, ?, NULL, 'playtomic')`,
  ).run(newId("mkt"), randomBytes(24).toString("hex"), email.trim(), config.consentTextVersion, now.toISOString());
}

function refreshConflicts(
  db: Database.Database,
  booking: PlaytomicBooking,
  localId: string,
  courtId: string | null,
  status: "active" | "canceled",
  now: Date,
): void {
  const desired = new Set<string>();
  if (status === "active" && !courtId) {
    rememberConflict(db, desired, {
      kind: "unmapped-court",
      externalId: booking.bookingId,
      localBookingId: null,
      detail: `Playtomic court ${booking.resourceName} is not mapped to a local court`,
      now,
    });
  }
  if (status === "active" && courtId) {
    const overlaps = many<{ id: string; kind: string }>(
      db,
      `SELECT b.id, 'booking' AS kind
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       WHERE s.court_id = ? AND s.starts_at < ? AND s.ends_at > ?
       UNION ALL
       SELECT h.id, 'hold' AS kind
       FROM holds h
       JOIN slots s ON s.id = h.slot_id
       WHERE h.status = 'pending' AND s.court_id = ? AND s.starts_at < ? AND s.ends_at > ?
       LIMIT 20`,
      courtId,
      booking.endsAt,
      booking.startsAt,
      courtId,
      booking.endsAt,
      booking.startsAt,
    );
    for (const overlap of overlaps) {
      const localBookingId = overlap.kind === "booking" ? overlap.id : null;
      const keySuffix = overlap.kind === "booking" ? overlap.id : `hold:${overlap.id}`;
      rememberConflict(db, desired, {
        kind: "overlap",
        externalId: booking.bookingId,
        localBookingId,
        detail:
          overlap.kind === "booking"
            ? `Imported booking overlaps local booking ${overlap.id}`
            : `Imported booking overlaps pending hold ${overlap.id}`,
        now,
        keySuffix,
      });
    }
  }
  const open = many<{ conflict_key: string }>(
    db,
    "SELECT conflict_key FROM source_conflicts WHERE external_id = ? AND resolved_at IS NULL",
    booking.bookingId,
  );
  for (const row of open) {
    if (desired.has(row.conflict_key)) continue;
    db.prepare("UPDATE source_conflicts SET resolved_at = ? WHERE conflict_key = ?").run(
      now.toISOString(),
      row.conflict_key,
    );
  }
  void localId;
}

function rememberConflict(
  db: Database.Database,
  desired: Set<string>,
  input: {
    kind: "unmapped-court" | "overlap";
    externalId: string;
    localBookingId: string | null;
    detail: string;
    now: Date;
    keySuffix?: string;
  },
): void {
  const conflictKey = `${input.kind}:${input.externalId}:${input.keySuffix ?? input.localBookingId ?? ""}`;
  desired.add(conflictKey);
  db.prepare(
    `INSERT INTO source_conflicts (
       id, conflict_key, kind, external_id, local_booking_id, detail, created_at, resolved_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (conflict_key) DO UPDATE SET
       detail = excluded.detail,
       local_booking_id = excluded.local_booking_id,
       resolved_at = NULL`,
  ).run(
    newId("cnf"),
    conflictKey,
    input.kind,
    input.externalId,
    input.localBookingId,
    input.detail,
    input.now.toISOString(),
  );
}

function upsertPayment(db: Database.Database, payment: PlaytomicPayment, now: Date): void {
  db.prepare(
    `INSERT INTO playtomic_payments (
       club_payment_id, payment_id, refund_id, status, total_text, payment_date, service_date, product_sku, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (club_payment_id) DO UPDATE SET
       payment_id = excluded.payment_id,
       refund_id = excluded.refund_id,
       status = excluded.status,
       total_text = excluded.total_text,
       payment_date = excluded.payment_date,
       service_date = excluded.service_date,
       product_sku = excluded.product_sku,
       synced_at = excluded.synced_at`,
  ).run(
    payment.clubPaymentId,
    payment.paymentId,
    payment.refundId,
    payment.status,
    payment.totalText,
    payment.paymentDate,
    payment.serviceDate,
    payment.productSku,
    now.toISOString(),
  );
}

function countOpenConflicts(db: Database.Database): number {
  const row = one<{ n: number }>(db, "SELECT count(*) AS n FROM source_conflicts WHERE resolved_at IS NULL");
  return row?.n ?? 0;
}

export function mapPlaytomicCourt(db: Database.Database, courtId: string, resourceId: string): { id: string } {
  const court = one<{ id: string }>(db, "SELECT id FROM courts WHERE id = ?", courtId);
  if (!court) throw new AppError(404, "Court not found");
  const id = newId("map");
  try {
    db.prepare(
      `INSERT INTO court_source_map (id, court_id, source, resource_id) VALUES (?, ?, 'playtomic', ?)`,
    ).run(id, courtId, resourceId);
  } catch (error) {
    if (isUniqueError(error)) throw new AppError(409, "That Playtomic court is already mapped");
    throw error;
  }
  db.prepare(
    `UPDATE external_bookings SET court_id = ?
     WHERE source = 'playtomic' AND resource_id = ?`,
  ).run(courtId, resourceId);
  return { id };
}

export function listCourtMaps(
  db: Database.Database,
): Array<{ id: string; courtId: string; courtName: string; resourceId: string }> {
  return many<{ id: string; court_id: string; court_name: string; resource_id: string }>(
    db,
    `SELECT m.id, m.court_id, c.name AS court_name, m.resource_id
     FROM court_source_map m
     JOIN courts c ON c.id = m.court_id
     WHERE m.source = 'playtomic'
     ORDER BY c.name ASC`,
  ).map((row) => ({
    id: row.id,
    courtId: row.court_id,
    courtName: row.court_name,
    resourceId: row.resource_id,
  }));
}

export function deleteCourtMap(db: Database.Database, mapId: string): void {
  const row = one<{ resource_id: string }>(
    db,
    "SELECT resource_id FROM court_source_map WHERE id = ? AND source = 'playtomic'",
    mapId,
  );
  if (!row) return;
  db.prepare("DELETE FROM court_source_map WHERE id = ?").run(mapId);
  db.prepare(
    "UPDATE external_bookings SET court_id = NULL WHERE source = 'playtomic' AND resource_id = ?",
  ).run(row.resource_id);
}

export type ConflictView = {
  id: string;
  kind: "unmapped-court" | "overlap";
  externalId: string;
  localBookingId: string | null;
  detail: string;
  createdAt: string;
};

export function listOpenConflicts(db: Database.Database): ConflictView[] {
  return many<{
    id: string;
    kind: string;
    external_id: string;
    local_booking_id: string | null;
    detail: string;
    created_at: string;
  }>(
    db,
    `SELECT id, kind, external_id, local_booking_id, detail, created_at
     FROM source_conflicts WHERE resolved_at IS NULL ORDER BY created_at ASC LIMIT 200`,
  ).map((row) => ({
    id: row.id,
    kind: row.kind === "overlap" ? "overlap" : "unmapped-court",
    externalId: row.external_id,
    localBookingId: row.local_booking_id,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

export function resolveConflict(db: Database.Database, conflictId: string, now: Date): void {
  db.prepare("UPDATE source_conflicts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").run(
    now.toISOString(),
    conflictId,
  );
}
