// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

export type NdefFile = {
  bytes: Buffer;
  piccOffset: number;
  cmacOffset: number;
};

const PICC_PLACEHOLDER = "0".repeat(32);
const CMAC_PLACEHOLDER = "0".repeat(16);

/** HTTPS URL record with ASCII SDM placeholders. Offsets are into the whole file, including NLEN. */
export function ndefHttpsFile(urlWithoutScheme: string): NdefFile {
  if (urlWithoutScheme.includes("://")) throw new Error("pass the URL without a scheme");
  if (!urlWithoutScheme.includes(PICC_PLACEHOLDER) || !urlWithoutScheme.includes(CMAC_PLACEHOLDER)) {
    throw new Error("the URL needs 32-zero PICC and 16-zero CMAC placeholders");
  }
  const payload = Buffer.concat([Buffer.from([0x04]), Buffer.from(urlWithoutScheme, "ascii")]);
  if (payload.length > 255) throw new Error("URL is too long for a short NDEF record");
  const record = Buffer.concat([Buffer.from([0xd1, 0x01, payload.length, 0x55]), payload]);
  const file = Buffer.alloc(2 + record.length);
  file.writeUInt16BE(record.length, 0);
  record.copy(file, 2);
  const text = file.toString("ascii");
  const piccOffset = text.indexOf(PICC_PLACEHOLDER);
  const cmacOffset = text.indexOf(CMAC_PLACEHOLDER);
  if (piccOffset < 0 || cmacOffset < 0) throw new Error("placeholders were not written");
  return { bytes: file, piccOffset, cmacOffset };
}

export function tapUrl(publicBaseUrl: string, area: string): string {
  const base = publicBaseUrl.replace(/\/$/, "");
  return `${base}/api/access/tap?area=${encodeURIComponent(area)}&e=${PICC_PLACEHOLDER}&c=${CMAC_PLACEHOLDER}`;
}

/** Short NDEF URI record. Prefix 0x04 is https, 0x03 is http. */
export function ndefUrlFile(absoluteUrl: string): NdefFile {
  let rest: string;
  let prefix: number;
  if (absoluteUrl.startsWith("https://")) {
    prefix = 0x04;
    rest = absoluteUrl.slice("https://".length);
  } else if (absoluteUrl.startsWith("http://")) {
    prefix = 0x03;
    rest = absoluteUrl.slice("http://".length);
  } else {
    throw new Error("tap URL must be http or https");
  }
  if (!rest.includes(PICC_PLACEHOLDER) || !rest.includes(CMAC_PLACEHOLDER)) {
    throw new Error("the URL needs 32-zero PICC and 16-zero CMAC placeholders");
  }
  const payload = Buffer.concat([Buffer.from([prefix]), Buffer.from(rest, "ascii")]);
  if (payload.length > 255) throw new Error("URL is too long for a short NDEF record");
  const record = Buffer.concat([Buffer.from([0xd1, 0x01, payload.length, 0x55]), payload]);
  const file = Buffer.alloc(2 + record.length);
  file.writeUInt16BE(record.length, 0);
  record.copy(file, 2);
  const text = file.toString("latin1");
  const piccOffset = text.indexOf(PICC_PLACEHOLDER);
  const cmacOffset = text.indexOf(CMAC_PLACEHOLDER);
  if (piccOffset < 0 || cmacOffset < 0) throw new Error("placeholders were not written");
  return { bytes: file, piccOffset, cmacOffset };
}

export function parseNdefHttps(file: Buffer): string | null {
  if (file.length < 7) return null;
  const recordStart = 2;
  if (file[recordStart] !== 0xd1 || file[recordStart + 3] !== 0x55) return null;
  const payloadLength = file[recordStart + 2] ?? 0;
  const prefix = file[recordStart + 4];
  const rest = file.subarray(recordStart + 5, recordStart + 4 + payloadLength).toString("ascii");
  if (prefix === 0x04) return `https://${rest}`;
  if (prefix === 0x03) return `http://${rest}`;
  return null;
}

/**
 * SDM file settings for encrypted PICC data, ASCII mirroring, and an empty CMAC input.
 * Meta read key is slot 2. File read key is slot 3. Counter retrieval is slot 1.
 */
export function sdmSettings(piccOffset: number, cmacOffset: number): Buffer {
  const out = Buffer.alloc(15);
  out[0] = 0x40;
  out[1] = 0x00;
  out[2] = 0xe0;
  out[3] = 0xc1;
  out[4] = 0xf1;
  out[5] = 0x23;
  writeLe24(out, 6, piccOffset);
  writeLe24(out, 9, cmacOffset);
  writeLe24(out, 12, cmacOffset);
  return out;
}

function writeLe24(target: Buffer, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
  target[offset + 2] = (value >> 16) & 0xff;
}
