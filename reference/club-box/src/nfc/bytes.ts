// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

export function fromHex(hex: string): Buffer {
  const text = hex.trim().toLowerCase();
  if (text.length % 2 !== 0 || !/^[0-9a-f]*$/.test(text)) {
    throw new Error("expected hex");
  }
  return Buffer.from(text, "hex");
}

export function toHex(bytes: Buffer): string {
  return bytes.toString("hex");
}

export function xor(left: Buffer, right: Buffer): Buffer {
  if (left.length !== right.length) throw new Error("xor length mismatch");
  const out = Buffer.alloc(left.length);
  for (let index = 0; index < left.length; index += 1) {
    out[index] = (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return out;
}

export function rotateLeft(block: Buffer): Buffer {
  if (block.length === 0) return Buffer.alloc(0);
  const first = block[0] ?? 0;
  return Buffer.from(Buffer.concat([block.subarray(1), Buffer.from([first])]));
}

export function rotateRight(block: Buffer): Buffer {
  if (block.length === 0) return Buffer.alloc(0);
  const last = block[block.length - 1] ?? 0;
  return Buffer.from(Buffer.concat([Buffer.from([last]), block.subarray(0, block.length - 1)]));
}
