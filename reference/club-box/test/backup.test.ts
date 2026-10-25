// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { destinationFrom, runBackupCli } from "../src/backup/cli.js";
import { S3BackupDestination } from "../src/backup/s3.js";
import { backupDatabase, restoreDatabase } from "../src/backup/service.js";
import { openDatabase } from "../src/db.js";

test("SQLite backup and restore round-trip through a local directory", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "club-backup-"));
  const databasePath = path.join(dir, "club.sqlite");
  const restored = path.join(dir, "restored.sqlite");
  const db = openDatabase(databasePath);
  try {
    db.prepare("INSERT INTO courts (id, name, active, created_at) VALUES ('court-1', 'Court', 1, ?)").run(
      "2026-06-01T00:00:00.000Z",
    );
    const location = await backupDatabase(db, destinationFrom({ BACKUP_DIR: path.join(dir, "backups") }), new Date("2026-06-01T03:00:00.000Z"));
    assert.match(location, /club-2026-06-01T03-00-00-000Z\.sqlite$/);
    assert.throws(() => restoreDatabase(location, databasePath, false), /--force/);
    restoreDatabase(location, restored, true);
  } finally {
    db.close();
  }
  const copy = openDatabase(restored);
  try {
    const row = copy.prepare("SELECT name FROM courts WHERE id = 'court-1'").get() as { name: string };
    assert.equal(row.name, "Court");
  } finally {
    copy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an encrypted backup restores only with the same passphrase", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "club-backup-enc-"));
  const databasePath = path.join(dir, "club.sqlite");
  const restored = path.join(dir, "restored.sqlite");
  const db = openDatabase(databasePath);
  const passphrase = "correct-horse-battery";
  try {
    db.prepare("INSERT INTO courts (id, name, active, created_at) VALUES ('court-enc', 'Sealed', 1, ?)").run(
      "2026-06-01T00:00:00.000Z",
    );
    const location = await backupDatabase(
      db,
      destinationFrom({ BACKUP_DIR: path.join(dir, "backups") }),
      new Date("2026-06-01T03:00:00.000Z"),
      passphrase,
    );
    assert.match(location, /\.sqlite\.enc$/);
    assert.throws(() => restoreDatabase(location, restored, true), /BACKUP_PASSPHRASE/);
    assert.throws(() => restoreDatabase(location, restored, true, "wrong-passphrase"), /decrypt/);
    restoreDatabase(location, restored, true, passphrase);
  } finally {
    db.close();
  }
  const copy = openDatabase(restored);
  try {
    const row = copy.prepare("SELECT name FROM courts WHERE id = 'court-enc'").get() as { name: string };
    assert.equal(row.name, "Sealed");
  } finally {
    copy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the backup CLI and an S3-compatible destination store the file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "club-backup-cli-"));
  const objects = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const key = req.url ?? "";
    assert.match(req.headers.authorization ?? "", /AWS4-HMAC-SHA256/);
    if (req.method === "PUT") objects.set(key, body);
    const stored = objects.get(key);
    if (!stored) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": req.method === "GET" ? stored.length : 0 });
    res.end(req.method === "GET" ? stored : undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    const databasePath = path.join(dir, "club.sqlite");
    const env = {
      DATABASE_PATH: databasePath,
      BACKUP_DESTINATION: "s3",
      S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
      S3_BUCKET: "club-backups",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_PREFIX: "nightly",
    };
    await runBackupCli(["backup"], env);
    assert.equal(objects.size, 1);
    const destination = new S3BackupDestination({
      endpoint: env.S3_ENDPOINT,
      bucket: "club-backups",
      region: "us-east-1",
      accessKey: "key",
      secretKey: "secret",
      prefix: "nightly",
    });
    const name = [...objects.keys()][0]?.split("/").pop() ?? "";
    const downloaded = path.join(dir, "from-s3.sqlite");
    await destination.get(name, downloaded);
    const copy = openDatabase(downloaded);
    copy.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
