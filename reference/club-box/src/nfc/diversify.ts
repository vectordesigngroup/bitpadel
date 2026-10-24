import { aesCmac, aesEcbEncrypt, gf128Dbl } from "./aes.js";
import { xor } from "./bytes.js";

const NDEF_AID = Buffer.from("d2760000850101", "hex");
/** Example application id for a DESFire access app. Not a certified product id. */
export const DESFIRE_AID = Buffer.from("f54201", "hex");

/**
 * AN10922 section 2.2. AES-128 diversification.
 * D is always 32 bytes when M is 15 bytes or shorter. Longer inputs use CMAC(K, 0x01 || M).
 */
export function diversifyAes128(master: Buffer, diversificationInput: Buffer): Buffer {
  if (master.length !== 16) throw new Error("master key must be 16 bytes");
  if (diversificationInput.length < 1 || diversificationInput.length > 31) {
    throw new Error("diversification input must be 1 to 31 bytes");
  }
  const prefixed = Buffer.concat([Buffer.from([0x01]), diversificationInput]);
  if (diversificationInput.length > 15) return aesCmac(master, prefixed);
  const block = Buffer.alloc(32);
  prefixed.copy(block);
  block[prefixed.length] = 0x80;
  const k2 = gf128Dbl(gf128Dbl(aesEcbEncrypt(master, Buffer.alloc(16))));
  const first = aesEcbEncrypt(master, block.subarray(0, 16));
  return aesEcbEncrypt(master, xor(first, xor(block.subarray(16), k2)));
}

/** Per-card key: UID || NDEF AID || key number || system id. */
export function diversifyNtagKey(master: Buffer, uid: Buffer, keyNumber: number, systemId: string): Buffer {
  if (uid.length !== 7) throw new Error("UID must be 7 bytes");
  if (keyNumber < 0 || keyNumber > 4) throw new Error("key number must be 0 to 4");
  const system = Buffer.from(systemId, "utf8");
  if (system.length < 1 || system.length > 16) throw new Error("system id must be 1 to 16 bytes");
  return diversifyAes128(master, Buffer.concat([uid, NDEF_AID, Buffer.from([keyNumber]), system]));
}

/** Per-card DESFire application key: UID || example AID || key number || system id. */
export function diversifyDesfireKey(master: Buffer, uid: Buffer, keyNumber: number, systemId: string): Buffer {
  if (uid.length !== 7) throw new Error("UID must be 7 bytes");
  const system = Buffer.from(systemId, "utf8");
  if (system.length < 1 || system.length > 20) throw new Error("system id must be 1 to 20 bytes");
  const input = Buffer.concat([uid, DESFIRE_AID, Buffer.from([keyNumber]), system]);
  if (input.length > 31) throw new Error("DESFire diversification input is too long");
  return diversifyAes128(master, input);
}
