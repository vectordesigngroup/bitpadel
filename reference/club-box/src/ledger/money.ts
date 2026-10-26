// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "../errors.js";

export type MoneyUnit = "minor" | "sats";

/**
 * Convert sats to minor units only when the club's rate divides evenly.
 * The result is an integer. A fractional rate is refused so the ledger never stores a rounded guess.
 */
export function exactMinorFromSats(amountSats: number, satsPerMinorUnit: number | null): number {
  if (satsPerMinorUnit == null || !Number.isInteger(satsPerMinorUnit) || satsPerMinorUnit < 1) {
    throw new AppError(
      400,
      "Sats charges need SATS_PER_MINOR_UNIT set to a positive integer so the minor-unit amount is exact",
    );
  }
  if (!Number.isInteger(amountSats) || amountSats < 1 || !Number.isSafeInteger(amountSats)) {
    throw new AppError(400, "amountSats must be a positive integer");
  }
  if (amountSats % satsPerMinorUnit !== 0) {
    throw new AppError(
      400,
      "That sats amount does not convert to a whole number of minor units at the club's SATS_PER_MINOR_UNIT",
    );
  }
  const minor = amountSats / satsPerMinorUnit;
  if (!Number.isSafeInteger(minor) || minor < 1) {
    throw new AppError(400, "Converted minor-unit amount is not a positive integer");
  }
  return minor;
}
