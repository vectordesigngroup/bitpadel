// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { AccessDeps } from "./access/service.js";
import {
  addHouseholdMember,
  addNamedGuest,
  createHousehold,
  deleteByPrivacyToken,
  deleteGuest,
  marketingCsv,
  memberIdForCheckin,
  onSiteNow,
  readCheckinByToken,
  readPhotoFile,
  saveMemberPhoto,
  setGuestCount,
  unsubscribeByContact,
  unsubscribeContact,
  updateMemberProfile,
  checkout,
} from "./checkin/service.js";
import type { AppDeps } from "./deps.js";
import { one } from "./db.js";
import { AppError } from "./errors.js";
import { readJson, requireAdmin, requireStaff, sendBytes, sendJson, sendText, type HttpReq, type Route } from "./http.js";
import { log } from "./log.js";
import { issueCard, presentCard, setCardStatus } from "./nfc/entry.js";
import type { CardPresentation } from "./nfc/reader.js";
import { sendHouseholdNotice, sendPrivacyLink } from "./notify/service.js";
import { asObject, assertAreaId, requiredInt, requiredString } from "./validate.js";

export function accessRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "GET", pattern: "/api/access/tap", handler: (req) => tap(req, ctx) },
    { method: "POST", pattern: "/api/access/nfc/reader", handler: (req) => readerTap(req, ctx) },
    { method: "POST", pattern: "/api/access/nfc/uid", handler: (req) => uidTap(req, ctx) },
    { method: "POST", pattern: "/api/access/nfc/desfire", handler: (req) => desfireTap(req, ctx) },
    { method: "GET", pattern: "/api/checkins/:id", handler: (req) => readCheckin(req, ctx) },
    { method: "POST", pattern: "/api/checkins/:id/guest-count", handler: (req) => guestCount(req, ctx) },
    { method: "POST", pattern: "/api/checkins/:id/guests", handler: (req) => namedGuest(req, ctx) },
    { method: "POST", pattern: "/api/checkins/:id/guests/:guestId/delete", handler: (req) => removeGuest(req, ctx) },
    { method: "GET", pattern: "/api/checkins/:id/photo", handler: (req) => checkinPhoto(req, ctx) },
    { method: "POST", pattern: "/api/admin/members/:id/profile", handler: (req) => profile(req, ctx) },
    { method: "POST", pattern: "/api/admin/members/:id/photo", handler: (req) => photo(req, ctx) },
    { method: "POST", pattern: "/api/admin/members/:id/cards", handler: (req) => enrollCard(req, ctx) },
    { method: "POST", pattern: "/api/admin/cards/:id/revoke", handler: (req) => cardStatus(req, ctx, "revoked") },
    { method: "POST", pattern: "/api/admin/cards/:id/lost", handler: (req) => cardStatus(req, ctx, "lost") },
    { method: "POST", pattern: "/api/admin/households", handler: (req) => household(req, ctx) },
    { method: "POST", pattern: "/api/admin/households/:id/members", handler: (req) => householdMember(req, ctx) },
    { method: "GET", pattern: "/api/admin/marketing.csv", handler: (req) => marketingExport(req, ctx) },
    { method: "POST", pattern: "/api/admin/marketing/unsubscribe", handler: (req) => adminUnsubscribe(req, ctx) },
    { method: "GET", pattern: "/api/staff/onsite", handler: (req) => onsite(req, ctx) },
    { method: "POST", pattern: "/api/staff/checkins/:id/checkout", handler: (req) => staffCheckout(req, ctx) },
    { method: "GET", pattern: "/api/staff/members/:id/photo", handler: (req) => staffPhoto(req, ctx) },
    { method: "POST", pattern: "/api/privacy/unsubscribe", handler: (req) => privacyUnsubscribe(req, ctx) },
    { method: "POST", pattern: "/api/privacy/delete", handler: (req) => privacyDelete(req, ctx) },
  ];
}

async function tap(req: HttpReq, ctx: AppDeps): Promise<void> {
  const area = req.url.searchParams.get("area") ?? "";
  assertAreaId(area, ctx.config.areas);
  const picc = req.url.searchParams.get("e") ?? req.url.searchParams.get("picc_data") ?? "";
  const cmac = req.url.searchParams.get("c") ?? req.url.searchParams.get("cmac") ?? "";
  const result = await presentCard(accessDeps(ctx), { kind: "sun", piccDataHex: picc, cmacHex: cmac, area }, req.ip);
  if (wantsHtml(req)) {
    sendText(req.res, 200, tapPage(result.displayName, result.checkinId, result.token), "text/html; charset=utf-8");
    return;
  }
  sendJson(req.res, 200, { checkin: result });
}

async function readerTap(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  const presentation = presentationFrom(body, ctx.config.areas);
  const result = await presentCard(accessDeps(ctx), presentation, req.ip);
  sendJson(req.res, 200, { checkin: result });
}

async function uidTap(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  const area = requiredString(body, "area", 40);
  assertAreaId(area, ctx.config.areas);
  const result = await presentCard(
    accessDeps(ctx),
    { kind: "uid-insecure", uidHex: requiredString(body, "uid", 32), area },
    req.ip,
  );
  sendJson(req.res, 200, { checkin: result });
}

async function desfireTap(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  const area = requiredString(body, "area", 40);
  assertAreaId(area, ctx.config.areas);
  const result = await presentCard(
    accessDeps(ctx),
    {
      kind: "desfire",
      uidHex: requiredString(body, "uid", 32),
      counter: requiredInt(body, "counter", 0, 0xffffff),
      cmacHex: requiredString(body, "cmac", 32),
      area,
    },
    req.ip,
  );
  sendJson(req.res, 200, { checkin: result });
}

function readCheckin(req: HttpReq, ctx: AppDeps): Promise<void> {
  const checkin = readCheckinByToken(ctx.db, ctx.config, req.params.id ?? "", tokenOf(req));
  sendJson(req.res, 200, { checkin: publicFields(checkin) });
  return Promise.resolve();
}

function guestCount(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  const checkin = setGuestCount(
    ctx.db,
    ctx.config,
    req.params.id ?? "",
    requiredString(body, "token", 80),
    requiredInt(body, "guestCount", 0, 50),
  );
  sendJson(req.res, 200, { checkin: publicFields(checkin) });
  return Promise.resolve();
}

async function namedGuest(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  const kind = requiredString(body, "contactKind", 16);
  if (kind !== "email" && kind !== "phone") throw new AppError(400, "contactKind must be email or phone");
  const marketing = body.marketingConsent === true;
  if (body.marketingConsent !== undefined && typeof body.marketingConsent !== "boolean") {
    throw new AppError(400, "marketingConsent must be boolean");
  }
  const contactValue = requiredString(body, "contactValue", 200);
  const created = addNamedGuest(ctx.db, ctx.config, req.params.id ?? "", requiredString(body, "token", 80), {
    displayName: requiredString(body, "displayName", 80),
    contactKind: kind,
    contactValue,
    waiverAccepted: body.waiverAccepted === true,
    marketingConsent: marketing,
    now: ctx.now(),
  });
  try {
    await sendPrivacyLink(
      ctx.notifier,
      ctx.config,
      {
        contactKind: kind,
        to: contactValue,
        privacyToken: created.privacyToken,
      },
      ctx.db,
    );
  } catch (error) {
    log("error", "privacy link failed", { error: error instanceof Error ? error.message : "error" });
  }
  sendJson(req.res, 201, { guestId: created.guestId, privacyToken: created.privacyToken });
}

function removeGuest(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  deleteGuest(ctx.db, req.params.id ?? "", req.params.guestId ?? "", requiredString(body, "token", 80), ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function checkinPhoto(req: HttpReq, ctx: AppDeps): Promise<void> {
  const memberId = memberIdForCheckin(ctx.db, req.params.id ?? "", tokenOf(req));
  return sendPhoto(req, ctx, memberId);
}

function profile(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const guestLimit = body.guestLimit;
  let limit: number | null | undefined;
  if (guestLimit === undefined) limit = undefined;
  else if (guestLimit === null) limit = null;
  else limit = requiredInt(body, "guestLimit", 0, 50);
  updateMemberProfile(ctx.db, ctx.config, req.params.id ?? "", {
    displayName: optionalClearable(body, "displayName", 80),
    phone: optionalClearable(body, "phone", 32),
    email: optionalClearable(body, "email", 200),
    membershipType: body.membershipType === undefined ? undefined : requiredString(body, "membershipType", 40),
    guestLimit: limit,
    playtomicPlayerId: optionalClearable(body, "playtomicPlayerId", 80),
  });
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

async function photo(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const encoded = requiredString(body, "data", 2_000_000);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) throw new AppError(400, "Photo data is empty");
  await saveMemberPhoto(
    ctx.db,
    ctx.config,
    ctx.storage,
    req.params.id ?? "",
    bytes,
    requiredString(body, "contentType", 40),
  );
  sendJson(req.res, 200, { ok: true });
}

function enrollCard(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const scheme = requiredString(body, "scheme", 32);
  if (scheme !== "ntag424-sun" && scheme !== "desfire" && scheme !== "uid-insecure") {
    throw new AppError(400, "Unknown card scheme");
  }
  if (scheme === "uid-insecure" && ctx.config.nfc.uidMode !== "insecure-dev") {
    throw new AppError(403, "UID-only cards are disabled");
  }
  const card = issueCard(ctx.db, req.params.id ?? "", {
    uid: requiredString(body, "uid", 32),
    scheme,
    label: typeof body.label === "string" ? body.label.trim().slice(0, 80) : "",
    now: ctx.now(),
  });
  sendJson(req.res, 201, { card });
  return Promise.resolve();
}

function cardStatus(req: HttpReq, ctx: AppDeps, status: "revoked" | "lost"): Promise<void> {
  requireAdmin(req, ctx);
  setCardStatus(ctx.db, req.params.id ?? "", status, ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

async function household(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const primaryMemberId = requiredString(body, "primaryMemberId", 80);
  const created = createHousehold(ctx.db, requiredString(body, "label", 80), primaryMemberId, ctx.now());
  try {
    await sendHouseholdNotice(
      ctx.db,
      ctx.notifier,
      primaryMemberId,
      "A household was created and this membership is the primary contact. This notice is transactional.",
      ctx.config.publicBaseUrl,
    );
  } catch (error) {
    log("error", "household notice failed", { error: error instanceof Error ? error.message : "error" });
  }
  sendJson(req.res, 201, created);
}

async function householdMember(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const role = requiredString(body, "role", 16);
  if (role !== "primary" && role !== "dependent") throw new AppError(400, "role must be primary or dependent");
  const householdId = req.params.id ?? "";
  addHouseholdMember(ctx.db, householdId, requiredString(body, "memberId", 80), role);
  const primary = one<{ primary_member_id: string }>(
    ctx.db,
    "SELECT primary_member_id FROM households WHERE id = ?",
    householdId,
  );
  if (primary) {
    try {
      await sendHouseholdNotice(
        ctx.db,
        ctx.notifier,
        primary.primary_member_id,
        "A household membership was updated. This notice is transactional.",
        ctx.config.publicBaseUrl,
      );
    } catch (error) {
      log("error", "household notice failed", { error: error instanceof Error ? error.message : "error" });
    }
  }
  sendJson(req.res, 200, { ok: true });
}

function marketingExport(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  sendText(req.res, 200, marketingCsv(ctx.db), "text/csv; charset=utf-8", {
    "content-disposition": "attachment; filename=\"marketing.csv\"",
  });
  return Promise.resolve();
}

function adminUnsubscribe(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireAdmin(req, ctx);
  const body = asObject(readJson(req));
  const kind = requiredString(body, "contactKind", 16);
  if (kind !== "email" && kind !== "phone") throw new AppError(400, "contactKind must be email or phone");
  unsubscribeByContact(ctx.db, kind, requiredString(body, "contactValue", 200), ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function onsite(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  sendJson(req.res, 200, onSiteNow(ctx.db, ctx.config, ctx.now()));
  return Promise.resolve();
}

function staffCheckout(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  checkout(ctx.db, req.params.id ?? "", ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function staffPhoto(req: HttpReq, ctx: AppDeps): Promise<void> {
  requireStaff(req, ctx);
  return sendPhoto(req, ctx, req.params.id ?? "");
}

function privacyUnsubscribe(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  unsubscribeContact(ctx.db, requiredString(body, "token", 80), ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

function privacyDelete(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  deleteByPrivacyToken(ctx.db, requiredString(body, "token", 80), ctx.now());
  sendJson(req.res, 200, { ok: true });
  return Promise.resolve();
}

async function sendPhoto(req: HttpReq, ctx: AppDeps, memberId: string): Promise<void> {
  const photoFile = await readPhotoFile(ctx.db, ctx.storage, memberId);
  if (!photoFile) throw new AppError(404, "Photo was not found");
  sendBytes(req.res, 200, photoFile.bytes, photoFile.contentType);
}

function presentationFrom(body: Record<string, unknown>, areas: readonly string[]): CardPresentation {
  const kind = requiredString(body, "kind", 32);
  const area = requiredString(body, "area", 40);
  assertAreaId(area, areas);
  if (kind !== "sun" && kind !== "desfire" && kind !== "uid-insecure") {
    throw new AppError(400, "Unknown card presentation");
  }
  switch (kind) {
    case "sun":
      return {
        kind: "sun",
        piccDataHex: requiredString(body, "piccDataHex", 64),
        cmacHex: requiredString(body, "cmacHex", 32),
        area,
      };
    case "desfire":
      return {
        kind: "desfire",
        uidHex: requiredString(body, "uidHex", 32),
        counter: requiredInt(body, "counter", 0, 0xffffff),
        cmacHex: requiredString(body, "cmacHex", 32),
        area,
      };
    case "uid-insecure":
      return { kind: "uid-insecure", uidHex: requiredString(body, "uidHex", 32), area };
    default: {
      const unknown: never = kind;
      throw new AppError(400, `Unknown card presentation ${String(unknown)}`);
    }
  }
}

function optionalClearable(obj: Record<string, unknown>, key: string, max: number): string | null | undefined {
  if (!(key in obj)) return undefined;
  const value = obj[key];
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new AppError(400, `${key} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max || /[\u0000-\u001f]/.test(trimmed)) throw new AppError(400, `${key} is invalid`);
  return trimmed;
}

function tokenOf(req: HttpReq): string {
  return req.url.searchParams.get("token") ?? "";
}

function wantsHtml(req: HttpReq): boolean {
  const accept = req.headers.accept;
  const value = Array.isArray(accept) ? accept.join(",") : (accept ?? "");
  return value.includes("text/html") && !value.includes("application/json");
}

function publicFields(checkin: { id: string; token: string; displayName: string; membershipType: string; guestCount: number; guestLimit: number; hasPhoto: boolean }) {
  return checkin;
}

function tapPage(name: string, checkinId: string, token: string): string {
  const safeName = escapeHtml(name);
  const href = `/guest?checkin=${encodeURIComponent(checkinId)}&token=${encodeURIComponent(token)}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Checked in</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>Checked in</h1><p>${safeName}</p><p><a href="${href}">Add guests</a></p><p class="safety">This service can pulse an entry lock only. Leaving does not use this page.</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function accessDeps(ctx: AppDeps): AccessDeps {
  return {
    config: ctx.config,
    db: ctx.db,
    door: ctx.door,
    now: ctx.now,
    callbacks: ctx.limiters.callbacks,
    notifier: ctx.notifier,
  };
}
