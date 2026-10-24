import type Database from "better-sqlite3";
import type { AppConfig } from "./config.js";
import type { DoorController } from "./doors/types.js";
import type { PaymentBackend } from "./payments/types.js";
import type { PlaytomicClient } from "./playtomic/client.js";
import type { Notifier } from "./notify/types.js";
import type { ObjectStorage } from "./storage/types.js";
import type { RateLimiter } from "./rate-limit.js";

export type AppDeps = {
  config: AppConfig;
  db: Database.Database;
  payments: PaymentBackend;
  door: DoorController;
  playtomic: PlaytomicClient | null;
  notifier: Notifier;
  storage: ObjectStorage;
  now: () => Date;
  limiters: {
    holds: RateLimiter;
    challenges: RateLimiter;
    callbacks: RateLimiter;
  };
};
