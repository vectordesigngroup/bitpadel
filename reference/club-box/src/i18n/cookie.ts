// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { IncomingHttpHeaders } from "node:http";
import type { LocaleId } from "./locales.js";

export const LOCALE_COOKIE = "club_locale";

export function readCookie(headers: IncomingHttpHeaders, name: string): string {
  const raw = headers.cookie;
  if (typeof raw !== "string") return "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

/** Session cookie. It lasts until the browser closes. A logged-in member's profile is stored apart from this. */
export function localeCookie(locale: LocaleId, secure: boolean): string {
  const parts = [`${LOCALE_COOKIE}=${encodeURIComponent(locale)}`, "HttpOnly", "SameSite=Lax", "Path=/"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function headerLine(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
