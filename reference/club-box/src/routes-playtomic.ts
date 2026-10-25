// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { listCalendar } from "./booking/source.js";
import { staffBookingsToday } from "./checkin/service.js";
import type { AppDeps } from "./deps.js";
import { AppError } from "./errors.js";
import { readJson, requireAdmin, requireStaff, sendJson, type HttpReq, type Route } from "./http.js";
import {
  deleteCourtMap,
  listCourtMaps,
  listOpenConflicts,
  mapPlaytomicCourt,
  resolveConflict,
  syncPlaytomic,
} from "./playtomic/sync.js";
import { optionalIso, asObject, requiredString } from "./validate.js";

export function playtomicRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "GET", pattern: "/api/calendar", handler: (req) => calendar(req, ctx) },
    { method: "GET", pattern: "/api/admin/playtomic/maps", handler: (req) => maps(req, ctx) },
    { method: "POST", pattern: "/api/admin/playtomic/maps", handler: (req) => createMap(req, ctx) },
    { method: "POST", pattern: "/api/admin/playtomic/maps/:id/delete", handler: (req) => removeMap(req, ctx) },
    { method: "POST", pattern: "/api/admin/playtomic/sync", handler: (req) => sync(req, ctx) },
    { method: "GET", pattern: "/api/admin/playtomic/conflicts", handler: (req) => conflicts(req, ctx) },
    { method: "POST", pattern: "/api/admin/playtomic/conflicts/:id/resolve", handler: (req) => resolve(req, ctx) },
    { method: "GET", pattern: "/api/staff/playtomic/today", handler: (req) => today(req, ctx) },
  ];
}

function calendar(req: HttpReq, ctx: AppDeps): Promise<void> {
  const from = optionalIso(req.url.searchParams.get("from"));
  const to = optionalIso(req.url.searchParams.get("to"));
  sendJson(req.res, 200, { blocks: listCalendar(ctx.db, from, to) });
  return Promise.resolve();
}

function maps(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendJson(req.res, 200, { maps: listCourtMaps(ctx.db) });
  return Promise.resolve();
}

function createMap(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const created = mapPlaytomicCourt(
    ctx.db,
    requiredString(body, "courtId", 80),
    requiredString(body, "resourceId", 80),
  );
  sendJson(req.res, 201, created);
  return Promise.resolve();
}

function removeMap(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  deleteCourtMap(ctx.db, req.params.id ?? "");
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

async function sync(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  if (!ctx.playtomic || !ctx.config.playtomic) throw new AppError(404, "Playtomic is not configured");
  const report = await syncPlaytomic(ctx.db, ctx.config, ctx.playtomic, ctx.now());
  sendJson(req.res, 200, { report });
}

function conflicts(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  sendJson(req.res, 200, { conflicts: listOpenConflicts(ctx.db) });
  return Promise.resolve();
}

function resolve(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  resolveConflict(ctx.db, req.params.id ?? "", ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function today(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  sendJson(req.res, 200, { bookings: staffBookingsToday(ctx.db, ctx.config, ctx.now()) });
  return Promise.resolve();
}
