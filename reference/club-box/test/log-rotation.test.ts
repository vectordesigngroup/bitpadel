import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { configureLog, log } from "../src/log.js";

test("log files rotate once they pass the size limit", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "club-logs-"));
  const filePath = path.join(dir, "club.log");
  try {
    configureLog({ filePath, maxBytes: 180, keep: 2 });
    log("info", "first-marker", { n: 1 });
    log("info", "second-marker-that-is-long-enough-to-rotate-the-file", { n: 2 });
    log("info", "third-marker-that-is-also-long-enough", { n: 3 });
    const names = readdirSync(dir);
    assert.ok(names.includes("club.log.1"));
    const combined = names
      .map((name) => readFileSync(path.join(dir, name), "utf8"))
      .join("\n");
    assert.match(combined, /first-marker|second-marker|third-marker/);
  } finally {
    configureLog({ filePath: null, maxBytes: 180, keep: 2 });
    rmSync(dir, { recursive: true, force: true });
  }
});
