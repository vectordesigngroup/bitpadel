// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

export type StoredObject = {
  bytes: Buffer;
};

/**
 * Where member photos live. Local disk is the default.
 * A club can add an adapter (S3, a NAS mount) by implementing this interface
 * and selecting it from `createStorage`.
 */
export interface ObjectStorage {
  readonly id: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function assertStorageKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error("Storage key is invalid");
}
