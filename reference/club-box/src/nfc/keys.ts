import { readFileSync } from "node:fs";
import { fromHex } from "./bytes.js";

export type NfcKeyMaterial = {
  masterKey: Buffer | null;
  metaReadKey: Buffer | null;
  systemId: string;
  transportKey: Buffer;
};

type KeyFile = {
  masterKey?: string;
  metaReadKey?: string;
  systemId?: string;
  transportKey?: string;
};

const ZERO_KEY = Buffer.alloc(16);

export function loadNfcKeys(env: Record<string, string | undefined>): NfcKeyMaterial {
  const filePath = env.NFC_KEYS_FILE?.trim() ?? "";
  const fromFile = filePath ? readKeyFile(filePath) : {};
  const systemId = env.NFC_SYSTEM_ID?.trim() || fromFile.systemId || "club-box";
  if (Buffer.byteLength(systemId) > 16) throw new Error("NFC_SYSTEM_ID must be at most 16 bytes");
  const masterHex = env.NFC_MASTER_KEY?.trim() || fromFile.masterKey || "";
  const metaHex = env.NFC_SDM_META_READ_KEY?.trim() || fromFile.metaReadKey || "";
  const transportHex = env.NFC_TRANSPORT_KEY?.trim() || fromFile.transportKey || "";
  if ((masterHex && !metaHex) || (!masterHex && metaHex)) {
    throw new Error("Set both NFC_MASTER_KEY and NFC_SDM_META_READ_KEY, or neither");
  }
  return {
    masterKey: masterHex ? keyHex(masterHex, "NFC_MASTER_KEY") : null,
    metaReadKey: metaHex ? keyHex(metaHex, "NFC_SDM_META_READ_KEY") : null,
    systemId,
    transportKey: transportHex ? keyHex(transportHex, "NFC_TRANSPORT_KEY") : ZERO_KEY,
  };
}

function readKeyFile(filePath: string): KeyFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new Error("NFC_KEYS_FILE must be a JSON object. Do not commit that file.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("NFC_KEYS_FILE must be a JSON object");
  const record = parsed as Record<string, unknown>;
  return {
    masterKey: optionalHexField(record, "masterKey"),
    metaReadKey: optionalHexField(record, "metaReadKey"),
    systemId: typeof record.systemId === "string" ? record.systemId : undefined,
    transportKey: optionalHexField(record, "transportKey"),
  };
}

function optionalHexField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${name} in the key file must be a hex string`);
  return value.trim();
}

function keyHex(hex: string, name: string): Buffer {
  const key = fromHex(hex);
  if (key.length !== 16) throw new Error(`${name} must be 16 bytes of hex`);
  return key;
}
