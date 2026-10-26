// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppError, LnurlError, PaymentError } from "./errors.js";
import { log } from "./log.js";
import { actorAllows, presentedCredential, resolveActor } from "./staff/gate.js";
import type { AppDeps } from "./deps.js";

const CSP =
  "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const BODY_LIMIT = 2 * 1024 * 1024;

const STATIC_FILES: Record<string, string> = {
  "/": "booking.html",
  "/booking": "booking.html",
  "/admin": "admin.html",
  "/kiosk": "kiosk.html",
  "/enroll": "enroll.html",
  "/styles.css": "styles.css",
  "/booking.js": "booking.js",
  "/booking.css": "booking.css",
  "/booking-schedule.js": "booking-schedule.js",
  "/admin.js": "admin.js",
  "/kiosk.js": "kiosk.js",
  "/enroll.js": "enroll.js",
  "/desk": "desk.html",
  "/desk.js": "desk.js",
  "/guest": "guest.html",
  "/guest.js": "guest.js",
  "/privacy": "privacy.html",
  "/privacy.js": "privacy.js",
  "/account": "account.html",
  "/account.js": "account.js",
  "/brand.js": "brand.js",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export type HttpReq = {
  method: string;
  url: URL;
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  ip: string;
  params: Record<string, string>;
  res: ServerResponse;
};

export type Route = {
  method: string;
  pattern: string;
  handler: (req: HttpReq) => Promise<void>;
};

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): void {
  sendBytes(res, status, Buffer.from(JSON.stringify(body)), "application/json; charset=utf-8", extra);
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  extra?: Record<string, string>,
): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": CSP,
    "x-frame-options": "DENY",
    ...extra,
  });
  res.end(body);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  extra?: Record<string, string>,
): void {
  if (res.headersSent) return;
  const payload = Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": payload.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": CSP,
    "x-frame-options": "DENY",
    ...extra,
  });
  res.end(payload);
}

export function readJson(req: HttpReq): unknown {
  if (req.rawBody.length === 0) throw new AppError(400, "Expected a JSON body");
  try {
    return JSON.parse(req.rawBody.toString("utf8")) as unknown;
  } catch {
    throw new AppError(400, "Invalid JSON");
  }
}

export function requireAdmin(req: HttpReq, ctx: AppDeps): void {
  const actor = resolveActor(req, ctx.config, ctx.db, ctx.now());
  if (!actorAllows(actor, "admin")) throw new AppError(401, "Admin token required");
}

export function requireStaff(req: HttpReq, ctx: AppDeps): void {
  const actor = resolveActor(req, ctx.config, ctx.db, ctx.now());
  if (!actorAllows(actor, "desk")) throw new AppError(401, "Staff token required");
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `club_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function credentialToken(req: HttpReq): string {
  return presentedCredential(req);
}

export function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function createAppServer(options: {
  trustProxy: boolean;
  routes: Route[];
  publicDir: string;
  transformHtml?: (pathname: string, html: string) => string;
  onComplete?: (info: { method: string; path: string; status: number; headers: IncomingHttpHeaders }) => void;
}): Server {
  const publicRoot = path.resolve(options.publicDir);
  return createServer((incoming, res) => {
    void handleRequest(
      incoming,
      res,
      options.routes,
      options.trustProxy,
      publicRoot,
      options.onComplete,
      options.transformHtml,
    );
  });
}

async function handleRequest(
  incoming: IncomingMessage,
  res: ServerResponse,
  routes: Route[],
  trustProxy: boolean,
  publicRoot: string,
  onComplete?: (info: { method: string; path: string; status: number; headers: IncomingHttpHeaders }) => void,
  transformHtml?: (pathname: string, html: string) => string,
): Promise<void> {
  try {
    const method = incoming.method ?? "GET";
    const host = incoming.headers.host ?? "localhost";
    const url = new URL(incoming.url ?? "/", `http://${host}`);
    const rawBody = await readBody(incoming);
    const matches = routes
      .map((route) => ({ route, params: matchPattern(route.pattern, url.pathname) }))
      .filter((item): item is { route: Route; params: Record<string, string> } => item.params !== null);
    const found = matches.find((item) => item.route.method === method);
    if (!found) {
      if (matches.length > 0) {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      const file = staticFile(url.pathname, publicRoot);
      if (!file) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      const body = await readFile(file.path);
      if (method === "HEAD") {
        sendBytes(res, 200, Buffer.alloc(0), file.contentType);
        return;
      }
      if (transformHtml && file.contentType.startsWith("text/html")) {
        sendText(res, 200, transformHtml(url.pathname, body.toString("utf8")), file.contentType);
        return;
      }
      sendBytes(res, 200, body, file.contentType);
      return;
    }
    await found.route.handler({
      method,
      url,
      headers: incoming.headers,
      rawBody,
      ip: clientIp(incoming, trustProxy),
      params: found.params,
      res,
    });
    onComplete?.({ method, path: url.pathname, status: res.statusCode, headers: incoming.headers });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof LnurlError) {
      sendJson(res, 200, { status: "ERROR", reason: error.message });
      return;
    }
    if (error instanceof AppError) {
      sendJson(res, error.status, { error: error.message });
      onComplete?.({
        method: incoming.method ?? "GET",
        path: new URL(incoming.url ?? "/", "http://localhost").pathname,
        status: error.status,
        headers: incoming.headers,
      });
      return;
    }
    if (error instanceof PaymentError) {
      sendJson(res, 502, { error: error.message });
      return;
    }
    log("error", "request failed", { error: error instanceof Error ? error.message : "error" });
    sendJson(res, 500, { error: "Internal error" });
  }
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const expected = pattern.split("/").filter((part) => part.length > 0);
  const actual = pathname.split("/").filter((part) => part.length > 0);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const token = expected[index];
    const value = actual[index];
    if (token === undefined || value === undefined) return null;
    if (token.startsWith(":")) {
      try {
        params[token.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (token !== value) {
      return null;
    }
  }
  return params;
}

function staticFile(pathname: string, publicRoot: string): { path: string; contentType: string } | null {
  const name = STATIC_FILES[pathname];
  if (!name) return null;
  const full = path.resolve(publicRoot, name);
  if (full !== publicRoot && !full.startsWith(`${publicRoot}${path.sep}`)) return null;
  const extension = path.extname(name);
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return null;
  return { path: full, contentType };
}

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of incoming) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > BODY_LIMIT) throw new AppError(413, "Body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function clientIp(incoming: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = incoming.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = raw?.split(",")[0]?.trim();
    if (first) return first.slice(0, 80);
  }
  return incoming.socket.remoteAddress ?? "unknown";
}
