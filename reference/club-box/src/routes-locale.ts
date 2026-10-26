// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { AppDeps } from "./deps.js";
import { AppError } from "./errors.js";
import { readJson, sendJson, type HttpReq, type Route } from "./http.js";
import { localeCookie } from "./i18n/cookie.js";
import { clubLocale, savePlayerLocale } from "./i18n/preference.js";
import { localeFromRequest } from "./i18n/request.js";
import { canonicalizeLocale, localeChoices, type LocaleId } from "./i18n/locales.js";
import { playerFromRequest } from "./player/service.js";
import { asObject } from "./validate.js";

export function localeRoutes(ctx: AppDeps): Route[] {
  return [
    { method: "GET", pattern: "/api/locale", handler: (req) => readLocale(req, ctx) },
    { method: "POST", pattern: "/api/locale", handler: (req) => chooseLocale(req, ctx) },
  ];
}

function readLocale(req: HttpReq, ctx: AppDeps): Promise<void> {
  const choice = localeFromRequest(ctx.db, req.headers, req.url, ctx.now());
  sendJson(req.res, 200, {
    locale: choice.locale,
    source: choice.source,
    clubDefault: clubLocale(ctx.db),
    timeZone: ctx.config.clubTimeZone,
    locales: localeChoices(),
  });
  return Promise.resolve();
}

function chooseLocale(req: HttpReq, ctx: AppDeps): Promise<void> {
  const body = asObject(readJson(req));
  const locale = postedLocale(body.locale);
  const player = playerFromRequest(ctx.db, req.headers, ctx.now());
  if (player) savePlayerLocale(ctx.db, player.id, locale);
  sendJson(
    req.res,
    200,
    { locale, savedOnProfile: Boolean(player) },
    { "set-cookie": localeCookie(locale, ctx.config.publicBaseUrl.startsWith("https://")) },
  );
  return Promise.resolve();
}

function postedLocale(value: unknown): LocaleId {
  if (typeof value !== "string") throw new AppError(400, "locale is not a supported language");
  const locale = canonicalizeLocale(value);
  if (!locale) throw new AppError(400, "locale is not a supported language");
  return locale;
}
