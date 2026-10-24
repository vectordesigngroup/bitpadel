import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { isUniqueError, many, one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import { localDayBounds } from "../time.js";

export type CheckinPublic = {
  id: string;
  token: string;
  displayName: string;
  membershipType: string;
  guestCount: number;
  guestLimit: number;
  hasPhoto: boolean;
};

export type OnSiteMember = {
  checkinId: string;
  memberId: string;
  displayName: string;
  membershipType: string;
  area: string | null;
  credentialType: string;
  arrivedAt: string;
  guestCount: number;
  hasPhoto: boolean;
  externalBookingId: string | null;
};

export type OnSiteView = {
  members: OnSiteMember[];
  guestCount: number;
  headcount: number;
};

const PHOTO_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function recordArrival(
  db: Database.Database,
  config: AppConfig,
  input: {
    memberId: string;
    area: string | null;
    credentialType: string;
    credentialRef: string | null;
    now: Date;
  },
): CheckinPublic {
  const open = one<{ id: string }>(
    db,
    "SELECT id FROM checkins WHERE member_id = ? AND checked_out_at IS NULL ORDER BY arrived_at DESC LIMIT 1",
    input.memberId,
  );
  const id = open?.id ?? newId("chk");
  if (!open) {
    db.prepare(
      `INSERT INTO checkins (
         id, member_id, area, credential_type, credential_ref, token, external_booking_id,
         arrived_at, guest_count, checked_out_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL)`,
    ).run(
      id,
      input.memberId,
      input.area,
      input.credentialType,
      input.credentialRef,
      randomBytes(24).toString("hex"),
      input.now.toISOString(),
    );
  }
  attachPlaytomicBooking(db, config, id, input.memberId, input.now);
  const view = publicCheckin(db, config, id);
  if (!view) throw new Error("check-in missing after it was recorded");
  return view;
}

export function publicCheckin(db: Database.Database, config: AppConfig, checkinId: string): CheckinPublic | null {
  const row = one<{
    id: string;
    token: string;
    label: string;
    display_name: string | null;
    membership_type: string;
    guest_count: number;
    guest_limit: number | null;
    photo_path: string | null;
  }>(
    db,
    `SELECT c.id, c.token, m.label, m.display_name, m.membership_type, c.guest_count, m.guest_limit, m.photo_path
     FROM checkins c
     JOIN members m ON m.id = c.member_id
     WHERE c.id = ?`,
    checkinId,
  );
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    displayName: row.display_name?.trim() || row.label,
    membershipType: row.membership_type,
    guestCount: row.guest_count,
    guestLimit: row.guest_limit ?? config.guestLimit,
    hasPhoto: Boolean(row.photo_path),
  };
}

export function readCheckinByToken(
  db: Database.Database,
  config: AppConfig,
  checkinId: string,
  token: string,
): CheckinPublic {
  const row = publicCheckin(db, config, checkinId);
  if (!row || !safeToken(row.token, token)) throw new AppError(404, "Check-in was not found");
  return row;
}

export function setGuestCount(
  db: Database.Database,
  config: AppConfig,
  checkinId: string,
  token: string,
  guestCount: number,
): CheckinPublic {
  const current = loadOwned(db, checkinId, token);
  const limit = current.guest_limit ?? config.guestLimit;
  if (guestCount > limit) throw new AppError(409, "That guest count is over the member's limit");
  const named = namedGuestCount(db, checkinId);
  if (guestCount < named) throw new AppError(409, "Remove named guests before lowering the count");
  db.prepare("UPDATE checkins SET guest_count = ? WHERE id = ?").run(guestCount, checkinId);
  const view = publicCheckin(db, config, checkinId);
  if (!view) throw new Error("check-in missing");
  return view;
}

export function addNamedGuest(
  db: Database.Database,
  config: AppConfig,
  checkinId: string,
  token: string,
  input: {
    displayName: string;
    contactKind: "email" | "phone";
    contactValue: string;
    waiverAccepted: boolean;
    marketingConsent: boolean;
    now: Date;
  },
): { guestId: string; privacyToken: string } {
  if (!input.waiverAccepted) throw new AppError(400, "A waiver acknowledgement is required");
  const current = loadOwned(db, checkinId, token);
  const limit = current.guest_limit ?? config.guestLimit;
  const named = namedGuestCount(db, checkinId);
  if (named + 1 > current.guest_count) {
    throw new AppError(409, "Raise the guest count before adding another name");
  }
  if (current.guest_count > limit) throw new AppError(409, "That guest count is over the member's limit");
  const privacyToken = randomBytes(24).toString("hex");
  const guestId = newId("gst");
  const externalId = matchGuestBooking(db, config, input.contactKind, input.contactValue, input.now);
  db.prepare(
    `INSERT INTO guests (
       id, checkin_id, host_member_id, display_name, contact_kind, contact_value,
       waiver_version, waiver_accepted_at, privacy_token, external_booking_id, deleted_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    guestId,
    checkinId,
    current.member_id,
    input.displayName,
    input.contactKind,
    input.contactValue,
    config.waiverTextVersion,
    input.now.toISOString(),
    privacyToken,
    externalId,
    input.now.toISOString(),
  );
  if (!current.external_booking_id && externalId) {
    db.prepare("UPDATE checkins SET external_booking_id = ? WHERE id = ? AND external_booking_id IS NULL").run(
      externalId,
      checkinId,
    );
  }
  if (input.marketingConsent) {
    db.prepare(
      `INSERT INTO marketing_consents (
         id, privacy_token, contact_kind, contact_value, consent_text_version, consented_at, unsubscribed_at, source
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'kiosk')`,
    ).run(
      newId("mkt"),
      privacyToken,
      input.contactKind,
      input.contactValue,
      config.consentTextVersion,
      input.now.toISOString(),
    );
  }
  return { guestId, privacyToken };
}

export function deleteGuest(db: Database.Database, checkinId: string, guestId: string, token: string, now: Date): void {
  loadOwned(db, checkinId, token);
  const info = db
    .prepare(
      `UPDATE guests
       SET display_name = NULL, contact_kind = NULL, contact_value = NULL, deleted_at = ?
       WHERE id = ? AND checkin_id = ? AND deleted_at IS NULL`,
    )
    .run(now.toISOString(), guestId, checkinId);
  if (info.changes !== 1) throw new AppError(404, "Guest was not found");
}

export function checkout(db: Database.Database, checkinId: string, now: Date): void {
  const info = db
    .prepare("UPDATE checkins SET checked_out_at = ? WHERE id = ? AND checked_out_at IS NULL")
    .run(now.toISOString(), checkinId);
  if (info.changes !== 1) throw new AppError(404, "Open check-in was not found");
}

export function expireStaleCheckins(db: Database.Database, config: AppConfig, now: Date): number {
  const cutoff = new Date(now.getTime() - config.checkinStaleMinutes * 60_000).toISOString();
  const info = db
    .prepare("UPDATE checkins SET checked_out_at = ? WHERE checked_out_at IS NULL AND arrived_at < ?")
    .run(now.toISOString(), cutoff);
  return info.changes;
}

export function onSiteNow(db: Database.Database, config: AppConfig, now: Date): OnSiteView {
  expireStaleCheckins(db, config, now);
  const rows = many<{
    id: string;
    member_id: string;
    display_name: string | null;
    label: string;
    membership_type: string;
    area: string | null;
    credential_type: string;
    arrived_at: string;
    guest_count: number;
    photo_path: string | null;
    external_booking_id: string | null;
  }>(
    db,
    `SELECT c.id, c.member_id, m.display_name, m.label, m.membership_type, c.area, c.credential_type,
            c.arrived_at, c.guest_count, m.photo_path, c.external_booking_id
     FROM checkins c
     JOIN members m ON m.id = c.member_id
     WHERE c.checked_out_at IS NULL
     ORDER BY c.arrived_at ASC`,
  );
  const members = rows.map((row) => ({
    checkinId: row.id,
    memberId: row.member_id,
    displayName: row.display_name?.trim() || row.label,
    membershipType: row.membership_type,
    area: row.area,
    credentialType: row.credential_type,
    arrivedAt: row.arrived_at,
    guestCount: row.guest_count,
    hasPhoto: Boolean(row.photo_path),
    externalBookingId: row.external_booking_id,
  }));
  const guestCount = members.reduce((sum, member) => sum + member.guestCount, 0);
  return { members, guestCount, headcount: members.length + guestCount };
}

export function saveMemberPhoto(
  db: Database.Database,
  config: AppConfig,
  memberId: string,
  bytes: Buffer,
  contentType: string,
): void {
  const member = one<{ id: string }>(db, "SELECT id FROM members WHERE id = ?", memberId);
  if (!member) throw new AppError(404, "Membership was not found");
  if (bytes.length > 200 * 1024) throw new AppError(400, "Photo must be 200 KB or smaller");
  const ext = extensionFor(bytes, contentType);
  mkdirSync(config.photoDir, { recursive: true });
  const filename = `${memberId}.${ext}`;
  const full = path.resolve(config.photoDir, filename);
  if (!full.startsWith(path.resolve(config.photoDir) + path.sep)) throw new AppError(400, "Photo path is invalid");
  writeFileSync(full, bytes);
  db.prepare("UPDATE members SET photo_path = ? WHERE id = ?").run(filename, memberId);
}

export function readPhotoFile(
  db: Database.Database,
  config: AppConfig,
  memberId: string,
): { bytes: Buffer; contentType: string } | null {
  const row = one<{ photo_path: string | null }>(db, "SELECT photo_path FROM members WHERE id = ?", memberId);
  if (!row?.photo_path) return null;
  const full = path.resolve(config.photoDir, row.photo_path);
  const root = path.resolve(config.photoDir) + path.sep;
  if (!full.startsWith(root)) return null;
  const ext = path.extname(full).slice(1);
  const contentType = PHOTO_TYPES[ext];
  if (!contentType) return null;
  try {
    return { bytes: readFileSync(full), contentType };
  } catch {
    return null;
  }
}

export function memberIdForCheckin(db: Database.Database, checkinId: string, token: string): string {
  return loadOwned(db, checkinId, token).member_id;
}

export function updateMemberProfile(
  db: Database.Database,
  config: AppConfig,
  memberId: string,
  patch: {
    displayName?: string | null;
    phone?: string | null;
    email?: string | null;
    membershipType?: string;
    guestLimit?: number | null;
    playtomicPlayerId?: string | null;
  },
): void {
  const existing = one<{ id: string }>(db, "SELECT id FROM members WHERE id = ?", memberId);
  if (!existing) throw new AppError(404, "Membership was not found");
  if (patch.membershipType !== undefined && !config.membershipTypes.includes(patch.membershipType)) {
    throw new AppError(400, "Unknown membership type");
  }
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    values.push(patch.displayName);
  }
  if (patch.phone !== undefined) {
    sets.push("phone = ?");
    values.push(patch.phone);
  }
  if (patch.email !== undefined) {
    sets.push("email = ?");
    values.push(patch.email);
  }
  if (patch.membershipType !== undefined) {
    sets.push("membership_type = ?");
    values.push(patch.membershipType);
  }
  if (patch.guestLimit !== undefined) {
    sets.push("guest_limit = ?");
    values.push(patch.guestLimit);
  }
  if (sets.length > 0) {
    values.push(memberId);
    db.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }
  if (patch.playtomicPlayerId === null) {
    db.prepare("DELETE FROM member_playtomic WHERE member_id = ?").run(memberId);
  } else if (patch.playtomicPlayerId) {
    try {
      db.prepare(
        `INSERT INTO member_playtomic (member_id, player_id) VALUES (?, ?)
         ON CONFLICT (member_id) DO UPDATE SET player_id = excluded.player_id`,
      ).run(memberId, patch.playtomicPlayerId);
    } catch (error) {
      if (isUniqueError(error)) throw new AppError(409, "That Playtomic player is already linked");
      throw error;
    }
  }
}

export function createHousehold(
  db: Database.Database,
  label: string,
  primaryMemberId: string,
  now: Date,
): { id: string } {
  const member = one<{ id: string }>(db, "SELECT id FROM members WHERE id = ? AND status = 'active'", primaryMemberId);
  if (!member) throw new AppError(404, "Membership was not found");
  const id = newId("hh");
  db.prepare("INSERT INTO households (id, label, primary_member_id, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    label,
    primaryMemberId,
    now.toISOString(),
  );
  db.prepare("UPDATE members SET household_id = ?, household_role = 'primary' WHERE id = ?").run(id, primaryMemberId);
  return { id };
}

export function addHouseholdMember(
  db: Database.Database,
  householdId: string,
  memberId: string,
  role: "primary" | "dependent",
): void {
  const household = one<{ id: string }>(db, "SELECT id FROM households WHERE id = ?", householdId);
  if (!household) throw new AppError(404, "Household was not found");
  const member = one<{ id: string }>(db, "SELECT id FROM members WHERE id = ?", memberId);
  if (!member) throw new AppError(404, "Membership was not found");
  db.prepare("UPDATE members SET household_id = ?, household_role = ? WHERE id = ?").run(householdId, role, memberId);
  if (role === "primary") {
    db.prepare("UPDATE households SET primary_member_id = ? WHERE id = ?").run(memberId, householdId);
  }
}

export function marketingCsv(db: Database.Database): string {
  const rows = many<{
    contact_kind: string;
    contact_value: string;
    consented_at: string;
    consent_text_version: string;
    source: string;
  }>(
    db,
    `SELECT contact_kind, contact_value, consented_at, consent_text_version, source
     FROM marketing_consents
     WHERE unsubscribed_at IS NULL
     ORDER BY consented_at ASC`,
  );
  const lines = ["contact_kind,contact_value,consented_at,consent_text_version,source"];
  for (const row of rows) {
    lines.push(
      [row.contact_kind, row.contact_value, row.consented_at, row.consent_text_version, row.source]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function unsubscribeContact(db: Database.Database, token: string, now: Date): void {
  const info = db
    .prepare("UPDATE marketing_consents SET unsubscribed_at = ? WHERE privacy_token = ? AND unsubscribed_at IS NULL")
    .run(now.toISOString(), token);
  if (info.changes !== 1) throw new AppError(404, "That privacy link was not found");
}

export function unsubscribeByContact(
  db: Database.Database,
  contactKind: string,
  contactValue: string,
  now: Date,
): void {
  db.prepare(
    `UPDATE marketing_consents SET unsubscribed_at = ?
     WHERE contact_kind = ? AND lower(contact_value) = ? AND unsubscribed_at IS NULL`,
  ).run(now.toISOString(), contactKind, contactValue.trim().toLowerCase());
}

export function deleteByPrivacyToken(db: Database.Database, token: string, now: Date): void {
  const consent = one<{ id: string }>(db, "SELECT id FROM marketing_consents WHERE privacy_token = ?", token);
  const guest = one<{ id: string }>(db, "SELECT id FROM guests WHERE privacy_token = ?", token);
  if (!consent && !guest) throw new AppError(404, "That privacy link was not found");
  if (consent) {
    db.prepare(
      `UPDATE marketing_consents
       SET contact_value = '', unsubscribed_at = COALESCE(unsubscribed_at, ?)
       WHERE privacy_token = ?`,
    ).run(now.toISOString(), token);
  }
  if (guest) {
    db.prepare(
      `UPDATE guests
       SET display_name = NULL, contact_kind = NULL, contact_value = NULL, deleted_at = COALESCE(deleted_at, ?)
       WHERE privacy_token = ?`,
    ).run(now.toISOString(), token);
  }
}

export type StaffBooking = {
  id: string;
  courtName: string | null;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  players: Array<{ displayName: string | null; email: string | null; participantType: string }>;
};

export function staffBookingsToday(db: Database.Database, config: AppConfig, now: Date): StaffBooking[] {
  const bounds = localDayBounds(now, config.clubTimeZone);
  const rows = many<{
    id: string;
    court_name: string | null;
    resource_name: string;
    starts_at: string;
    ends_at: string;
  }>(
    db,
    `SELECT e.id, c.name AS court_name, e.resource_name, e.starts_at, e.ends_at
     FROM external_bookings e
     LEFT JOIN courts c ON c.id = e.court_id
     WHERE e.source = 'playtomic' AND e.status = 'active'
       AND e.starts_at < ? AND e.ends_at > ?
     ORDER BY e.starts_at ASC
     LIMIT 200`,
    bounds.end.toISOString(),
    bounds.start.toISOString(),
  );
  return rows.map((row) => ({
    id: row.id,
    courtName: row.court_name,
    resourceName: row.resource_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    players: many<{ display_name: string | null; email: string | null; participant_type: string }>(
      db,
      "SELECT display_name, email, participant_type FROM external_players WHERE booking_id = ?",
      row.id,
    ).map((player) => ({
      displayName: player.display_name,
      email: player.email,
      participantType: player.participant_type,
    })),
  }));
}

function attachPlaytomicBooking(
  db: Database.Database,
  config: AppConfig,
  checkinId: string,
  memberId: string,
  now: Date,
): void {
  const existing = one<{ external_booking_id: string | null }>(
    db,
    "SELECT external_booking_id FROM checkins WHERE id = ?",
    checkinId,
  );
  if (existing?.external_booking_id) return;
  const member = one<{ email: string | null }>(db, "SELECT email FROM members WHERE id = ?", memberId);
  const match = findTodayBooking(db, config, now, memberId, member?.email ?? null);
  if (!match) return;
  db.prepare("UPDATE checkins SET external_booking_id = ? WHERE id = ?").run(match, checkinId);
}

function matchGuestBooking(
  db: Database.Database,
  config: AppConfig,
  kind: "email" | "phone",
  value: string,
  now: Date,
): string | null {
  if (kind !== "email") return null;
  return findTodayBooking(db, config, now, null, value);
}

function findTodayBooking(
  db: Database.Database,
  config: AppConfig,
  now: Date,
  memberId: string | null,
  email: string | null,
): string | null {
  const bounds = localDayBounds(now, config.clubTimeZone);
  const normalized = email?.trim().toLowerCase() ?? "";
  const row = one<{ id: string }>(
    db,
    `SELECT e.id
     FROM external_bookings e
     JOIN external_players p ON p.booking_id = e.id
     LEFT JOIN member_playtomic mp ON mp.player_id = p.player_id
     WHERE e.source = 'playtomic' AND e.status = 'active'
       AND e.starts_at < ? AND e.ends_at > ?
       AND (
         (? IS NOT NULL AND mp.member_id = ?)
         OR (? != '' AND p.email IS NOT NULL AND lower(p.email) = ?)
       )
     ORDER BY CASE WHEN e.starts_at <= ? AND e.ends_at > ? THEN 0 ELSE 1 END, e.starts_at ASC
     LIMIT 1`,
    bounds.end.toISOString(),
    bounds.start.toISOString(),
    memberId,
    memberId,
    normalized,
    normalized,
    now.toISOString(),
    now.toISOString(),
  );
  return row?.id ?? null;
}

function loadOwned(
  db: Database.Database,
  checkinId: string,
  token: string,
): { member_id: string; guest_count: number; guest_limit: number | null; external_booking_id: string | null } {
  const row = one<{
    token: string;
    member_id: string;
    guest_count: number;
    guest_limit: number | null;
    external_booking_id: string | null;
    checked_out_at: string | null;
  }>(
    db,
    `SELECT c.token, c.member_id, c.guest_count, m.guest_limit, c.external_booking_id, c.checked_out_at
     FROM checkins c JOIN members m ON m.id = c.member_id WHERE c.id = ?`,
    checkinId,
  );
  if (!row || row.checked_out_at || !safeToken(row.token, token)) throw new AppError(404, "Check-in was not found");
  return row;
}

function namedGuestCount(db: Database.Database, checkinId: string): number {
  const row = one<{ n: number }>(
    db,
    "SELECT count(*) AS n FROM guests WHERE checkin_id = ? AND deleted_at IS NULL",
    checkinId,
  );
  return row?.n ?? 0;
}

function safeToken(stored: string, presented: string): boolean {
  if (!presented || presented.length !== stored.length) return false;
  let diff = 0;
  for (let index = 0; index < stored.length; index += 1) {
    diff |= stored.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return diff === 0;
}

function extensionFor(bytes: Buffer, contentType: string): "jpg" | "png" | "webp" {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp =
    bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (jpeg && contentType === "image/jpeg") return "jpg";
  if (png && contentType === "image/png") return "png";
  if (webp && contentType === "image/webp") return "webp";
  throw new AppError(400, "Photo must be a JPEG, PNG, or WebP file");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
