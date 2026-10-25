// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { aesCbcDecrypt, aesCbcEncrypt, aesCmac, equalBytes, truncateMac } from "./aes.js";
import { fromHex, toHex } from "./bytes.js";

const SV2_PREFIX = Buffer.from("3cc300010080", "hex");

export type SunPlain = {
  uid: Buffer;
  /** SDM read counter as an integer. The on-card bytes are little-endian. */
  counter: number;
};

/**
 * Decrypt encrypted PICCData and check the SUN CMAC.
 * PICCData uses the SDM meta read key (not UID-diversified: the UID is inside the ciphertext).
 * The CMAC uses the SDM file read key, which may be diversified once the UID is known.
 * AN12196 sections 3.4.2 and 3.4.4.
 */
export function verifySunMessage(input: {
  piccDataHex: string;
  cmacHex: string;
  metaReadKey: Buffer;
  fileReadKey: Buffer;
}): SunPlain | null {
  let picc: Buffer;
  let presented: Buffer;
  try {
    picc = fromHex(input.piccDataHex);
    presented = fromHex(input.cmacHex);
  } catch {
    return null;
  }
  if (picc.length !== 16 || presented.length !== 8) return null;
  if (input.metaReadKey.length !== 16 || input.fileReadKey.length !== 16) return null;
  const opened = decryptSunPicc(input.metaReadKey, input.piccDataHex);
  if (!opened) return null;
  const counterBytes = counterToLe(opened.counter);
  const expected = sunCmac(input.fileReadKey, opened.uid, counterBytes);
  if (!equalBytes(expected, presented)) return null;
  return opened;
}

/** Decrypt PICCData without checking the CMAC, so the UID can diversify the file-read key. */
export function decryptSunPicc(metaReadKey: Buffer, piccDataHex: string): SunPlain | null {
  let picc: Buffer;
  try {
    picc = fromHex(piccDataHex);
  } catch {
    return null;
  }
  if (picc.length !== 16 || metaReadKey.length !== 16) return null;
  const plain = aesCbcDecrypt(metaReadKey, Buffer.alloc(16), picc);
  const tag = plain[0] ?? 0;
  if ((tag & 0x80) === 0 || (tag & 0x40) === 0) return null;
  const uidLength = tag & 0x0f;
  if (uidLength !== 7) return null;
  const uid = plain.subarray(1, 8);
  const counterBytes = plain.subarray(8, 11);
  const counter = counterBytes[0]! | (counterBytes[1]! << 8) | (counterBytes[2]! << 16);
  return { uid: Buffer.from(uid), counter };
}

export function sunCmac(fileReadKey: Buffer, uid: Buffer, counterLe: Buffer): Buffer {
  const sv2 = Buffer.alloc(16);
  SV2_PREFIX.copy(sv2);
  uid.copy(sv2, 6);
  counterLe.copy(sv2, 13);
  const session = aesCmac(fileReadKey, sv2);
  return truncateMac(aesCmac(session, Buffer.alloc(0)));
}

/** Build the encrypted PICC field the way the tag does, for tests and the card simulator. */
export function encryptPiccData(metaReadKey: Buffer, uid: Buffer, counter: number, padding: Buffer): Buffer {
  if (uid.length !== 7 || padding.length !== 5) throw new Error("PICC plaintext must be tag, UID, counter, and 5 padding bytes");
  if (counter < 0 || counter > 0xffffff) throw new Error("counter does not fit in 3 bytes");
  const plain = Buffer.alloc(16);
  plain[0] = 0xc7;
  uid.copy(plain, 1);
  plain[8] = counter & 0xff;
  plain[9] = (counter >> 8) & 0xff;
  plain[10] = (counter >> 16) & 0xff;
  padding.copy(plain, 11);
  return aesCbcEncrypt(metaReadKey, Buffer.alloc(16), plain);
}

export function counterToLe(counter: number): Buffer {
  const out = Buffer.alloc(3);
  out[0] = counter & 0xff;
  out[1] = (counter >> 8) & 0xff;
  out[2] = (counter >> 16) & 0xff;
  return out;
}

export function piccHex(metaReadKey: Buffer, uid: Buffer, counter: number, padding: Buffer): string {
  return toHex(encryptPiccData(metaReadKey, uid, counter, padding));
}
