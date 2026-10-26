// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { releaseExpired } from "./booking/service.js";
import { expireDueTabSettlements } from "./ledger/service.js";
import { expireStaleCheckins } from "./checkin/service.js";
import { loadConfig } from "./config.js";
import { openDatabase, purgeOldRows } from "./db.js";
import { openDoorController } from "./doors/index.js";
import { listen } from "./http.js";
import { configureLog, log } from "./log.js";
import { createNotifier } from "./notify/index.js";
import { notifyAdminAlert } from "./notify/service.js";
import { createPaymentBackend } from "./payments/index.js";
import { PlaytomicClient } from "./playtomic/client.js";
import { syncPlaytomic } from "./playtomic/sync.js";
import { createClubServer } from "./server.js";
import { bootstrapStaff } from "./staff/service.js";
import { runDueReminders } from "./player/reminders.js";
import { maybeSendDailySummary } from "./reports/daily.js";
import { createStorage } from "./storage/index.js";

try {
  const config = loadConfig(process.env);
  configureLog({
    filePath: config.logFile,
    maxBytes: config.logFileMaxBytes,
    keep: config.logFileKeep,
  });
  const db = openDatabase(config.databasePath);
  bootstrapStaff(db, config.staffBootstrap, new Date());
  const payments = createPaymentBackend(config);
  const door = await openDoorController(config);
  const notifier = createNotifier(config);
  const storage = createStorage(config);
  const now = (): Date => new Date();
  releaseExpired(db, now());
  expireDueTabSettlements(db, now());
  expireStaleCheckins(db, config, now());
  purgeOldRows(db, config.logRetentionDays, now(), config.visitRetentionDays);
  const playtomic = config.playtomic ? new PlaytomicClient(config.playtomic, now) : null;
  const server = createClubServer({ config, db, payments, door, now, playtomic, notifier, storage });
  await listen(server, config.port, config.host);
  log("info", "listening", {
    host: config.host,
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    paymentBackend: config.paymentBackend,
    doorBackend: config.doorBackend,
    emailProvider: config.emailProvider,
    smsProvider: config.smsProvider,
    storageBackend: config.storageBackend,
    playtomic: Boolean(config.playtomic),
    controlsEgress: false,
    controlsLifeSafety: false,
  });

  const holdSweep = setInterval(() => {
    try {
      releaseExpired(db, now());
      expireDueTabSettlements(db, now());
      expireStaleCheckins(db, config, now());
    } catch (error) {
      log("error", "hold sweep failed", { error: error instanceof Error ? error.message : "error" });
    }
  }, 15_000);
  holdSweep.unref();

  const retentionSweep = setInterval(() => {
    try {
      purgeOldRows(db, config.logRetentionDays, now(), config.visitRetentionDays);
      runDueReminders(db, notifier, config, now()).catch((error: unknown) => {
        log("error", "reminders failed", { error: error instanceof Error ? error.message : "error" });
      });
      maybeSendDailySummary(db, notifier, config, now()).catch((error: unknown) => {
        log("error", "daily summary failed", { error: error instanceof Error ? error.message : "error" });
      });
    } catch (error) {
      log("error", "retention sweep failed", { error: error instanceof Error ? error.message : "error" });
    }
  }, 60 * 60 * 1000);
  retentionSweep.unref();

  if (playtomic && config.playtomic && config.playtomic.syncMinutes > 0) {
    const runSync = (): void => {
      syncPlaytomic(db, config, playtomic, now()).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "error";
        log("error", "playtomic sync failed", { error: message });
        notifyAdminAlert(notifier, config, `Playtomic sync failed: ${message}`, db).catch((alertError: unknown) => {
          log("error", "admin alert failed", {
            error: alertError instanceof Error ? alertError.message : "error",
          });
        });
      });
    };
    const syncTimer = setInterval(runSync, config.playtomic.syncMinutes * 60_000);
    syncTimer.unref();
    runSync();
  }

  const shutdown = (): void => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : "startup failed");
  process.exit(1);
}
