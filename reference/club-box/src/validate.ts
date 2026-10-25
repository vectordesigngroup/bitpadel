// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "./errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new AppError(400, "Expected a JSON object");
  return value;
}

export function requiredString(
  obj: Record<string, unknown>,
  key: string,
  max: number,
): string {
  const value = obj[key];
  if (typeof value !== "string") throw new AppError(400, `${key} is required`);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new AppError(400, `${key} must be 1-${max} characters`);
  }
  if (/[\u0000-\u001f]/.test(trimmed)) {
    throw new AppError(400, `${key} contains invalid characters`);
  }
  return trimmed;
}

export function requiredInt(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new AppError(400, `${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function requiredIso(obj: Record<string, unknown>, key: string): string {
  const value = requiredString(obj, key, 40);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new AppError(400, `${key} must be a date-time`);
  return new Date(ms).toISOString();
}

export function optionalIso(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new AppError(400, "date filter must be a string");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new AppError(400, "date filter must be a date-time");
  return new Date(ms).toISOString();
}

const AREA_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function assertAreaId(area: string, allowed: readonly string[]): void {
  if (!AREA_ID.test(area) || !allowed.includes(area)) {
    throw new AppError(400, "Unknown area");
  }
}
