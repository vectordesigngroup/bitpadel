// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { etc, Signature, verify } from "@noble/secp256k1";

/**
 * LNURL-auth (LUD-04) check.
 * Wallets sign the 32-byte `k1` itself. That value is the ECDSA message hash;
 * it is not hashed again. Signatures may be compact (64 bytes), recoverable
 * (65 bytes), or DER. High-S signatures are normalized before verification.
 */
export function verifyLnurlAuthSignature(k1Hex: string, sigHex: string, pubkeyHex: string): boolean {
  try {
    if (sigHex.length > 160) return false;
    const k1 = etc.hexToBytes(k1Hex.toLowerCase());
    const pubkey = etc.hexToBytes(pubkeyHex.toLowerCase());
    const sigRaw = etc.hexToBytes(sigHex.toLowerCase());
    if (k1.length !== 32 || pubkey.length !== 33) return false;
    if (pubkey[0] !== 0x02 && pubkey[0] !== 0x03) return false;
    const compact = toCompactSignature(sigRaw);
    if (!compact) return false;
    const signature = Signature.fromCompact(compact).normalizeS();
    return verify(signature, k1, pubkey);
  } catch {
    return false;
  }
}

function toCompactSignature(sigRaw: Uint8Array): Uint8Array | null {
  if (sigRaw.length === 64) return sigRaw;
  if (sigRaw.length === 65) {
    const first = sigRaw[0];
    const last = sigRaw[64];
    if (last !== undefined && isRecoveryByte(last)) return sigRaw.subarray(0, 64);
    if (first !== undefined && isRecoveryByte(first)) return sigRaw.subarray(1);
    return null;
  }
  if (sigRaw[0] === 0x30) return derToCompact(sigRaw);
  return null;
}

function isRecoveryByte(value: number): boolean {
  return value <= 3 || (value >= 27 && value <= 34);
}

function derToCompact(der: Uint8Array): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30) return null;
  const sequence = readLength(der, 1);
  if (!sequence) return null;
  const r = readInteger(der, sequence.next);
  if (!r) return null;
  const s = readInteger(der, r.next);
  if (!s || s.next !== der.length) return null;
  const rBytes = unpadInteger(r.value);
  const sBytes = unpadInteger(s.value);
  if (!rBytes || !sBytes) return null;
  const out = new Uint8Array(64);
  out.set(rBytes, 32 - rBytes.length);
  out.set(sBytes, 64 - sBytes.length);
  return out;
}

function readLength(bytes: Uint8Array, offset: number): { length: number; next: number } | null {
  const first = bytes[offset];
  if (first === undefined) return null;
  if (first < 0x80) return { length: first, next: offset + 1 };
  if (first === 0x81) {
    const length = bytes[offset + 1];
    if (length === undefined) return null;
    return { length, next: offset + 2 };
  }
  return null;
}

function readInteger(
  bytes: Uint8Array,
  offset: number,
): { value: Uint8Array; next: number } | null {
  if (bytes[offset] !== 0x02) return null;
  const len = readLength(bytes, offset + 1);
  if (!len || len.length < 1) return null;
  const end = len.next + len.length;
  if (end > bytes.length) return null;
  return { value: bytes.subarray(len.next, end), next: end };
}

function unpadInteger(value: Uint8Array): Uint8Array | null {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  const body = value.subarray(start);
  if (body.length < 1 || body.length > 32) return null;
  return body;
}
