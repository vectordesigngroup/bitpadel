// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { randomBytes } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

/** 32-byte LNURL-auth challenge, hex-encoded. */
export function newK1(): string {
  return randomBytes(32).toString("hex");
}
