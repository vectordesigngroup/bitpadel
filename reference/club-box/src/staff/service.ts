// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { one } from "../db.js";
import { AppError } from "../errors.js";
import { newId } from "../ids.js";
import { log } from "../log.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { isStaffRole, roleHas, type Permission, type StaffRole } from "./permissions.js";

export type StaffPublic = {
  id: string;
  username: string;
  displayName: string;
  role: StaffRole;
  disabledAt: string | null;
  createdAt: string;
};

export type StaffSessionView = {
  accountId: string;
  username: string;
  displayName: string;
  role: StaffRole;
};

const DUMMY_HASH = hashPassword("not-a-real-password");

export function bootstrapStaff(
  db: Database.Database,
  input: { username: string; password: string; displayName: string } | null,
  now: Date,
): void {
  if (!input) return;
  const existing = one<{ id: string }>(db, "SELECT id FROM staff_accounts WHERE username = ?", input.username);
  if (existing) return;
  insertAccount(db, {
    username: input.username,
    password: input.password,
    displayName: input.displayName,
    role: "owner",
    now,
  });
  log("info", "staff owner bootstrapped", { username: input.username });
}

export function listStaff(db: Database.Database): StaffPublic[] {
  const rows = db
    .prepare(
      `SELECT id, username, display_name, role, disabled_at, created_at
       FROM staff_accounts ORDER BY created_at ASC`,
    )
    .all() as Array<{
    id: string;
    username: string;
    display_name: string;
    role: string;
    disabled_at: string | null;
    created_at: string;
  }>;
  return rows.map((row) => {
    if (!isStaffRole(row.role)) throw new Error("staff role is invalid");
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      disabledAt: row.disabled_at,
      createdAt: row.created_at,
    };
  });
}

export function createStaffAccount(
  db: Database.Database,
  actor: { kind: "legacy-admin" } | { kind: "account"; role: StaffRole },
  input: { username: string; password: string; displayName: string; role: StaffRole; now: Date },
): StaffPublic {
  if (!canAssign(actor, input.role)) {
    throw new AppError(403, "That role cannot be assigned by this account");
  }
  assertPassword(input.password);
  assertUsername(input.username);
  const taken = one<{ id: string }>(db, "SELECT id FROM staff_accounts WHERE username = ?", input.username);
  if (taken) throw new AppError(409, "That username is already in use");
  return insertAccount(db, input);
}

export function disableStaffAccount(
  db: Database.Database,
  actor: { kind: "legacy-admin" } | { kind: "account"; role: StaffRole; accountId: string },
  accountId: string,
  now: Date,
): void {
  const row = one<{ id: string; role: string }>(db, "SELECT id, role FROM staff_accounts WHERE id = ?", accountId);
  if (!row || !isStaffRole(row.role)) throw new AppError(404, "Staff account was not found");
  if (actor.kind === "account" && actor.accountId === accountId) {
    throw new AppError(409, "An account cannot disable itself");
  }
  if (!canAssign(actor, row.role)) throw new AppError(403, "That role cannot be changed by this account");
  db.prepare("UPDATE staff_accounts SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL").run(
    now.toISOString(),
    accountId,
  );
  db.prepare("DELETE FROM staff_sessions WHERE account_id = ?").run(accountId);
}

export function loginStaff(
  db: Database.Database,
  username: string,
  password: string,
  now: Date,
  ttlHours: number,
): { token: string; role: StaffRole; displayName: string } | null {
  const row = one<{ id: string; password_hash: string; role: string; display_name: string; disabled_at: string | null }>(
    db,
    `SELECT id, password_hash, role, display_name, disabled_at FROM staff_accounts WHERE username = ?`,
    username,
  );
  const hash = row?.password_hash ?? DUMMY_HASH;
  const matches = verifyPassword(password, hash);
  if (!row || row.disabled_at || !matches || !isStaffRole(row.role)) return null;
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expires = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
  db.prepare(
    `INSERT INTO staff_sessions (id, account_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(newId("ses"), row.id, tokenHash, expires, now.toISOString());
  return { token, role: row.role, displayName: row.display_name };
}

export function findSession(db: Database.Database, token: string, now: Date): StaffSessionView | null {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = one<{ id: string; username: string; display_name: string; role: string }>(
    db,
    `SELECT a.id, a.username, a.display_name, a.role
     FROM staff_sessions s
     JOIN staff_accounts a ON a.id = s.account_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND a.disabled_at IS NULL`,
    hashToken(token),
    now.toISOString(),
  );
  if (!row || !isStaffRole(row.role)) return null;
  return { accountId: row.id, username: row.username, displayName: row.display_name, role: row.role };
}

export function deleteSession(db: Database.Database, token: string): void {
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").run(hashToken(token));
}

export function actorCan(
  actor: { kind: "legacy-admin" } | { kind: "legacy-staff" } | { kind: "account"; role: StaffRole },
  permission: Permission,
): boolean {
  switch (actor.kind) {
    case "legacy-admin":
      return true;
    case "legacy-staff":
      return permission === "desk";
    case "account":
      return roleHas(actor.role, permission);
    default: {
      const unknown: never = actor;
      throw new Error(`Unknown actor: ${String(unknown)}`);
    }
  }
}

function canAssign(
  actor: { kind: "legacy-admin" } | { kind: "account"; role: StaffRole },
  role: StaffRole,
): boolean {
  if (actor.kind === "legacy-admin") return true;
  if (!roleHas(actor.role, "staff.manage")) return false;
  if (role === "owner") return roleHas(actor.role, "staff.assign-owner");
  return true;
}

function insertAccount(
  db: Database.Database,
  input: { username: string; password: string; displayName: string; role: StaffRole; now: Date },
): StaffPublic {
  const id = newId("stf");
  db.prepare(
    `INSERT INTO staff_accounts (id, username, display_name, role, password_hash, disabled_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(id, input.username, input.displayName, input.role, hashPassword(input.password), input.now.toISOString());
  return {
    id,
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    disabledAt: null,
    createdAt: input.now.toISOString(),
  };
}

function assertUsername(username: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(username)) {
    throw new AppError(400, "Username must be 2-40 lowercase letters, numbers, dots, underscores, or hyphens");
  }
}

function assertPassword(password: string): void {
  if (password.length < 12 || password.length > 200) {
    throw new AppError(400, "Password must be 12-200 characters");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
