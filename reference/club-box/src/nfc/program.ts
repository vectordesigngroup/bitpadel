import { randomBytes } from "node:crypto";
import { diversifyNtagKey } from "./diversify.js";
import {
  authenticateEv2FirstPart1,
  authenticateEv2FirstPart2,
  changeKeyPlaintext,
  dataOf,
  decryptRndB,
  openEv2Session,
  readBinary,
  secureCommand,
  selectNdefApplication,
  statusOf,
  updateBinary,
  type Ev2Session,
} from "./ev2.js";
import { ndefUrlFile, sdmSettings, tapUrl } from "./ndef.js";
import type { NfcKeyMaterial } from "./keys.js";

export type CardTransport = {
  transceive(apdu: Buffer): Promise<Buffer>;
};

export type ProgramOptions = {
  keys: NfcKeyMaterial;
  publicBaseUrl: string;
  area: string;
  uid: Buffer;
};

export type ProgramResult = {
  uid: Buffer;
  apdus: string[];
  url: string;
};

const KEY_VERSION = 0x01;

/**
 * Personalize an NTAG 424 DNA: EV2 auth, diversified keys, NDEF SUN URL, SDM, then lock key 0.
 * The SDM meta read key is not diversified. AN12196 says the verifier cannot diversify it
 * before decrypting the UID.
 */
export async function programCard(transport: CardTransport, options: ProgramOptions): Promise<ProgramResult> {
  const master = options.keys.masterKey;
  const meta = options.keys.metaReadKey;
  if (!master || !meta) throw new Error("NFC master key and SDM meta read key are required");
  const apdus: string[] = [];
  const send = async (apdu: Buffer): Promise<Buffer> => {
    apdus.push(apdu.toString("hex"));
    const response = await transport.transceive(apdu);
    const status = statusOf(response);
    if (status !== 0x9100 && status !== 0x9000 && status !== 0x91af) {
      throw new Error(`card rejected an APDU with status ${status.toString(16)}`);
    }
    return response;
  };

  await send(selectNdefApplication());
  const part1 = await send(authenticateEv2FirstPart1(0));
  const rndB = decryptRndB(options.keys.transportKey, dataOf(part1));
  const rndA = randomBytes(16);
  const part2 = await send(authenticateEv2FirstPart2(options.keys.transportKey, rndA, dataOf(part1)));
  const session = openEv2Session(options.keys.transportKey, rndA, rndB, dataOf(part2));

  const uid = options.uid;
  const diversified = (keyNumber: number): Buffer =>
    diversifyNtagKey(master, uid, keyNumber, options.keys.systemId);
  const current = [
    options.keys.transportKey,
    Buffer.alloc(16),
    Buffer.alloc(16),
    Buffer.alloc(16),
    Buffer.alloc(16),
  ];
  const next = [diversified(0), diversified(1), meta, diversified(3), diversified(4)];
  for (const keyNumber of [1, 2, 3, 4, 0]) {
    await changeKey(send, session, keyNumber, current[keyNumber] ?? Buffer.alloc(16), next[keyNumber] ?? Buffer.alloc(16));
  }

  const url = tapUrl(options.publicBaseUrl, options.area);
  const ndef = ndefUrlFile(url);
  if (ndef.bytes.length > 255) throw new Error("tap URL is too long for this programmer's short read");
  await send(updateBinary(0, ndef.bytes));
  await send(secureCommand(session, 0x5f, Buffer.from([0x02]), sdmSettings(ndef.piccOffset, ndef.cmacOffset)));
  const read = await send(readBinary(ndef.bytes.length));
  const body = dataOf(read);
  if (!body.equals(ndef.bytes)) throw new Error("the card did not read back the NDEF file");
  return { uid, apdus, url };
}

async function changeKey(
  send: (apdu: Buffer) => Promise<Buffer>,
  session: Ev2Session,
  keyNumber: number,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<void> {
  const plain = changeKeyPlaintext({ sameKey: keyNumber === 0, oldKey, newKey, version: KEY_VERSION });
  await send(secureCommand(session, 0xc4, Buffer.from([keyNumber]), plain, true));
}
