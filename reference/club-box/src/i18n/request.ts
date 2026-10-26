// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { IncomingHttpHeaders } from "node:http";
import type Database from "better-sqlite3";
import { loadClubBrand } from "../brand/store.js";
import { playerFromRequest } from "../player/service.js";
import { headerLine, LOCALE_COOKIE, readCookie } from "./cookie.js";
import type { LocaleChoice } from "./negotiate.js";
import { resolveLocale } from "./negotiate.js";

export function localeFromRequest(
  db: Database.Database,
  headers: IncomingHttpHeaders,
  url: URL,
  now: Date,
): LocaleChoice {
  const player = playerFromRequest(db, headers, now);
  return resolveLocale({
    query: url.searchParams.get("lang"),
    profile: player?.preferredLocale ?? null,
    cookie: readCookie(headers, LOCALE_COOKIE),
    acceptLanguage: headerLine(headers["accept-language"]),
    clubDefault: loadClubBrand(db).defaultLocale,
  });
}
