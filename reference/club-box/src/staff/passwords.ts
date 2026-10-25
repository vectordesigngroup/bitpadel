// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const n = 16384;
  const hash = scryptSync(password, salt, 32, { N: n, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${n}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const saltHex = parts[2];
  const hashHex = parts[3];
  if (!saltHex || !hashHex || !Number.isInteger(n) || n < 2) return false;
  const expected = Buffer.from(hashHex, "hex");
  const salt = Buffer.from(saltHex, "hex");
  const actual = scryptSync(password, salt, expected.length, { N: n, r: SCRYPT_R, p: SCRYPT_P });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
