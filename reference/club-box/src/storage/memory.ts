// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { assertStorageKey, type ObjectStorage, type StoredObject } from "./types.js";

export class MemoryObjectStorage implements ObjectStorage {
  readonly id = "memory";
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    assertStorageKey(key);
    this.objects.set(key, Buffer.from(bytes));
  }

  async get(key: string): Promise<StoredObject | null> {
    assertStorageKey(key);
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return { bytes: Buffer.from(bytes) };
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    this.objects.delete(key);
  }
}
