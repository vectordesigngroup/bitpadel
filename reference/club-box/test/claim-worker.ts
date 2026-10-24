import { parentPort, workerData } from "node:worker_threads";
import { claimOpenSlot, type ClaimInput } from "../src/booking/claim.js";
import { openDatabase } from "../src/db.js";

type WorkerData = {
  databasePath: string;
  claim: ClaimInput;
};

const data = workerData as WorkerData;
const db = openDatabase(data.databasePath);
try {
  parentPort?.postMessage(claimOpenSlot(db, data.claim));
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    reason: "error",
    message: error instanceof Error ? error.message : "error",
  });
} finally {
  db.close();
}
