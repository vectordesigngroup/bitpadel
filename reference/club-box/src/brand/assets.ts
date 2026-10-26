// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "../errors.js";

export const BRAND_ASSET_MAX_BYTES = 512 * 1024;

export type BrandAssetKind = "logo" | "favicon";
export type BrandAssetExt = "png" | "jpg" | "svg" | "ico";

export type SniffedAsset = {
  ext: BrandAssetExt;
  contentType: string;
};

export function sniffBrandAsset(bytes: Buffer, kind: BrandAssetKind): SniffedAsset {
  if (bytes.length === 0) throw new AppError(400, "The file is empty");
  if (bytes.length > BRAND_ASSET_MAX_BYTES) {
    throw new AppError(400, "File must be 512 KB or smaller");
  }
  if (isPng(bytes)) return { ext: "png", contentType: "image/png" };
  if (isJpeg(bytes)) return { ext: "jpg", contentType: "image/jpeg" };
  if (kind === "favicon" && isIco(bytes)) return { ext: "ico", contentType: "image/x-icon" };
  if (isSvg(bytes)) return { ext: "svg", contentType: "image/svg+xml" };
  const allowed = kind === "favicon" ? "PNG, JPG, SVG, or ICO" : "PNG, JPG, or SVG";
  throw new AppError(400, `Use a ${allowed} file.`);
}

export function assetKey(kind: BrandAssetKind, ext: BrandAssetExt): string {
  return kind === "logo" ? `brand-logo.${ext}` : `brand-favicon.${ext}`;
}

export function assertNoReservedMark(svg: string): void {
  const plain = svg.replace(/<[^>]+>/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (plain.includes("bitpadel")) {
    throw new AppError(400, "That file uses the BitPadel placeholder name. Upload your club's own logo.");
  }
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isIco(bytes: Buffer): boolean {
  return bytes.length >= 22 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
}

function isSvg(bytes: Buffer): boolean {
  const start = bytes.subarray(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return start.startsWith("<svg") || start.startsWith("<?xml");
}
