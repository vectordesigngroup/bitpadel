// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { translate } from "./catalog.js";
import type { LocaleId } from "./locales.js";
import type { LocaleChoice } from "./negotiate.js";

export type LocaleBoot = {
  locale: LocaleId;
  source: LocaleChoice["source"];
  timeZone: string;
  currency: string;
  currencyDecimals: number;
  locales: Array<{ id: LocaleId; name: string }>;
  messages: Record<string, string>;
};

/** Translate elements marked with data-i18n before the page is sent. */
export function applyCatalogHtml(html: string, locale: LocaleId): string {
  const translated = html.replace(
    /(<[^>]*\sdata-i18n="([^"]+)"[^>]*>)([^<]*)/g,
    (_full, open: string, key: string) => `${open}${escapeHtml(translate(locale, key))}`,
  );
  return applyAlt(applyTitle(translated, locale), locale);
}

export function selectLocaleOption(html: string, locale: LocaleId): string {
  return html.replace(/<form class="locale-switch" method="get">[\s\S]*?<\/form>/g, (form) =>
    form.replace(/<option value="([^"]+)"(?: selected)?>/g, (_full, id: string) =>
      id === locale ? `<option value="${id}" selected>` : `<option value="${id}">`,
    ),
  );
}

/** Keep the current query, except lang, when the no-script form is submitted. */
export function preserveQueryOnLocaleForm(html: string, params: URLSearchParams): string {
  const hidden = [...params.entries()]
    .filter(([key]) => key !== "lang")
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("");
  if (!hidden) return html;
  return html.replace(/<form class="locale-switch" method="get">/g, `<form class="locale-switch" method="get">${hidden}`);
}

export function injectLocaleBoot(html: string, boot: LocaleBoot): string {
  const json = JSON.stringify(boot).replaceAll("<", "\\u003c");
  const tag = `<script id="i18n-boot" type="application/json">${json}</script>`;
  const withLang = html.replace(/<html lang="[^"]*">/, `<html lang="${boot.locale}">`);
  if (withLang.includes('id="i18n-boot"')) {
    return withLang.replace(/<script id="i18n-boot" type="application\/json">[\s\S]*?<\/script>/, tag);
  }
  return withLang.replace(/<script /, `${tag}\n  <script `);
}

function applyTitle(html: string, locale: LocaleId): string {
  const key = /<body[^>]*\sdata-i18n-title="([^"]+)"/.exec(html)?.[1];
  if (!key) return html;
  return html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(translate(locale, key))}</title>`);
}

function applyAlt(html: string, locale: LocaleId): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const key = /data-i18n-alt="([^"]+)"/.exec(tag)?.[1];
    if (!key) return tag;
    const alt = escapeHtml(translate(locale, key));
    if (/alt="[^"]*"/.test(tag)) return tag.replace(/alt="[^"]*"/, `alt="${alt}"`);
    return tag.replace("<img", `<img alt="${alt}"`);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
