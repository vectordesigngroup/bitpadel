// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { bech32 } from "bech32";

const LIMIT = 2000;

/** Bech32 LNURL (LUD-01), uppercase, which is what door and enrollment QRs encode. */
export function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf8"));
  return bech32.encode("lnurl", words, LIMIT).toUpperCase();
}

export function decodeLnurl(value: string): string {
  const decoded = bech32.decode(value.toLowerCase(), LIMIT);
  if (decoded.prefix !== "lnurl") throw new Error("not an lnurl");
  return Buffer.from(bech32.fromWords(decoded.words)).toString("utf8");
}
