import type { IncomingHttpHeaders } from "node:http";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { safeEqual } from "../security.js";
import type { Permission, StaffRole } from "./permissions.js";
import { actorCan, findSession } from "./service.js";

export type RequestCredentials = {
  headers: IncomingHttpHeaders;
};

export type Actor =
  | { kind: "legacy-admin" }
  | { kind: "legacy-staff" }
  | { kind: "account"; accountId: string; username: string; displayName: string; role: StaffRole };

type GateDb = Database.Database;

export function resolveActor(
  req: RequestCredentials,
  config: AppConfig,
  db: GateDb,
  now: Date,
): Actor | null {
  const bearer = bearerToken(req);
  if (bearer) return actorForToken(bearer, config, db, now);
  const cookie = cookieValue(req, "club_session");
  if (!cookie) return null;
  return actorForToken(cookie, config, db, now);
}

export function actorAllows(actor: Actor | null, permission: Permission): boolean {
  if (!actor) return false;
  return actorCan(actor, permission);
}

export function presentedCredential(req: RequestCredentials): string {
  return bearerToken(req) || cookieValue(req, "club_session");
}

function actorForToken(token: string, config: AppConfig, db: GateDb, now: Date): Actor | null {
  if (safeEqual(token, config.adminToken)) return { kind: "legacy-admin" };
  if (config.staffToken && safeEqual(token, config.staffToken)) return { kind: "legacy-staff" };
  const session = findSession(db, token, now);
  if (!session) return null;
  return {
    kind: "account",
    accountId: session.accountId,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
  };
}

function bearerToken(req: RequestCredentials): string {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

function cookieValue(req: RequestCredentials, name: string): string {
  const raw = req.headers.cookie;
  if (typeof raw !== "string") return "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}
