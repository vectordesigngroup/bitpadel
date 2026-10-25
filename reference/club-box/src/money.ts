// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

/** Format an integer minor-unit amount as a major-unit decimal string. No currency symbol. */
export function minorToMajorString(amountMinor: number, decimals: number): string {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error("amount must be a non-negative integer of minor units");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    throw new Error("currency decimals are out of range");
  }
  const scale = 10 ** decimals;
  const major = Math.floor(amountMinor / scale);
  if (decimals === 0) return String(major);
  const fraction = String(amountMinor % scale).padStart(decimals, "0");
  return `${major}.${fraction}`;
}

/** Convert minor units with the operator's configured sats-per-minor rate. */
export function minorToSats(amountMinor: number, satsPerMinorUnit: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 1) {
    throw new Error("amount must be a positive integer of minor units");
  }
  if (!Number.isFinite(satsPerMinorUnit) || satsPerMinorUnit <= 0) {
    throw new Error("SATS_PER_MINOR_UNIT must be a positive number");
  }
  const sats = Math.round(amountMinor * satsPerMinorUnit);
  if (!Number.isSafeInteger(sats) || sats < 1) {
    throw new Error("Converted sat amount is not a positive integer. Check SATS_PER_MINOR_UNIT.");
  }
  return sats;
}

/** Parse a BTC decimal string from BTCPay into sats without floating-point rounding. */
export function btcStringToSats(amount: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  if (whole === undefined) return null;
  const padded = `${fraction}00000000`.slice(0, 8);
  const sats = Number(whole) * 100_000_000 + Number(padded);
  if (!Number.isSafeInteger(sats)) return null;
  return sats;
}
