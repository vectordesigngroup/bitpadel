import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SqlValue = string | number | bigint | Buffer | null;

const SCHEMA_VERSION = "3";

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
  db.exec(EXTRA_SCHEMA);
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(SCHEMA_VERSION);
    return;
  }
  if (row.value === "1" || row.value === "2" || row.value === SCHEMA_VERSION) {
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

/** Drop old access rows. Retention is an operator setting, counted in whole days. */
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
