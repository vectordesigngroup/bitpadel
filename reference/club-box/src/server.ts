import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type Database from "better-sqlite3";
import type { AppConfig } from "./config.js";
import type { DoorController } from "./doors/types.js";
import { createAppServer } from "./http.js";
import type { PaymentBackend } from "./payments/types.js";
import { PlaytomicClient } from "./playtomic/client.js";
import { RateLimiter } from "./rate-limit.js";
import { buildRoutes } from "./routes.js";

export function createClubServer(options: {
  config: AppConfig;
  db: Database.Database;
  payments: PaymentBackend;
  door: DoorController;
  now?: () => Date;
  publicDir?: string;
  playtomic?: PlaytomicClient | null;
}): Server {
  const now = options.now ?? (() => new Date());
  const windowMs = options.config.rateLimitWindowSeconds * 1000;
  const playtomic =
    options.playtomic === undefined
      ? options.config.playtomic
        ? new PlaytomicClient(options.config.playtomic, now)
        : null
      : options.playtomic;
  const routes = buildRoutes({
    config: options.config,
    db: options.db,
    payments: options.payments,
    door: options.door,
    playtomic,
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
  });
}
