// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Env } from "../config.js";
import { openDatabase } from "../db.js";
import { LocalBackupDestination } from "./local.js";
import { S3BackupDestination } from "./s3.js";
import { backupDatabase, restoreDatabase } from "./service.js";
import type { BackupDestination } from "./destination.js";
import type { S3Config } from "../config.js";

/**
 * Operator backup tool. It does not load the full app config, so ADMIN_TOKEN
 * is not required. Schedule it on the host. This process does not run cron.
 *
 *   npm run backup -- backup
 *   npm run backup -- restore --from ./data/backups/club-....sqlite --force
 *   npm run backup -- restore --name club-....sqlite --force
 *
 * Example crontab, with the club's own path:
 *   0 3 * * * cd /opt/club-box && npm run backup -- backup
 *
 * Stop the server before restore.
 */
export async function runBackupCli(argv: string[], env: Env): Promise<void> {
  const command = argv[0] ?? "help";
  switch (command) {
    case "backup":
      await runBackup(env);
      return;
    case "restore":
      await runRestore(argv.slice(1), env);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      throw new Error(`Unknown backup command "${command}". ${HELP}`);
  }
}

async function runBackup(env: Env): Promise<void> {
  const databasePath = env.DATABASE_PATH?.trim() || "./data/club.sqlite";
  const db = openDatabase(databasePath);
  try {
    const location = await backupDatabase(db, destinationFrom(env), new Date(), passphrase(env));
    console.log(location);
  } finally {
    db.close();
  }
}

async function runRestore(args: string[], env: Env): Promise<void> {
  const databasePath = env.DATABASE_PATH?.trim() || "./data/club.sqlite";
  const fromFlag = flag(args, "--from");
  const name = flag(args, "--name");
  const force = args.includes("--force");
  if (!fromFlag && !name) throw new Error("restore needs --from <file> or --name <backup>");
  let source = fromFlag;
  let tempDir: string | null = null;
  if (!source && name) {
    tempDir = mkdtempSync(path.join(tmpdir(), "club-restore-"));
    source = path.join(tempDir, path.basename(name));
    await destinationFrom(env).get(name, source);
  }
  if (!source) throw new Error("restore needs --from <file> or --name <backup>");
  try {
    restoreDatabase(source, databasePath, force, passphrase(env));
    console.log(databasePath);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

export function destinationFrom(env: Env): BackupDestination {
  const kind = env.BACKUP_DESTINATION?.trim() || "local";
  switch (kind) {
    case "local":
      return new LocalBackupDestination(env.BACKUP_DIR?.trim() || "./data/backups");
    case "s3":
      return new S3BackupDestination(s3From(env));
    default:
      throw new Error("BACKUP_DESTINATION must be local or s3");
  }
}

function s3From(env: Env): S3Config {
  const endpoint = required(env, "S3_ENDPOINT");
  const bucket = required(env, "S3_BUCKET");
  const accessKey = required(env, "S3_ACCESS_KEY_ID");
  const secretKey = required(env, "S3_SECRET_ACCESS_KEY");
  const region = env.S3_REGION?.trim() || "us-east-1";
  const prefix = env.S3_PREFIX?.trim() || "";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("S3_ENDPOINT must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("S3_ENDPOINT must use http or https");
  }
  return { endpoint: endpoint.replace(/\/$/, ""), bucket, region, accessKey, secretKey, prefix };
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function flag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

const HELP = `Commands: backup | restore --from <file> | restore --name <backup> [--force]
Set BACKUP_PASSPHRASE to encrypt the file (AES-256-GCM). The same value restores it.
Stop the server before restore. Schedule backup on the host; this app has no cron.
Example: 15 3 * * * cd /opt/club-box && BACKUP_PASSPHRASE=... npm run backup -- backup`;

function passphrase(env: Env): string | null {
  const value = env.BACKUP_PASSPHRASE ?? "";
  if (!value) return null;
  if (value.length < 12) throw new Error("BACKUP_PASSPHRASE must be at least 12 characters");
  return value;
}

const executed = process.argv[1]?.includes(`${path.sep}backup${path.sep}cli`);
if (executed) {
  runBackupCli(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "backup failed");
    process.exit(1);
  });
}
