// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const MAGIC = Buffer.from("CBX1");

/** AES-256-GCM. The passphrase comes from the environment, never from the database. */
export function encryptFile(sourcePath: string, destPath: string, passphrase: string): void {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(readFileSync(sourcePath)), cipher.final()]);
  const tag = cipher.getAuthTag();
  writeFileSync(destPath, Buffer.concat([MAGIC, salt, iv, tag, ciphertext]));
}

export function decryptFile(sourcePath: string, destPath: string, passphrase: string): void {
  const bytes = readFileSync(sourcePath);
  if (bytes.length < 4 + 16 + 12 + 16 || !bytes.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Backup file is not an encrypted club backup");
  }
  const salt = bytes.subarray(4, 20);
  const iv = bytes.subarray(20, 32);
  const tag = bytes.subarray(32, 48);
  const ciphertext = bytes.subarray(48);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    writeFileSync(destPath, Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    throw new Error("Could not decrypt the backup. Check BACKUP_PASSPHRASE.");
  }
}

export function isEncryptedBackup(sourcePath: string): boolean {
  const bytes = readFileSync(sourcePath);
  return bytes.length >= 4 && bytes.subarray(0, 4).equals(MAGIC);
}
