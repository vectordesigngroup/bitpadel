// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { IncomingHttpHeaders } from "node:http";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { many } from "../db.js";
import { newId } from "../ids.js";
import { resolveActor, type Actor } from "./gate.js";

export type StaffActionView = {
  id: string;
  at: string;
  actorKind: string;
  actorLabel: string;
  method: string;
  path: string;
  status: number;
};

/** Plain label stored on a ledger line. It is not a secret. */
export function describeActor(actor: Actor | null): string {
  if (!actor) return "unknown";
  switch (actor.kind) {
    case "legacy-admin":
      return "admin-token";
    case "legacy-staff":
      return "staff-token";
    case "account":
      return `${actor.displayName} (${actor.username})`;
    default: {
      const unknown: never = actor;
      return String(unknown);
    }
  }
}

function actorKindOf(actor: Actor | null): string {
  if (!actor) return "unknown";
  switch (actor.kind) {
    case "legacy-admin":
      return "legacy-admin";
    case "legacy-staff":
      return "legacy-staff";
    case "account":
      return actor.role;
    default: {
      const unknown: never = actor;
      return String(unknown);
    }
  }
}

export function recordStaffAction(
  db: Database.Database,
  config: AppConfig,
  input: { method: string; path: string; status: number; headers: IncomingHttpHeaders; now: Date },
): void {
  if (input.method === "GET" || input.method === "HEAD") return;
  if (!input.path.startsWith("/api/admin")) return;
  const actor = resolveActor({ headers: input.headers }, config, db, input.now);
  const actorKind = actorKindOf(actor);
  const actorLabel = describeActor(actor);
  db.prepare(
    `INSERT INTO staff_actions (id, at, actor_kind, actor_label, method, path, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId("act"), input.now.toISOString(), actorKind, actorLabel, input.method, input.path.slice(0, 200), input.status);
}

export function listStaffActions(db: Database.Database, limit: number): StaffActionView[] {
  const rows = many<{
    id: string;
    at: string;
    actor_kind: string;
    actor_label: string;
    method: string;
    path: string;
    status: number;
  }>(
    db,
    `SELECT id, at, actor_kind, actor_label, method, path, status
     FROM staff_actions ORDER BY at DESC, rowid DESC LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actorKind: row.actor_kind,
    actorLabel: row.actor_label,
    method: row.method,
    path: row.path,
    status: row.status,
  }));
}

export function staffActionsCsv(rows: StaffActionView[]): string {
  const lines = ["at,actor_kind,actor_label,method,path,status"];
  for (const row of rows) {
    lines.push(
      [row.at, row.actorKind, row.actorLabel, row.method, row.path, String(row.status)]
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
