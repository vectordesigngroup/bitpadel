import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SqlValue = string | number | bigint | Buffer | null;

const SCHEMA_VERSION = "1";

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

function migrate(db: Database.Database): void {
  db.exec(SCHEMA);
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(SCHEMA_VERSION);
    return;
  }
  if (row.value !== SCHEMA_VERSION) {
    throw new Error(
      `Database schema version is ${row.value}; this app expects ${SCHEMA_VERSION}. Use a new database file.`,
    );
  }
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
export function purgeOldRows(db: Database.Database, retentionDays: number, now: Date): number {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const audits = db.prepare("DELETE FROM access_audit WHERE at < ?").run(cutoff);
  db.prepare("DELETE FROM challenges WHERE expires_at < ?").run(cutoff);
  return audits.changes;
}
