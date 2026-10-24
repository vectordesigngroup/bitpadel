import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { BackupDestination } from "./destination.js";

/** Online backup through better-sqlite3. Safe while the server has the file open. */
export async function backupDatabase(
  db: Database.Database,
  destination: BackupDestination,
  now: Date,
): Promise<string> {
  const name = `club-${now.toISOString().replace(/[:.]/g, "-")}.sqlite`;
  const tmp = path.join(tmpdir(), `club-backup-${randomBytes(8).toString("hex")}.sqlite`);
  try {
    await db.backup(tmp);
    const stored = await destination.put(name, tmp);
    return stored.location;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Replace the SQLite file. Stop the server first. This removes any leftover
 * WAL and shared-memory files so SQLite does not replay them over the copy.
 */
export function restoreDatabase(fromPath: string, databasePath: string, force: boolean): void {
  if (!existsSync(fromPath)) throw new Error("Backup file was not found");
  if (databasePath === ":memory:") throw new Error("Refusing to restore into a memory database");
  if (existsSync(databasePath) && !force) {
    throw new Error(
      "Database already exists. Stop the server, then restore with --force. Restoring while the server is running can corrupt the file.",
    );
  }
  mkdirSync(path.dirname(databasePath), { recursive: true });
  copyFileSync(fromPath, databasePath);
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
}
