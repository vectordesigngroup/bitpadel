// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "../errors.js";
import {
  DEFAULT_ACCENT,
  DEFAULT_BACKGROUND,
  DEFAULT_PRIMARY,
  DEFAULT_TEXT,
  fontStack,
  isBrandFontKey,
  type BrandFontKey,
  type ClubBrand,
} from "./model.js";

const HEX = /^#([0-9a-f]{6})$/;

export function normalizeHex(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!HEX.test(withHash)) throw new AppError(400, "Colors must be 6-digit hex, such as #14b8a6");
  return withHash;
}

export function tryNormalizeHex(value: string): string | null {
  try {
    return normalizeHex(value);
  } catch {
    return null;
  }
}

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(rgb: Rgb): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function mix(from: string, to: string, amount: number): string {
  const left = hexToRgb(from);
  const right = hexToRgb(to);
  return rgbToHex({
    r: left.r + (right.r - left.r) * amount,
    g: left.g + (right.g - left.g) * amount,
    b: left.b + (right.b - left.b) * amount,
  });
}

function channelLuminance(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastWarnings(brand: Pick<ClubBrand, "backgroundColor" | "textColor" | "primaryColor" | "accentColor">): string[] {
  const warnings: string[] = [];
  const text = contrastRatio(brand.textColor, brand.backgroundColor);
  if (text < 4.5) {
    warnings.push(`Text on the background is ${text.toFixed(2)}:1. Aim for 4.5:1 or higher.`);
  }
  const button = contrastRatio(brand.backgroundColor, brand.primaryColor);
  if (button < 4.5) {
    warnings.push(`Button text on the primary color is ${button.toFixed(2)}:1. Aim for 4.5:1 or higher.`);
  }
  const links = contrastRatio(brand.accentColor, brand.backgroundColor);
  if (links < 4.5) {
    warnings.push(`Links on the background are ${links.toFixed(2)}:1. Aim for 4.5:1 or higher.`);
  }
  return warnings;
}

export type CssVariables = {
  "--bg": string;
  "--surface": string;
  "--text": string;
  "--muted": string;
  "--primary": string;
  "--accent": string;
  "--danger": string;
  "--line": string;
};

const PLACEHOLDER_SURFACE = "#1e293b";
const PLACEHOLDER_MUTED = "#94a3b8";
const PLACEHOLDER_DANGER = "#fda4af";
const PLACEHOLDER_LINE = "#334155";

export function cssVariables(brand: Pick<ClubBrand, "backgroundColor" | "textColor" | "primaryColor" | "accentColor">): CssVariables {
  const background = normalizeHex(brand.backgroundColor);
  const text = normalizeHex(brand.textColor);
  const primary = normalizeHex(brand.primaryColor);
  const accent = normalizeHex(brand.accentColor);
  const placeholder =
    background === DEFAULT_BACKGROUND &&
    text === DEFAULT_TEXT &&
    primary === DEFAULT_PRIMARY &&
    accent === DEFAULT_ACCENT;
  if (placeholder) {
    return {
      "--bg": DEFAULT_BACKGROUND,
      "--surface": PLACEHOLDER_SURFACE,
      "--text": DEFAULT_TEXT,
      "--muted": PLACEHOLDER_MUTED,
      "--primary": DEFAULT_PRIMARY,
      "--accent": DEFAULT_ACCENT,
      "--danger": PLACEHOLDER_DANGER,
      "--line": PLACEHOLDER_LINE,
    };
  }
  const dark = relativeLuminance(background) < 0.4;
  return {
    "--bg": background,
    "--surface": mix(background, text, 0.08),
    "--text": text,
    "--muted": mix(background, text, 0.62),
    "--primary": primary,
    "--accent": accent,
    "--danger": dark ? PLACEHOLDER_DANGER : "#9f1239",
    "--line": mix(background, text, 0.22),
  };
}

export function brandStylesheet(brand: ClubBrand, selector: string): string {
  const variables = cssVariables(brand);
  const lines = Object.entries(variables).map(([name, value]) => `  ${name}: ${value};`);
  lines.push(`  --font: ${fontStack(brand.fontKey)};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

export function rootBrandCss(brand: ClubBrand): string {
  return brandStylesheet(brand, ":root");
}

export function previewBrandCss(brand: ClubBrand): string {
  const sheet = brandStylesheet(brand, ".brand-preview");
  return `${sheet}.brand-preview {\n  background: var(--bg);\n  color: var(--text);\n  font-family: var(--font);\n}\n`;
}

export function parseFontKey(value: string): BrandFontKey {
  if (isBrandFontKey(value)) return value;
  throw new AppError(400, "Choose a font from the list");
}
