// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALE_IDS, type LocaleId } from "./locales.js";

export type MessageVars = Record<string, string | number>;

const LOCALES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../locales");

let cached: Record<LocaleId, Record<string, string>> | null = null;

export function localesDirectory(): string {
  return LOCALES_DIR;
}

export function loadCatalog(locale: LocaleId): Record<string, string> {
  const file = path.join(LOCALES_DIR, `${locale}.json`);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Catalog ${locale} must be a JSON object`);
  }
  const messages: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Catalog ${locale} key ${key} must be a non-empty string`);
    }
    messages[key] = value;
  }
  return messages;
}

export function allCatalogs(): Record<LocaleId, Record<string, string>> {
  if (cached) return cached;
  const catalogs = {} as Record<LocaleId, Record<string, string>>;
  for (const locale of LOCALE_IDS) catalogs[locale] = loadCatalog(locale);
  cached = catalogs;
  return catalogs;
}

export function translate(locale: LocaleId, key: string, vars?: MessageVars): string {
  const catalogs = allCatalogs();
  const template = catalogs[locale][key] ?? catalogs.en[key];
  if (template === undefined) throw new Error(`Missing message ${key}`);
  return interpolate(template, vars);
}

export function interpolate(template: string, vars?: MessageVars): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name: string) => {
    const value = vars?.[name];
    return value === undefined || value === null ? token : String(value);
  });
}
