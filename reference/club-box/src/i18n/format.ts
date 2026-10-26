// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { translate } from "./catalog.js";
import type { LocaleId } from "./locales.js";

/** Medium date and short time in the club timezone. Hour cycle follows the locale. */
export function formatDateTime(date: Date, locale: LocaleId, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDate(date: Date, locale: LocaleId, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium" }).format(date);
}

export function formatTime(date: Date, locale: LocaleId, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, timeStyle: "short" }).format(date);
}

export function formatNumber(value: number, locale: LocaleId): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: "always" }).format(value);
}

/**
 * Format minor units with Intl currency when the code is a real ISO currency.
 * Unknown codes keep the grouped number and the code, with the club's decimal scale.
 */
export function formatMoney(amountMinor: number, currency: string, decimals: number, locale: LocaleId): string {
  const major = amountMinor / 10 ** decimals;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: "always",
    }).format(major);
  } catch {
    const number = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: "always",
    }).format(major);
    return `${number} ${currency}`;
  }
}

/** Grouped sats amount, for example `1.000 sats` in Spanish. The unit word stays `sats`. */
export function formatSats(amount: number, locale: LocaleId): string {
  return translate(locale, "format.sats", { amount: formatNumber(amount, locale) });
}
