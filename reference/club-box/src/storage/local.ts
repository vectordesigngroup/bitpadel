// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertStorageKey, type ObjectStorage, type StoredObject } from "./types.js";

export class LocalObjectStorage implements ObjectStorage {
  readonly id = "local";

  constructor(private readonly root: string) {}

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    mkdirSync(this.root, { recursive: true });
    writeFileSync(full, bytes);
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key);
    try {
      return { bytes: readFileSync(full) };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    rmSync(full, { force: true });
  }

  private resolve(key: string): string {
    assertStorageKey(key);
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error("Storage key is invalid");
    return full;
  }
}
