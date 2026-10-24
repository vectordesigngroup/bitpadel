import path from "node:path";
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";

type LogFields = Record<string, string | number | boolean | null>;
type Sink = (level: "info" | "error", line: string) => void;

let sinks: Sink[] = [consoleSink];

export function configureLog(options: { filePath: string | null; maxBytes: number; keep: number }): void {
  sinks = [consoleSink];
  if (options.filePath) {
    mkdirSync(path.dirname(options.filePath), { recursive: true });
    sinks.push(fileSink(options.filePath, options.maxBytes, options.keep));
  }
}

export function log(level: "info" | "error", msg: string, fields?: LogFields): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  for (const sink of sinks) sink(level, line);
}

function consoleSink(level: "info" | "error", line: string): void {
  if (level === "error") console.error(line);
  else console.log(line);
}

function fileSink(filePath: string, maxBytes: number, keep: number): Sink {
  return (_level, line) => {
    try {
      rotateIfNeeded(filePath, maxBytes, keep, line.length + 1);
      appendFileSync(filePath, `${line}\n`);
    } catch (error) {
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          level: "error",
          msg: "log file write failed",
          error: error instanceof Error ? error.message : "error",
        }),
      );
    }
  };
}

function rotateIfNeeded(filePath: string, maxBytes: number, keep: number, incoming: number): void {
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    return;
  }
  if (size + incoming < maxBytes) return;
  const oldest = `${filePath}.${keep}`;
  try {
    unlinkSync(oldest);
  } catch {
    /* The oldest file may not exist yet. */
  }
  for (let index = keep - 1; index >= 1; index -= 1) {
    const from = `${filePath}.${index}`;
    const to = `${filePath}.${index + 1}`;
    try {
      renameSync(from, to);
    } catch {
      /* A gap in the rotation is fine. */
    }
  }
  try {
    renameSync(filePath, `${filePath}.1`);
  } catch {
    /* Another process may have rotated it. */
  }
}
