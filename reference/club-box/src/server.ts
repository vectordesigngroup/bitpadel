// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type Database from "better-sqlite3";
import { injectBrandHtml } from "./brand/html.js";
import { loadClubBrand, toPublicBrand } from "./brand/store.js";
import type { AppConfig } from "./config.js";
import type { DoorController } from "./doors/types.js";
import { createAppServer } from "./http.js";
import type { PaymentBackend } from "./payments/types.js";
import { createCardSet } from "./payments/cards/index.js";
import { createNotifier } from "./notify/index.js";
import type { Notifier } from "./notify/types.js";
import { PlaytomicClient } from "./playtomic/client.js";
import { RateLimiter } from "./rate-limit.js";
import { buildRoutes } from "./routes.js";
import { recordStaffAction } from "./staff/audit.js";
import { createStorage } from "./storage/index.js";
import type { ObjectStorage } from "./storage/types.js";

export function createClubServer(options: {
  config: AppConfig;
  db: Database.Database;
  payments: PaymentBackend;
  door: DoorController;
  now?: () => Date;
  publicDir?: string;
  playtomic?: PlaytomicClient | null;
  notifier?: Notifier;
  storage?: ObjectStorage;
}): Server {
  const now = options.now ?? (() => new Date());
  const windowMs = options.config.rateLimitWindowSeconds * 1000;
  const playtomic =
    options.playtomic === undefined
      ? options.config.playtomic
        ? new PlaytomicClient(options.config.playtomic, now)
        : null
      : options.playtomic;
  const notifier = options.notifier ?? createNotifier(options.config);
  const storage = options.storage ?? createStorage(options.config);
  const cards = createCardSet(options.config);
  const routes = buildRoutes({
    config: options.config,
    db: options.db,
    payments: options.payments,
    cards,
    door: options.door,
    playtomic,
    notifier,
    storage,
    now,
    limiters: {
      holds: new RateLimiter(windowMs, options.config.rateLimitMax),
      challenges: new RateLimiter(windowMs, options.config.challengeRateLimitMax),
      callbacks: new RateLimiter(windowMs, options.config.rateLimitMax),
    },
  });
  const publicDir =
    options.publicDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  return createAppServer({
    trustProxy: options.config.trustProxy,
    routes,
    publicDir,
    transformHtml: (_pathname, html) => {
      try {
        return injectBrandHtml(html, toPublicBrand(loadClubBrand(options.db)));
      } catch {
        return html;
      }
    },
    onComplete: (info) => {
      recordStaffAction(options.db, options.config, { ...info, now: now() });
    },
  });
}
