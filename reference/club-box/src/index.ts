import { releaseExpired } from "./booking/service.js";
import { loadConfig } from "./config.js";
import { openDatabase, purgeOldRows } from "./db.js";
import { createDoorController } from "./doors/index.js";
import { log } from "./log.js";
import { createPaymentBackend } from "./payments/index.js";
import { createClubServer } from "./server.js";
import { listen } from "./http.js";

try {
  const config = loadConfig(process.env);
  const db = openDatabase(config.databasePath);
  const payments = createPaymentBackend(config);
  const door = createDoorController(config);
  const now = (): Date => new Date();
  releaseExpired(db, now());
  purgeOldRows(db, config.logRetentionDays, now());
  const server = createClubServer({ config, db, payments, door, now });
  await listen(server, config.port, config.host);
  log("info", "listening", {
    host: config.host,
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    paymentBackend: config.paymentBackend,
    doorBackend: config.doorBackend,
    controlsEgress: false,
    controlsLifeSafety: false,
  });

  const holdSweep = setInterval(() => {
    try {
      releaseExpired(db, now());
    } catch (error) {
      log("error", "hold sweep failed", { error: error instanceof Error ? error.message : "error" });
    }
  }, 15_000);
  holdSweep.unref();

  const retentionSweep = setInterval(() => {
    try {
      purgeOldRows(db, config.logRetentionDays, now());
    } catch (error) {
      log("error", "retention sweep failed", { error: error instanceof Error ? error.message : "error" });
    }
  }, 60 * 60 * 1000);
  retentionSweep.unref();

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
