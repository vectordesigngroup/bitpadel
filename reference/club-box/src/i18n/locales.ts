// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

/** Locales with a message catalog. `pt-BR` is the Portuguese default. */
export const LOCALE_IDS = ["en", "es", "fr", "it", "pt-BR"] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

/**
 * Tags that use another catalog until they have their own file.
 * Add `pt-PT` to `LOCALE_IDS` and delete the `pt-pt` alias when that catalog exists.
 * A supported id always wins over an alias.
 */
export const LOCALE_ALIASES: Readonly<Record<string, LocaleId>> = {
  pt: "pt-BR",
  "pt-pt": "pt-BR",
};

export function isLocaleId(value: string): value is LocaleId {
  return (LOCALE_IDS as readonly string[]).includes(value);
}

export function localeName(id: LocaleId): string {
  switch (id) {
    case "en":
      return "English";
    case "es":
      return "Español";
    case "fr":
      return "Français";
    case "it":
      return "Italiano";
    case "pt-BR":
      return "Português (Brasil)";
    default: {
      const unknown: never = id;
      return unknown;
    }
  }
}

export function localeChoices(): Array<{ id: LocaleId; name: string }> {
  return LOCALE_IDS.map((id) => ({ id, name: localeName(id) }));
}

/** Map a BCP 47 tag to a catalog. Unsupported tags return null. */
export function canonicalizeLocale(raw: string | null | undefined): LocaleId | null {
  if (!raw) return null;
  const tag = raw.trim().replace(/_/g, "-").toLowerCase();
  if (!tag || tag === "*") return null;
  const exact = LOCALE_IDS.find((id) => id.toLowerCase() === tag);
  if (exact) return exact;
  const aliased = LOCALE_ALIASES[tag];
  if (aliased) return aliased;
  const language = tag.split("-")[0] ?? "";
  const base = LOCALE_IDS.find((id) => id.toLowerCase() === language);
  if (base) return base;
  return LOCALE_ALIASES[language] ?? null;
}
