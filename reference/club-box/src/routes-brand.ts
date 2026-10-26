// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { normalizeHex, parseFontKey, previewBrandCss, rootBrandCss } from "./brand/color.js";
import type { ClubBrand } from "./brand/model.js";
import {
  clearBrandAsset,
  loadClubBrand,
  readBrandAsset,
  saveBrandAsset,
  saveClubBrandText,
  toPublicBrand,
} from "./brand/store.js";
import { validateBrandInput } from "./brand/validate.js";
import type { AppDeps } from "./deps.js";
import { AppError } from "./errors.js";
import { readJson, requireAdmin, sendBytes, sendJson, sendText, type HttpReq, type Route } from "./http.js";

const SVG_HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "content-disposition": "inline",
};

export function brandRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "GET", pattern: "/api/brand", handler: (req) => publicBrand(req, ctx) },
    { method: "GET", pattern: "/api/admin/brand", handler: (req) => adminBrand(req, ctx) },
    { method: "POST", pattern: "/api/admin/brand", handler: (req) => saveBrand(req, ctx) },
    { method: "POST", pattern: "/api/admin/brand/logo", handler: (req) => uploadAsset(req, ctx, "logo") },
    { method: "POST", pattern: "/api/admin/brand/logo/clear", handler: (req) => clearAsset(req, ctx, "logo") },
    { method: "POST", pattern: "/api/admin/brand/favicon", handler: (req) => uploadAsset(req, ctx, "favicon") },
    { method: "POST", pattern: "/api/admin/brand/favicon/clear", handler: (req) => clearAsset(req, ctx, "favicon") },
    { method: "GET", pattern: "/brand.css", handler: (req) => brandCss(req, ctx) },
    { method: "GET", pattern: "/brand/preview.css", handler: (req) => previewCss(req, ctx) },
    { method: "GET", pattern: "/brand/logo", handler: (req) => assetFile(req, ctx, "logo") },
    { method: "GET", pattern: "/brand/favicon", handler: (req) => assetFile(req, ctx, "favicon") },
  ];
}

function publicBrand(req: HttpReq, ctx: AppDeps): Promise<void> {
  sendJson(req.res, 200, toPublicBrand(loadClubBrand(ctx.db)));
  return Promise.resolve();
}

function adminBrand(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendJson(req.res, 200, toPublicBrand(loadClubBrand(ctx.db)));
  return Promise.resolve();
}

function saveBrand(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const brand = saveClubBrandText(ctx.db, validateBrandInput(readJson(req)), ctx.now());
  sendJson(req.res, 200, toPublicBrand(brand));
  return Promise.resolve();
}

async function uploadAsset(req: HttpReq, ctx: AppDeps, kind: "logo" | "favicon"): Promise<void> {
  requireAdmin(req, ctx);
  const brand = await saveBrandAsset(ctx.db, ctx.storage, kind, req.rawBody, ctx.now());
  sendJson(req.res, 200, toPublicBrand(brand));
}

async function clearAsset(req: HttpReq, ctx: AppDeps, kind: "logo" | "favicon"): Promise<void> {
  requireAdmin(req, ctx);
  const brand = await clearBrandAsset(ctx.db, ctx.storage, kind, ctx.now());
  sendJson(req.res, 200, toPublicBrand(brand));
}

function brandCss(req: HttpReq, ctx: AppDeps): Promise<void> {
  sendText(req.res, 200, rootBrandCss(loadClubBrand(ctx.db)), "text/css; charset=utf-8");
  return Promise.resolve();
}

function previewCss(req: HttpReq, ctx: AppDeps): Promise<void> {
  sendText(req.res, 200, previewBrandCss(previewFromQuery(req, loadClubBrand(ctx.db))), "text/css; charset=utf-8");
  return Promise.resolve();
}

async function assetFile(req: HttpReq, ctx: AppDeps, kind: "logo" | "favicon"): Promise<void> {
  const brand = loadClubBrand(ctx.db);
  const file = kind === "logo" ? brand.logo : kind === "favicon" ? brand.favicon : unreachable(kind);
  if (!file) throw new AppError(404, kind === "logo" ? "No logo has been uploaded" : "No favicon has been uploaded");
  const bytes = await readBrandAsset(ctx.storage, file);
  if (!bytes) throw new AppError(404, kind === "logo" ? "No logo has been uploaded" : "No favicon has been uploaded");
  sendBytes(req.res, 200, bytes, file.contentType, file.contentType === "image/svg+xml" ? SVG_HEADERS : undefined);
}

function previewFromQuery(req: HttpReq, saved: ClubBrand): ClubBrand {
  const params = req.url.searchParams;
  const touched = ["background", "text", "primary", "accent", "font"].some((key) => params.has(key));
  if (!touched) return saved;
  const background = params.get("background");
  const text = params.get("text");
  const primary = params.get("primary");
  const accent = params.get("accent");
  if (!background || !text || !primary || !accent) {
    throw new AppError(400, "Preview needs background, text, primary, and accent colors");
  }
  const font = params.get("font");
  return {
    ...saved,
    backgroundColor: normalizeHex(background),
    textColor: normalizeHex(text),
    primaryColor: normalizeHex(primary),
    accentColor: normalizeHex(accent),
    fontKey: font ? parseFontKey(font) : saved.fontKey,
  };
}

function unreachable(kind: never): never {
  throw new Error(`Unknown brand asset: ${String(kind)}`);
}
