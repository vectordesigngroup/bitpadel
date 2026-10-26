// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "../errors.js";
import { canonicalizeLocale, type LocaleId } from "../i18n/locales.js";
import { asObject } from "../validate.js";
import { normalizeHex, parseFontKey } from "./color.js";
import { type BrandFontKey, type BrandLink } from "./model.js";

export type BrandFields = {
  clubName: string;
  shortName: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontKey: BrandFontKey;
  footerText: string;
  contactText: string;
  links: BrandLink[];
  defaultLocale?: LocaleId;
};

const MAX_LINKS = 4;

export function validateBrandInput(value: unknown): BrandFields {
  const body = asObject(value);
  const clubName = plainText(body.clubName, "clubName", 1, 80);
  const shortName = plainText(body.shortName, "shortName", 1, 40);
  assertOwnClubName(clubName, "clubName");
  assertOwnClubName(shortName, "shortName");
  const links = readLinks(body.links);
  return {
    clubName,
    shortName,
    primaryColor: colorField(body.primaryColor, "primaryColor"),
    accentColor: colorField(body.accentColor, "accentColor"),
    backgroundColor: colorField(body.backgroundColor, "backgroundColor"),
    textColor: colorField(body.textColor, "textColor"),
    fontKey: parseFontKey(requiredText(body.fontKey, "fontKey")),
    footerText: plainText(body.footerText ?? "", "footerText", 0, 500),
    contactText: plainText(body.contactText ?? "", "contactText", 0, 400),
    links,
    defaultLocale: readDefaultLocale(body.defaultLocale),
  };
}

function readDefaultLocale(value: unknown): LocaleId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AppError(400, "defaultLocale is not a supported language");
  const locale = canonicalizeLocale(value);
  if (!locale) throw new AppError(400, "defaultLocale is not a supported language");
  return locale;
}

function colorField(value: unknown, key: string): string {
  if (typeof value !== "string") throw new AppError(400, `${key} must be a 6-digit hex color`);
  try {
    return normalizeHex(value);
  } catch (error) {
    if (error instanceof AppError) throw new AppError(400, `${key} must be a 6-digit hex color`);
    throw error;
  }
}

function requiredText(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new AppError(400, `${key} is required`);
  return value.trim();
}

function plainText(value: unknown, key: string, min: number, max: number): string {
  if (typeof value !== "string") throw new AppError(400, `${key} must be text`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new AppError(400, min === 0 ? `${key} must be at most ${max} characters` : `${key} must be ${min}-${max} characters`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) {
    throw new AppError(400, `${key} contains invalid characters`);
  }
  return trimmed;
}

export function assertOwnClubName(value: string, key: string): void {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.includes("bitpadel")) {
    throw new AppError(400, `${key} must be your club's own name. BitPadel is the kit placeholder, not a club brand.`);
  }
}

function readLinks(value: unknown): BrandLink[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AppError(400, "links must be a list");
  if (value.length > MAX_LINKS) throw new AppError(400, `At most ${MAX_LINKS} footer links`);
  return value.map((item) => {
    const link = asObject(item);
    const label = plainText(link.label, "link label", 1, 40);
    const url = httpUrl(link.url);
    return { label, url };
  });
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") throw new AppError(400, "Link URL must be http or https");
  const trimmed = value.trim();
  if (trimmed.length > 200) throw new AppError(400, "Link URL must be at most 200 characters");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(400, "Link URL must be http or https");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "Link URL must be http or https");
  }
  if (parsed.username || parsed.password) throw new AppError(400, "Link URL must be http or https");
  return parsed.toString();
}
