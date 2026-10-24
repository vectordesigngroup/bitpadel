/**
 * How a door learns that a card was presented.
 * The server never trusts a bare UID unless the operator turned on the insecure dev switch.
 */
export type CardPresentation =
  | { kind: "sun"; piccDataHex: string; cmacHex: string; area: string }
  | { kind: "desfire"; uidHex: string; counter: number; cmacHex: string; area: string }
  | { kind: "uid-insecure"; uidHex: string; area: string };

export type NfcReader = {
  readonly name: "mock" | "pcsc" | "sun-url";
};

export const READER_NAMES = ["mock", "pcsc", "sun-url"] as const;

export function assertReaderName(name: string): NfcReader["name"] {
  if (name === "mock" || name === "pcsc" || name === "sun-url") return name;
  throw new Error(`unknown NFC reader ${name}`);
}
