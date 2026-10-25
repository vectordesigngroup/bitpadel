// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { crc32 } from "node:zlib";
import { xor } from "./bytes.js";

const RB = 0x87;

export function aesEcbEncrypt(key: Buffer, block: Buffer): Buffer {
  if (key.length !== 16 || block.length !== 16) throw new Error("AES block must be 16 bytes");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

export function aesCbcEncrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer {
  if (data.length % 16 !== 0) throw new Error("AES-CBC input must be padded");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

export function aesCbcDecrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer {
  if (data.length % 16 !== 0) throw new Error("AES-CBC ciphertext must be a whole number of blocks");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function gf128Dbl(block: Buffer): Buffer {
  const out = Buffer.alloc(16);
  let carry = 0;
  for (let index = 15; index >= 0; index -= 1) {
    const value = block[index] ?? 0;
    out[index] = ((value << 1) & 0xff) | carry;
    carry = (value & 0x80) === 0 ? 0 : 1;
  }
  if (((block[0] ?? 0) & 0x80) !== 0) {
    out[15] = (out[15] ?? 0) ^ RB;
  }
  return out;
}

/** AES-CMAC as in NIST SP 800-38B / RFC 4493. */
export function aesCmac(key: Buffer, message: Buffer): Buffer {
  const sub = gf128Dbl(aesEcbEncrypt(key, Buffer.alloc(16)));
  const k1 = sub;
  const k2 = gf128Dbl(sub);
  const complete = message.length > 0 && message.length % 16 === 0;
  const blocks = complete ? message.length / 16 : Math.floor(message.length / 16) + 1;
  const last = Buffer.alloc(16);
  if (complete) {
    message.subarray((blocks - 1) * 16).copy(last);
    xorInto(last, k1);
  } else {
    const start = (blocks - 1) * 16;
    const partial = message.subarray(start);
    partial.copy(last);
    last[partial.length] = 0x80;
    xorInto(last, k2);
  }
  let state = Buffer.alloc(16);
  for (let index = 0; index < blocks - 1; index += 1) {
    const block = message.subarray(index * 16, index * 16 + 16);
    state = Buffer.from(aesEcbEncrypt(key, xor(state, block)));
  }
  return aesEcbEncrypt(key, xor(state, last));
}

function xorInto(target: Buffer, mask: Buffer): void {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = (target[index] ?? 0) ^ (mask[index] ?? 0);
  }
}

/** NXP keeps the odd-numbered CMAC bytes (1, 3, ... 15). */
export function truncateMac(mac: Buffer): Buffer {
  if (mac.length !== 16) throw new Error("CMAC must be 16 bytes");
  const out = Buffer.alloc(8);
  for (let index = 0; index < 8; index += 1) {
    out[index] = mac[index * 2 + 1] ?? 0;
  }
  return out;
}

export function pad80(data: Buffer): Buffer {
  const padded = Buffer.alloc(Math.ceil((data.length + 1) / 16) * 16);
  data.copy(padded);
  padded[data.length] = 0x80;
  return padded;
}

/**
 * CRC32 of a new NTAG 424 key, as AN12196 prints it.
 * IEEE 802.3 without the final complement, stored little-endian.
 */
export function ntagCrc32(data: Buffer): Buffer {
  const value = (crc32(data) ^ 0xffffffff) >>> 0;
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

export function equalBytes(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
