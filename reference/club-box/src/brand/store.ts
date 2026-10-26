// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import { one } from "../db.js";
import { AppError } from "../errors.js";
import type { ObjectStorage } from "../storage/types.js";
import { assertNoReservedMark, assetKey, sniffBrandAsset, type BrandAssetKind } from "./assets.js";
import { contrastWarnings } from "./color.js";
import {
  defaultClubBrand,
  fontLabel,
  isBrandFontKey,
  isPlaceholderBrand,
  BRAND_FONT_KEYS,
  PLACEHOLDER_NOTE,
  type BrandAsset,
  type BrandLink,
  type ClubBrand,
  type PublicBrand,
} from "./model.js";
import { sanitizeSvg } from "./svg.js";
import { type BrandFields } from "./validate.js";

type BrandRow = {
  club_name: string;
  short_name: string;
  primary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  font_key: string;
  footer_text: string;
  contact_text: string;
  links_json: string;
  logo_key: string | null;
  logo_type: string | null;
  favicon_key: string | null;
  favicon_type: string | null;
  updated_at: string;
};

export function loadClubBrand(db: Database.Database): ClubBrand {
  const row = one<BrandRow>(
    db,
    `SELECT club_name, short_name, primary_color, accent_color, background_color, text_color,
            font_key, footer_text, contact_text, links_json, logo_key, logo_type,
            favicon_key, favicon_type, updated_at
     FROM club_branding WHERE id = 1`,
  );
  if (!row) return defaultClubBrand();
  const fallback = defaultClubBrand();
  return {
    clubName: row.club_name || fallback.clubName,
    shortName: row.short_name || fallback.shortName,
    primaryColor: safeHex(row.primary_color, fallback.primaryColor),
    accentColor: safeHex(row.accent_color, fallback.accentColor),
    backgroundColor: safeHex(row.background_color, fallback.backgroundColor),
    textColor: safeHex(row.text_color, fallback.textColor),
    fontKey: isBrandFontKey(row.font_key) ? row.font_key : "system",
    footerText: row.footer_text,
    contactText: row.contact_text,
    links: parseLinks(row.links_json),
    logo: asset(row.logo_key, row.logo_type),
    favicon: asset(row.favicon_key, row.favicon_type),
    updatedAt: row.updated_at,
  };
}

export function toPublicBrand(brand: ClubBrand): PublicBrand {
  return {
    clubName: brand.clubName,
    shortName: brand.shortName,
    primaryColor: brand.primaryColor,
    accentColor: brand.accentColor,
    backgroundColor: brand.backgroundColor,
    textColor: brand.textColor,
    fontKey: brand.fontKey,
    fonts: BRAND_FONT_KEYS.map((key) => ({ key, label: fontLabel(key) })),
    footerText: brand.footerText,
    contactText: brand.contactText,
    links: brand.links,
    hasLogo: brand.logo !== null,
    hasFavicon: brand.favicon !== null,
    updatedAt: brand.updatedAt,
    usingPlaceholder: isPlaceholderBrand(brand),
    placeholderNote: PLACEHOLDER_NOTE,
    contrastWarnings: contrastWarnings(brand),
  };
}

export function saveClubBrandText(db: Database.Database, fields: BrandFields, now: Date): ClubBrand {
  const updatedAt = now.toISOString();
  const write = db.transaction(() => {
    ensureRow(db, updatedAt);
    db.prepare(
      `UPDATE club_branding
       SET club_name = ?, short_name = ?, primary_color = ?, accent_color = ?, background_color = ?,
           text_color = ?, font_key = ?, footer_text = ?, contact_text = ?, links_json = ?, updated_at = ?
       WHERE id = 1`,
    ).run(
      fields.clubName,
      fields.shortName,
      fields.primaryColor,
      fields.accentColor,
      fields.backgroundColor,
      fields.textColor,
      fields.fontKey,
      fields.footerText,
      fields.contactText,
      JSON.stringify(fields.links),
      updatedAt,
    );
  });
  write();
  return loadClubBrand(db);
}

export async function saveBrandAsset(
  db: Database.Database,
  storage: ObjectStorage,
  kind: BrandAssetKind,
  bytes: Buffer,
  now: Date,
): Promise<ClubBrand> {
  const sniffed = sniffBrandAsset(bytes, kind);
  let stored = bytes;
  if (sniffed.ext === "svg") {
    const text = bytes.toString("utf8");
    assertNoReservedMark(text);
    let clean: string;
    try {
      clean = sanitizeSvg(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "SVG was rejected";
      throw new AppError(400, message);
    }
    assertNoReservedMark(clean);
    stored = Buffer.from(clean, "utf8");
  }
  const key = assetKey(kind, sniffed.ext);
  const previous = loadClubBrand(db);
  const previousAsset = assetOf(previous, kind);
  await storage.put(key, stored, sniffed.contentType);
  const updatedAt = now.toISOString();
  const write = db.transaction(() => {
    ensureRow(db, updatedAt);
    writeAssetColumns(db, kind, key, sniffed.contentType, updatedAt);
  });
  write();
  if (previousAsset && previousAsset.key !== key) await storage.delete(previousAsset.key);
  return loadClubBrand(db);
}

export async function clearBrandAsset(
  db: Database.Database,
  storage: ObjectStorage,
  kind: BrandAssetKind,
  now: Date,
): Promise<ClubBrand> {
  const previous = loadClubBrand(db);
  const previousAsset = assetOf(previous, kind);
  if (!previousAsset) return previous;
  await storage.delete(previousAsset.key);
  const updatedAt = now.toISOString();
  clearAssetColumns(db, kind, updatedAt);
  return loadClubBrand(db);
}

function assetOf(brand: ClubBrand, kind: BrandAssetKind): BrandAsset | null {
  switch (kind) {
    case "logo":
      return brand.logo;
    case "favicon":
      return brand.favicon;
    default: {
      const unknown: never = kind;
      throw new Error(`Unknown brand asset: ${String(unknown)}`);
    }
  }
}

function writeAssetColumns(
  db: Database.Database,
  kind: BrandAssetKind,
  key: string,
  contentType: string,
  updatedAt: string,
): void {
  switch (kind) {
    case "logo":
      db.prepare("UPDATE club_branding SET logo_key = ?, logo_type = ?, updated_at = ? WHERE id = 1").run(
        key,
        contentType,
        updatedAt,
      );
      return;
    case "favicon":
      db.prepare("UPDATE club_branding SET favicon_key = ?, favicon_type = ?, updated_at = ? WHERE id = 1").run(
        key,
        contentType,
        updatedAt,
      );
      return;
    default: {
      const unknown: never = kind;
      throw new Error(`Unknown brand asset: ${String(unknown)}`);
    }
  }
}

function clearAssetColumns(db: Database.Database, kind: BrandAssetKind, updatedAt: string): void {
  switch (kind) {
    case "logo":
      db.prepare("UPDATE club_branding SET logo_key = NULL, logo_type = NULL, updated_at = ? WHERE id = 1").run(updatedAt);
      return;
    case "favicon":
      db.prepare("UPDATE club_branding SET favicon_key = NULL, favicon_type = NULL, updated_at = ? WHERE id = 1").run(
        updatedAt,
      );
      return;
    default: {
      const unknown: never = kind;
      throw new Error(`Unknown brand asset: ${String(unknown)}`);
    }
  }
}

export async function readBrandAsset(
  storage: ObjectStorage,
  asset: BrandAsset,
): Promise<Buffer | null> {
  const stored = await storage.get(asset.key);
  return stored?.bytes ?? null;
}

function ensureRow(db: Database.Database, updatedAt: string): void {
  const existing = one<{ id: number }>(db, "SELECT id FROM club_branding WHERE id = 1");
  if (existing) return;
  const brand = defaultClubBrand();
  db.prepare(
    `INSERT INTO club_branding (
       id, club_name, short_name, primary_color, accent_color, background_color, text_color,
       font_key, footer_text, contact_text, links_json, logo_key, logo_type, favicon_key, favicon_type, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(
    brand.clubName,
    brand.shortName,
    brand.primaryColor,
    brand.accentColor,
    brand.backgroundColor,
    brand.textColor,
    brand.fontKey,
    brand.footerText,
    brand.contactText,
    "[]",
    updatedAt,
  );
}

function asset(key: string | null, contentType: string | null): BrandAsset | null {
  if (!key || !contentType) return null;
  return { key, contentType };
}

function safeHex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/.test(value) ? value : fallback;
}

function parseLinks(raw: string): BrandLink[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const links: BrandLink[] = [];
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.label !== "string" || typeof record.url !== "string") continue;
      if (!/^https?:\/\//.test(record.url)) continue;
      links.push({ label: record.label, url: record.url });
    }
    return links;
  } catch {
    return [];
  }
}
