// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { randomBytes } from "node:crypto";
import { aesCbcDecrypt, aesCbcEncrypt, aesCmac, aesEcbEncrypt, equalBytes, truncateMac } from "./aes.js";
import { rotateLeft, xor } from "./bytes.js";
import { dataOf, decryptRndB, le16, openEv2Session, statusOf } from "./ev2.js";

/**
 * Enough of an NTAG 424 DNA to exercise personalization without a reader.
 * It accepts the same APDUs the programmer sends and refuses anything else.
 */
export class NtagSim {
  readonly keys: Buffer[] = Array.from({ length: 5 }, () => Buffer.alloc(16));
  file = Buffer.alloc(0);
  settings: Buffer | null = null;
  private session: { keyNo: number; encKey: Buffer; macKey: Buffer; ti: Buffer; cmdCtr: number } | null = null;
  private pendingRndB: Buffer | null = null;
  private pendingKeyNo = 0;

  constructor(readonly uid: Buffer) {
    if (uid.length !== 7) throw new Error("UID must be 7 bytes");
  }

  handle(apdu: Buffer): Buffer {
    if (apdu[0] === 0x00 && apdu[1] === 0xa4) return Buffer.from([0x90, 0x00]);
    if (apdu[0] === 0x00 && apdu[1] === 0xd6) return this.writePlain(apdu);
    if (apdu[0] === 0x00 && apdu[1] === 0xb0) return Buffer.concat([this.file, Buffer.from([0x90, 0x00])]);
    if (apdu[0] !== 0x90) return Buffer.from([0x6a, 0x86]);
    const ins = apdu[1] ?? 0;
    const data = apdu.subarray(5, apdu.length - 1);
    if (ins === 0x71) return this.authPart1(data);
    if (ins === 0xaf) return this.authPart2(data);
    if (ins === 0xc4) return this.changeKey(data);
    if (ins === 0x5f) return this.changeSettings(data);
    return Buffer.from([0x91, 0x1c]);
  }

  private authPart1(data: Buffer): Buffer {
    const keyNo = data[0] ?? 0;
    const key = this.keys[keyNo];
    if (!key) return Buffer.from([0x91, 0x9d]);
    this.pendingKeyNo = keyNo;
    this.pendingRndB = randomBytes(16);
    const encrypted = aesCbcEncrypt(key, Buffer.alloc(16), this.pendingRndB);
    return Buffer.concat([encrypted, Buffer.from([0x91, 0xaf])]);
  }

  private authPart2(data: Buffer): Buffer {
    const key = this.keys[this.pendingKeyNo];
    const rndB = this.pendingRndB;
    if (!key || !rndB || data.length !== 32) return Buffer.from([0x91, 0xae]);
    const plain = aesCbcDecrypt(key, Buffer.alloc(16), data);
    const rndA = plain.subarray(0, 16);
    if (!rotateLeft(rndB).equals(plain.subarray(16))) return Buffer.from([0x91, 0xae]);
    const ti = randomBytes(4);
    const response = Buffer.concat([ti, rotateLeft(rndA), Buffer.alloc(12)]);
    const session = openEv2Session(key, rndA, rndB, aesCbcEncrypt(key, Buffer.alloc(16), response));
    this.session = { keyNo: this.pendingKeyNo, encKey: session.encKey, macKey: session.macKey, ti: session.ti, cmdCtr: 0 };
    return Buffer.concat([aesCbcEncrypt(key, Buffer.alloc(16), response), Buffer.from([0x91, 0x00])]);
  }

  private changeKey(data: Buffer): Buffer {
    const session = this.session;
    if (!session || data.length < 1 + 16 + 8) return Buffer.from([0x91, 0xae]);
    const keyNo = data[0] ?? 0;
    const encrypted = data.subarray(1, data.length - 8);
    const mac = data.subarray(data.length - 8);
    if (!this.acceptMac(0xc4, data.subarray(0, 1), encrypted, mac)) return Buffer.from([0x91, 0x1e]);
    const plain = aesCbcDecrypt(session.encKey, this.iv(), encrypted);
    const old = this.keys[keyNo];
    if (!old) return Buffer.from([0x91, 0x9d]);
    const next = session.keyNo === keyNo ? plain.subarray(0, 16) : xor(plain.subarray(0, 16), old);
    this.keys[keyNo] = Buffer.from(next);
    session.cmdCtr += 1;
    return Buffer.from([0x91, 0x00]);
  }

  private changeSettings(data: Buffer): Buffer {
    const session = this.session;
    if (!session || data.length < 1 + 16 + 8) return Buffer.from([0x91, 0xae]);
    const header = data.subarray(0, 1);
    const encrypted = data.subarray(1, data.length - 8);
    const mac = data.subarray(data.length - 8);
    if (!this.acceptMac(0x5f, header, encrypted, mac)) return Buffer.from([0x91, 0x1e]);
    this.settings = aesCbcDecrypt(session.encKey, this.iv(), encrypted);
    session.cmdCtr += 1;
    return Buffer.from([0x91, 0x00]);
  }

  private writePlain(apdu: Buffer): Buffer {
    const length = apdu[4] ?? 0;
    this.file = Buffer.from(apdu.subarray(5, 5 + length));
    return Buffer.from([0x90, 0x00]);
  }

  private acceptMac(ins: number, header: Buffer, encrypted: Buffer, presented: Buffer): boolean {
    const session = this.session;
    if (!session) return false;
    const input = Buffer.concat([Buffer.from([ins]), le16(session.cmdCtr), session.ti, header, encrypted]);
    return equalBytes(truncateMac(aesCmac(session.macKey, input)), presented);
  }

  private iv(): Buffer {
    const session = this.session;
    if (!session) throw new Error("no session");
    const block = Buffer.alloc(16);
    block[0] = 0xa5;
    block[1] = 0x5a;
    session.ti.copy(block, 2);
    block.writeUInt16LE(session.cmdCtr, 6);
    return aesEcbEncrypt(session.encKey, block);
  }
}

export function responseStatus(response: Buffer): number {
  return statusOf(response);
}

export function responseData(response: Buffer): Buffer {
  return dataOf(response);
}

export function rndBFrom(key: Buffer, response: Buffer): Buffer {
  return decryptRndB(key, dataOf(response));
}
