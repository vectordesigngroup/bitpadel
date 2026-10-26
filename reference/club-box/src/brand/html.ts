// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { PublicBrand } from "./model.js";

/** Fill the static page shell with the saved club name, footer, and logo. */
export function injectBrandHtml(html: string, brand: PublicBrand): string {
  const short = escapeHtml(brand.shortName);
  const clubName = escapeHtml(brand.clubName);
  let out = html.replace(
    /<span class="brand-name-text">[\s\S]*?<\/span>/g,
    `<span class="brand-name-text">${clubName}</span>`,
  );
  out = out.replace(
    /<p class="brand-footer-text">[\s\S]*?<\/p>/g,
    `<p class="brand-footer-text">${escapeHtml(brand.footerText)}</p>`,
  );
  out = out.replace(
    /<p class="brand-contact">[\s\S]*?<\/p>/g,
    `<p class="brand-contact">${escapeHtml(brand.contactText)}</p>`,
  );
  out = out.replace(/<p class="brand-links">[\s\S]*?<\/p>/g, `<p class="brand-links">${renderLinks(brand)}</p>`);
  if (brand.hasLogo) {
    const src = `/brand/logo?v=${encodeURIComponent(brand.updatedAt ?? "0")}`;
    out = out.replace(/<img class="brand-logo" alt=""[^>]*>/g, `<img class="brand-logo" alt="" src="${src}">`);
  }
  out = out.replace(/<title>([^<]*)<\/title>/, (_full, title: string) => {
    if (title.startsWith(`${short} — `) || title.startsWith(`${short} - `)) return `<title>${title}</title>`;
    return `<title>${short} — ${title}</title>`;
  });
  if (brand.hasFavicon) {
    const href = `/brand/favicon?v=${encodeURIComponent(brand.updatedAt ?? "0")}`;
    const tag = `<link rel="icon" href="${href}">`;
    if (out.includes('rel="icon"')) out = out.replace(/<link rel="icon"[^>]*>/, tag);
    else out = out.replace("</head>", `${tag}\n</head>`);
  }
  return out;
}

function renderLinks(brand: PublicBrand): string {
  return brand.links
    .map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`)
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
