import { aesCbcDecrypt, aesCbcEncrypt, aesCmac, aesEcbEncrypt, ntagCrc32, pad80, truncateMac } from "./aes.js";
import { fromHex, rotateLeft, rotateRight, toHex, xor } from "./bytes.js";

const ZERO_IV = Buffer.alloc(16);

export type Ev2Session = {
  encKey: Buffer;
  macKey: Buffer;
  ti: Buffer;
  cmdCtr: number;
};

export function authenticateEv2FirstPart1(keyNumber: number): Buffer {
  return isoWrap(0x71, Buffer.from([keyNumber, 0x00]));
}

export function authenticateEv2FirstPart2(key: Buffer, rndA: Buffer, encryptedRndB: Buffer): Buffer {
  const rndB = aesCbcDecrypt(key, ZERO_IV, encryptedRndB);
  const plain = Buffer.concat([rndA, rotateLeft(rndB)]);
  return isoWrap(0xaf, aesCbcEncrypt(key, ZERO_IV, plain));
}

/** Finish EV2 first authentication from the part-2 response body (no status word). */
export function openEv2Session(key: Buffer, rndA: Buffer, rndB: Buffer, encryptedResponse: Buffer): Ev2Session {
  const plain = aesCbcDecrypt(key, ZERO_IV, encryptedResponse);
  const ti = plain.subarray(0, 4);
  const rndABack = rotateRight(plain.subarray(4, 20));
  if (!rndABack.equals(rndA)) throw new Error("card did not echo RndA");
  const vectors = sessionVectors(rndA, rndB);
  return {
    encKey: aesCmac(key, vectors.sv1),
    macKey: aesCmac(key, vectors.sv2),
    ti: Buffer.from(ti),
    cmdCtr: 0,
  };
}

export function decryptRndB(key: Buffer, encryptedRndB: Buffer): Buffer {
  return aesCbcDecrypt(key, ZERO_IV, encryptedRndB);
}

/**
 * AN12196 session vector.
 * RndA[15:14] is the first two bytes when the buffer is written left to right.
 */
export function sessionVectors(rndA: Buffer, rndB: Buffer): { sv1: Buffer; sv2: Buffer } {
  const mixed = Buffer.concat([
    rndA.subarray(0, 2),
    xor(rndA.subarray(2, 8), rndB.subarray(0, 6)),
    rndB.subarray(6, 16),
    rndA.subarray(8, 16),
  ]);
  return {
    sv1: Buffer.concat([fromHex("a55a00010080"), mixed]),
    sv2: Buffer.concat([fromHex("5aa500010080"), mixed]),
  };
}

export function commandIv(session: Ev2Session, cmdCtr = session.cmdCtr): Buffer {
  const block = Buffer.alloc(16);
  block[0] = 0xa5;
  block[1] = 0x5a;
  session.ti.copy(block, 2);
  block.writeUInt16LE(cmdCtr, 6);
  return aesEcbEncrypt(session.encKey, block);
}

/** CommMode.Full command. Advances the session command counter. */
export function secureCommand(
  session: Ev2Session,
  ins: number,
  header: Buffer,
  plaintext: Buffer,
  alreadyPadded = false,
): Buffer {
  const body = alreadyPadded ? plaintext : pad80(plaintext);
  if (body.length % 16 !== 0) throw new Error("secure command body is not block aligned");
  const encrypted = aesCbcEncrypt(session.encKey, commandIv(session), body);
  const macInput = Buffer.concat([
    Buffer.from([ins]),
    le16(session.cmdCtr),
    session.ti,
    header,
    encrypted,
  ]);
  const mac = truncateMac(aesCmac(session.macKey, macInput));
  const apdu = isoWrap(ins, Buffer.concat([header, encrypted, mac]));
  session.cmdCtr += 1;
  return apdu;
}

/**
 * ChangeKey cryptogram before secure messaging.
 * A different key is XOR'd with the old key and carries a CRC32.
 * The authenticated key is sent in the clear with 0x80 padding and no CRC.
 * AN12196 section 5.16.
 */
export function changeKeyPlaintext(input: {
  sameKey: boolean;
  oldKey: Buffer;
  newKey: Buffer;
  version?: number;
}): Buffer {
  const version = input.version ?? 0x01;
  if (input.sameKey) {
    const plain = Buffer.alloc(32);
    input.newKey.copy(plain);
    plain[16] = version;
    plain[17] = 0x80;
    return plain;
  }
  const body = Buffer.concat([xor(input.oldKey, input.newKey), Buffer.from([version]), ntagCrc32(input.newKey)]);
  return pad80(body).subarray(0, 32);
}

export function selectNdefApplication(): Buffer {
  return Buffer.from("00a4040c07d276000085010100", "hex");
}

export function updateBinary(offset: number, data: Buffer): Buffer {
  if (offset > 0xffff) throw new Error("offset too large");
  const apdu = Buffer.alloc(5 + data.length + 1);
  apdu[0] = 0x00;
  apdu[1] = 0xd6;
  apdu[2] = (offset >> 8) & 0xff;
  apdu[3] = offset & 0xff;
  apdu[4] = data.length;
  data.copy(apdu, 5);
  return apdu;
}

export function readBinary(length: number): Buffer {
  return Buffer.from([0x00, 0xb0, 0x00, 0x00, length]);
}

export function isoWrap(ins: number, data: Buffer): Buffer {
  const apdu = Buffer.alloc(5 + data.length + 1);
  apdu[0] = 0x90;
  apdu[1] = ins;
  apdu[4] = data.length;
  data.copy(apdu, 5);
  return apdu;
}

export function le16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

export function statusOf(response: Buffer): number {
  if (response.length < 2) return -1;
  return (response[response.length - 2]! << 8) | response[response.length - 1]!;
}

export function dataOf(response: Buffer): Buffer {
  if (response.length < 2) return Buffer.alloc(0);
  return response.subarray(0, response.length - 2);
}

export function hexApdu(apdu: Buffer): string {
  return toHex(apdu);
}
