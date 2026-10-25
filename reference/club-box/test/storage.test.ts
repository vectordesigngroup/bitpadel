// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { saveMemberPhoto } from "../src/checkin/service.js";
import { newId } from "../src/ids.js";
import { LocalObjectStorage } from "../src/storage/local.js";
import { MemoryObjectStorage } from "../src/storage/memory.js";
import { ADMIN_TOKEN } from "./helpers.js";

test("memory and local storage round-trip photos and enforce the size limit", async () => {
  const memory = new MemoryObjectStorage();
  const png = Buffer.from("89504e470d0a1a0a0000", "hex");
  await memory.put("mem_photo.png", png, "image/png");
  const loaded = await memory.get("mem_photo.png");
  assert.equal(loaded?.bytes.toString("hex"), png.toString("hex"));
  await memory.delete("mem_photo.png");
  assert.equal(await memory.get("mem_photo.png"), null);

  const dir = mkdtempSync(path.join(tmpdir(), "club-photos-"));
  const db = openDatabase(":memory:");
  try {
    const config = loadConfig({
      ADMIN_TOKEN,
      CURRENCY: "XXX",
      CURRENCY_DECIMALS: "2",
      ACCESS_AREAS: "lounge",
      PHOTO_DIR: dir,
      PHOTO_MAX_BYTES: "1024",
    });
    const memberId = newId("mem");
    db.prepare("INSERT INTO members (id, label, status, created_at) VALUES (?, 'M', 'active', ?)").run(
      memberId,
      new Date().toISOString(),
    );
    const storage = new LocalObjectStorage(dir);
    await assert.rejects(
      saveMemberPhoto(db, config, storage, memberId, Buffer.alloc(1025, 1), "image/png"),
      /bytes or smaller/,
    );
    await saveMemberPhoto(db, config, storage, memberId, png, "image/png");
    const again = await storage.get(`${memberId}.png`);
    assert.equal(again?.bytes.length, png.length);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
