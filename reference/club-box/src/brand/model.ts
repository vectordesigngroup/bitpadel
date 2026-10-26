// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { LocaleId } from "../i18n/locales.js";

export const BRAND_FONT_KEYS = ["system", "serif", "humanist", "readable"] as const;
export type BrandFontKey = (typeof BRAND_FONT_KEYS)[number];

export type BrandLink = {
  label: string;
  url: string;
};

export type BrandAsset = {
  key: string;
  contentType: string;
};

/** Saved club look. Defaults match the neutral placeholder palette. */
export type ClubBrand = {
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
  logo: BrandAsset | null;
  favicon: BrandAsset | null;
  defaultLocale: LocaleId;
  updatedAt: string | null;
};

export type PublicBrand = {
  clubName: string;
  shortName: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontKey: BrandFontKey;
  fonts: Array<{ key: BrandFontKey; label: string }>;
  footerText: string;
  contactText: string;
  links: BrandLink[];
  hasLogo: boolean;
  hasFavicon: boolean;
  defaultLocale: LocaleId;
  updatedAt: string | null;
  usingPlaceholder: boolean;
  placeholderNote: string;
  contrastWarnings: string[];
};

export const DEFAULT_CLUB_NAME = "Your club";
export const DEFAULT_SHORT_NAME = "Your club";
export const DEFAULT_FOOTER_TEXT =
  "This look is a placeholder. Give your club its own name and logo. The BitPadel name and logo are not your club's brand.";
export const PLACEHOLDER_NOTE =
  "BitPadel is the name of this kit, not your club. Choose your own name and logo. Do not use the BitPadel name or logo as the club brand.";

export const DEFAULT_PRIMARY = "#14b8a6";
export const DEFAULT_ACCENT = "#d9f99d";
export const DEFAULT_BACKGROUND = "#0f172a";
export const DEFAULT_TEXT = "#f8fafc";

export function defaultClubBrand(): ClubBrand {
  return {
    clubName: DEFAULT_CLUB_NAME,
    shortName: DEFAULT_SHORT_NAME,
    primaryColor: DEFAULT_PRIMARY,
    accentColor: DEFAULT_ACCENT,
    backgroundColor: DEFAULT_BACKGROUND,
    textColor: DEFAULT_TEXT,
    fontKey: "system",
    footerText: DEFAULT_FOOTER_TEXT,
    contactText: "",
    links: [],
    logo: null,
    favicon: null,
    defaultLocale: "en",
    updatedAt: null,
  };
}

export function isBrandFontKey(value: string): value is BrandFontKey {
  return (BRAND_FONT_KEYS as readonly string[]).includes(value);
}

export function fontLabel(key: BrandFontKey): string {
  switch (key) {
    case "system":
      return "System sans";
    case "serif":
      return "Serif";
    case "humanist":
      return "Humanist sans";
    case "readable":
      return "Large screen sans";
    default: {
      const unknown: never = key;
      throw new Error(`Unknown font: ${String(unknown)}`);
    }
  }
}

/** Stacks are local fonts only. The page policy does not load a font from another site. */
export function fontStack(key: BrandFontKey): string {
  switch (key) {
    case "system":
      return '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    case "serif":
      return 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif';
    case "humanist":
      return '"Segoe UI", "Avenir Next", "Trebuchet MS", system-ui, sans-serif';
    case "readable":
      return "Verdana, Geneva, sans-serif";
    default: {
      const unknown: never = key;
      throw new Error(`Unknown font: ${String(unknown)}`);
    }
  }
}

export function isPlaceholderBrand(brand: ClubBrand): boolean {
  return brand.clubName === DEFAULT_CLUB_NAME && brand.shortName === DEFAULT_SHORT_NAME && brand.logo === null;
}
