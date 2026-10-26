// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SqlValue = string | number | bigint | Buffer | null;

const SCHEMA_VERSION = "5";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS courts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'held', 'booked', 'cancelled')),
  created_at TEXT NOT NULL,
  UNIQUE (court_id, starts_at)
) STRICT;

CREATE TABLE IF NOT EXISTS holds (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'released')),
  invoice_id TEXT NOT NULL UNIQUE,
  payment_hash TEXT,
  bolt11 TEXT NOT NULL,
  amount_sats INTEGER,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  paid_at TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS holds_one_pending ON holds (slot_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS holds_status_expires ON holds (status, expires_at);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
  hold_id TEXT NOT NULL UNIQUE REFERENCES holds(id),
  confirmed_at TEXT NOT NULL,
  payment_ref TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  amount_sats INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS linking_keys (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  pubkey TEXT NOT NULL UNIQUE,
  enrolled_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS challenges (
  k1 TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('enroll', 'unlock')),
  member_id TEXT REFERENCES members(id),
  area TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS access_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  area TEXT,
  k1 TEXT,
  pubkey TEXT,
  member_id TEXT,
  result TEXT NOT NULL,
  reason TEXT NOT NULL,
  door_result TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS access_audit_at ON access_audit (at);
CREATE INDEX IF NOT EXISTS access_audit_k1 ON access_audit (k1, at);
`;

export function openDatabase(file: string): Database.Database {
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  primary_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS card_credentials (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  scheme TEXT NOT NULL CHECK (scheme IN ('ntag424-sun', 'desfire', 'uid-insecure')),
  uid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'lost')),
  counter INTEGER NOT NULL DEFAULT -1,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS external_bookings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('playtomic')),
  external_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  court_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled')),
  price_text TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE (source, external_id)
) STRICT;

CREATE TABLE IF NOT EXISTS external_players (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES external_bookings(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  participant_type TEXT NOT NULL,
  accepts_commercial INTEGER NOT NULL CHECK (accepts_commercial IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS court_source_map (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id),
  source TEXT NOT NULL CHECK (source IN ('playtomic')),
  resource_id TEXT NOT NULL,
  UNIQUE (source, resource_id)
) STRICT;

CREATE TABLE IF NOT EXISTS source_conflicts (
  id TEXT PRIMARY KEY,
  conflict_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('unmapped-court', 'overlap')),
  external_id TEXT NOT NULL,
  local_booking_id TEXT,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS playtomic_payments (
  club_payment_id TEXT PRIMARY KEY,
  payment_id TEXT,
  refund_id TEXT,
  status TEXT,
  total_text TEXT,
  payment_date TEXT,
  service_date TEXT,
  product_sku TEXT,
  synced_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS member_playtomic (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  player_id TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  area TEXT,
  credential_type TEXT NOT NULL,
  credential_ref TEXT,
  token TEXT NOT NULL UNIQUE,
  external_booking_id TEXT REFERENCES external_bookings(id) ON DELETE SET NULL,
  arrived_at TEXT NOT NULL,
  guest_count INTEGER NOT NULL DEFAULT 0 CHECK (guest_count >= 0),
  checked_out_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  checkin_id TEXT NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  host_member_id TEXT NOT NULL,
  display_name TEXT,
  contact_kind TEXT,
  contact_value TEXT,
  waiver_version TEXT,
  waiver_accepted_at TEXT,
  privacy_token TEXT NOT NULL UNIQUE,
  external_booking_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS marketing_consents (
  id TEXT PRIMARY KEY,
  privacy_token TEXT NOT NULL UNIQUE,
  contact_kind TEXT NOT NULL,
  contact_value TEXT NOT NULL,
  consent_text_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  unsubscribed_at TEXT,
  source TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS external_bookings_window ON external_bookings (court_id, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS checkins_open ON checkins (member_id, checked_out_at);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'front-desk', 'coach')),
  password_hash TEXT NOT NULL,
  disabled_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS staff_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES staff_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  booking_id TEXT,
  invoice_id TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_refund_id TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  member_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS player_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS player_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS price_rules (
  id TEXT PRIMARY KEY,
  court_id TEXT,
  label TEXT NOT NULL,
  days TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  member_price_minor INTEGER NOT NULL CHECK (member_price_minor > 0),
  guest_price_minor INTEGER NOT NULL CHECK (guest_price_minor > 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS staff_actions (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS staff_actions_at ON staff_actions (at);

CREATE TABLE IF NOT EXISTS reminder_log (
  booking_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (booking_id, channel)
) STRICT;

CREATE TABLE IF NOT EXISTS summary_log (
  club_date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS club_branding (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  club_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  primary_color TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  background_color TEXT NOT NULL,
  text_color TEXT NOT NULL,
  font_key TEXT NOT NULL,
  footer_text TEXT NOT NULL,
  contact_text TEXT NOT NULL,
  links_json TEXT NOT NULL,
  logo_key TEXT,
  logo_type TEXT,
  favicon_key TEXT,
  favicon_type TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS cancelled_bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  hold_id TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  cancelled_at TEXT NOT NULL,
  payment_ref TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  amount_sats INTEGER,
  player_id TEXT,
  reason TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS plan_allowances (
  membership_type TEXT PRIMARY KEY,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  period TEXT NOT NULL CHECK (period IN ('visit', 'day', 'week', 'month')),
  currency TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS member_tabs (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
  frozen INTEGER NOT NULL CHECK (frozen IN (0, 1)),
  currency TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('charge', 'settlement', 'adjustment')),
  source TEXT NOT NULL CHECK (source IN ('staff', 'vending', 'member', 'admin')),
  device_id TEXT,
  request_id TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  currency TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('minor', 'sats')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  amount_sats INTEGER CHECK (amount_sats IS NULL OR amount_sats >= 0),
  allowance_minor INTEGER NOT NULL CHECK (allowance_minor >= 0),
  tab_minor INTEGER NOT NULL,
  period_key TEXT,
  guest_id TEXT,
  guest_label TEXT,
  reason TEXT,
  actor_label TEXT NOT NULL,
  settlement_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ledger_member_at ON ledger_entries (member_id, at);
CREATE INDEX IF NOT EXISTS ledger_period ON ledger_entries (member_id, period_key);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_settlement ON ledger_entries (settlement_id) WHERE settlement_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger is append-only');
END;

CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger is append-only');
END;

CREATE TABLE IF NOT EXISTS tab_settlements (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  invoice_id TEXT NOT NULL UNIQUE,
  payment_hash TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('lightning', 'stripe', 'square')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  amount_sats INTEGER CHECK (amount_sats IS NULL OR amount_sats >= 0),
  bolt11 TEXT NOT NULL,
  checkout_url TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  paid_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS tab_settlements_member ON tab_settlements (member_id, status);

CREATE TABLE IF NOT EXISTS vend_challenges (
  k1 TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  member_id TEXT,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
`;

function migrate(db: Database.Database): void {
  db.exec(SCHEMA);
  ensureColumn(db, "members", "display_name", "ALTER TABLE members ADD COLUMN display_name TEXT");
  ensureColumn(db, "members", "phone", "ALTER TABLE members ADD COLUMN phone TEXT");
  ensureColumn(db, "members", "email", "ALTER TABLE members ADD COLUMN email TEXT");
  ensureColumn(db, "members", "photo_path", "ALTER TABLE members ADD COLUMN photo_path TEXT");
  ensureColumn(
    db,
    "members",
    "membership_type",
    "ALTER TABLE members ADD COLUMN membership_type TEXT NOT NULL DEFAULT 'standard'",
  );
  ensureColumn(db, "members", "household_id", "ALTER TABLE members ADD COLUMN household_id TEXT");
  ensureColumn(db, "members", "household_role", "ALTER TABLE members ADD COLUMN household_role TEXT");
  ensureColumn(db, "members", "guest_limit", "ALTER TABLE members ADD COLUMN guest_limit INTEGER");
  ensureColumn(
    db,
    "access_audit",
    "credential_type",
    "ALTER TABLE access_audit ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'lnurl'",
  );
  ensureColumn(db, "access_audit", "credential_ref", "ALTER TABLE access_audit ADD COLUMN credential_ref TEXT");
  ensureColumn(db, "challenges", "checkin_id", "ALTER TABLE challenges ADD COLUMN checkin_id TEXT");
  ensureColumn(db, "holds", "receipt_email", "ALTER TABLE holds ADD COLUMN receipt_email TEXT");
  ensureColumn(
    db,
    "holds",
    "payment_method",
    "ALTER TABLE holds ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'lightning'",
  );
  ensureColumn(db, "holds", "checkout_url", "ALTER TABLE holds ADD COLUMN checkout_url TEXT");
  ensureColumn(db, "holds", "player_id", "ALTER TABLE holds ADD COLUMN player_id TEXT");
  ensureColumn(
    db,
    "holds",
    "reminder_email",
    "ALTER TABLE holds ADD COLUMN reminder_email INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "holds",
    "reminder_sms",
    "ALTER TABLE holds ADD COLUMN reminder_sms INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(db, "holds", "reminder_phone", "ALTER TABLE holds ADD COLUMN reminder_phone TEXT");
  ensureColumn(
    db,
    "bookings",
    "payment_method",
    "ALTER TABLE bookings ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'lightning'",
  );
  ensureColumn(db, "bookings", "player_id", "ALTER TABLE bookings ADD COLUMN player_id TEXT");
  ensureColumn(db, "bookings", "member_id", "ALTER TABLE bookings ADD COLUMN member_id TEXT");
  ensureColumn(
    db,
    "members",
    "access_scope",
    "ALTER TABLE members ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'member'",
  );
  db.exec(EXTRA_SCHEMA);
  ensureColumn(
    db,
    "club_branding",
    "default_locale",
    "ALTER TABLE club_branding ADD COLUMN default_locale TEXT NOT NULL DEFAULT 'en'",
  );
  ensureColumn(db, "players", "preferred_locale", "ALTER TABLE players ADD COLUMN preferred_locale TEXT");
  ensureColumn(db, "members", "preferred_locale", "ALTER TABLE members ADD COLUMN preferred_locale TEXT");
  ensureColumn(db, "holds", "locale", "ALTER TABLE holds ADD COLUMN locale TEXT");
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(SCHEMA_VERSION);
    return;
  }
  if (row.value === "1" || row.value === "2" || row.value === "3" || row.value === "4" || row.value === SCHEMA_VERSION) {
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'version'").run(SCHEMA_VERSION);
    return;
  }
  throw new Error(
    `Database schema version is ${row.value}; this app expects ${SCHEMA_VERSION}. Use a new database file.`,
  );
}

function ensureColumn(db: Database.Database, table: string, column: string, sql: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(sql);
}

export function immediate<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn).immediate();
}

export function one<T>(db: Database.Database, sql: string, ...params: SqlValue[]): T | undefined {
  const row = db.prepare(sql).get(...params);
  if (row === undefined) return undefined;
  return row as T;
}

export function many<T>(db: Database.Database, sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

/**
 * Drop old access rows. Retention is an operator setting, counted in whole days.
 * Ledger rows are not deleted here. Allowance and tab lines stay until a club,
 * with its own CPA, decides a retention rule outside this process.
 */
export function purgeOldRows(
  db: Database.Database,
  retentionDays: number,
  now: Date,
  visitRetentionDays = retentionDays,
): number {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const audits = db.prepare("DELETE FROM access_audit WHERE at < ?").run(cutoff);
  db.prepare("DELETE FROM challenges WHERE expires_at < ?").run(cutoff);
  const visitCutoff = new Date(now.getTime() - visitRetentionDays * 86_400_000).toISOString();
  db.prepare("DELETE FROM checkins WHERE arrived_at < ?").run(visitCutoff);
  db.prepare("DELETE FROM external_bookings WHERE ends_at < ?").run(visitCutoff);
  db.prepare("DELETE FROM source_conflicts WHERE created_at < ? AND resolved_at IS NOT NULL").run(visitCutoff);
  return audits.changes;
}
