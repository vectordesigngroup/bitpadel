// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { canonicalizeLocale, type LocaleId } from "./locales.js";

export type LocaleSource = "query" | "profile" | "cookie" | "accept-language" | "club" | "default";

export type LocaleChoice = {
  locale: LocaleId;
  source: LocaleSource;
};

/**
 * Page language.
 * A `lang` query applies to this request only.
 * A logged-in member's saved language beats the browser cookie.
 * The cookie beats Accept-Language. The club default is next. English is last.
 */
export function resolveLocale(input: {
  query?: string | null;
  profile?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
  clubDefault?: string | null;
}): LocaleChoice {
  const query = canonicalizeLocale(input.query);
  if (query) return { locale: query, source: "query" };
  const profile = canonicalizeLocale(input.profile);
  if (profile) return { locale: profile, source: "profile" };
  const cookie = canonicalizeLocale(input.cookie);
  if (cookie) return { locale: cookie, source: "cookie" };
  const accepted = negotiateAcceptLanguage(input.acceptLanguage);
  if (accepted) return { locale: accepted, source: "accept-language" };
  const club = canonicalizeLocale(input.clubDefault);
  if (club) return { locale: club, source: "club" };
  return { locale: "en", source: "default" };
}

/** Pick the first supported language range in an Accept-Language header. */
export function negotiateAcceptLanguage(header: string | null | undefined): LocaleId | null {
  if (!header) return null;
  const ranges = header
    .split(",")
    .map((part) => parseRange(part))
    .filter((range): range is { tag: string; q: number } => range !== null && range.q > 0);
  ranges.sort((left, right) => right.q - left.q);
  for (const range of ranges) {
    const locale = canonicalizeLocale(range.tag);
    if (locale) return locale;
  }
  return null;
}

function parseRange(part: string): { tag: string; q: number } | null {
  const [rawTag, ...params] = part.trim().split(";");
  const tag = rawTag?.trim() ?? "";
  if (!tag) return null;
  let q = 1;
  for (const param of params) {
    const [key, value] = param.trim().split("=");
    if (key?.trim() === "q") {
      const parsed = Number(value);
      q = Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return { tag, q };
}
