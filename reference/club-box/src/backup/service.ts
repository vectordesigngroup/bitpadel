import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { decryptFile, encryptFile, isEncryptedBackup } from "./crypto.js";
import type { BackupDestination } from "./destination.js";

/** Online backup through better-sqlite3. Safe while the server has the file open. */
export async function backupDatabase(
  db: Database.Database,
  destination: BackupDestination,
  now: Date,
  passphrase: string | null = null,
): Promise<string> {
  const encrypted = Boolean(passphrase);
  const name = `club-${now.toISOString().replace(/[:.]/g, "-")}.sqlite${encrypted ? ".enc" : ""}`;
  const tmp = path.join(tmpdir(), `club-backup-${randomBytes(8).toString("hex")}.sqlite`);
  const sealed = `${tmp}.enc`;
  try {
    await db.backup(tmp);
    const payload = passphrase ? sealed : tmp;
    if (passphrase) encryptFile(tmp, sealed, passphrase);
    const stored = await destination.put(name, payload);
    return stored.location;
  } finally {
    rmSync(tmp, { force: true });
    rmSync(sealed, { force: true });
  }
}

/**
 * Replace the SQLite file. Stop the server first. This removes any leftover
 * WAL and shared-memory files so SQLite does not replay them over the copy.
 */
export function restoreDatabase(
  fromPath: string,
  databasePath: string,
  force: boolean,
  passphrase: string | null = null,
): void {
  if (!existsSync(fromPath)) throw new Error("Backup file was not found");
  if (isEncryptedBackup(fromPath)) {
    if (!passphrase) throw new Error("This backup is encrypted. Set BACKUP_PASSPHRASE.");
    const plain = path.join(tmpdir(), `club-restore-${randomBytes(8).toString("hex")}.sqlite`);
    try {
      decryptFile(fromPath, plain, passphrase);
      restorePlain(plain, databasePath, force);
    } finally {
      rmSync(plain, { force: true });
    }
    return;
  }
  if (databasePath === ":memory:") throw new Error("Refusing to restore into a memory database");
  if (existsSync(databasePath) && !force) {
    throw new Error(
      "Database already exists. Stop the server, then restore with --force. Restoring while the server is running can corrupt the file.",
    );
  }
  restorePlain(fromPath, databasePath, force);
}

function restorePlain(fromPath: string, databasePath: string, force: boolean): void {
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
