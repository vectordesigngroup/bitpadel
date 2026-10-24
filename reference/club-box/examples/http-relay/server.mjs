/**
 * Example entry relay.
 *
 * It accepts one command, `pulse-entry`, and nothing else. Wire a real board
 * only to an entry strike, with request-to-exit and fire release on circuits
 * this process cannot reach. Do not publish this port on a public network.
 *
 * This file does not toggle GPIO. It shows the HTTP contract and refuses
 * lock, hold, egress, and life-safety commands.
 */
import { createServer } from "node:http";

const token = process.env.RELAY_TOKEN ?? "";
if (token.length < 16) {
  console.error("Set RELAY_TOKEN to a long random string (openssl rand -hex 24).");
  process.exit(1);
}

const host = process.env.RELAY_HOST ?? "127.0.0.1";
const port = Number(process.env.RELAY_PORT ?? 8787);
let pulses = 0;

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/pulse") {
    send(res, 404, { ok: false, error: "Not found" });
    return;
  }
  const header = req.headers.authorization ?? "";
  if (header !== `Bearer ${token}`) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 4096) {
      send(res, 413, { ok: false, error: "Body too large" });
      return;
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    send(res, 400, { ok: false, error: "Invalid JSON" });
    return;
  }
  if (!body || body.command !== "pulse-entry") {
    const command = typeof body?.command === "string" ? body.command.slice(0, 40) : "";
    console.log(JSON.stringify({ msg: "rejected", command }));
    send(res, 400, {
      ok: false,
      error:
        "This relay only accepts pulse-entry. It cannot lock, hold, release a fire circuit, or control egress.",
    });
    return;
  }
  if (!isArea(body.area) || !isPulse(body.pulseMs) || !isRequestId(body.requestId)) {
    send(res, 400, { ok: false, error: "Invalid pulse" });
    return;
  }
  pulses += 1;
  console.log(
    JSON.stringify({
      msg: "pulse-entry",
      area: body.area,
      pulseMs: body.pulseMs,
      requestId: body.requestId,
      pulses,
    }),
  );
  send(res, 200, { ok: true, command: "pulse-entry", pulses });
});

server.listen(port, host, () => {
  const address = server.address();
  const actual = address && typeof address === "object" ? address.port : port;
  console.log(JSON.stringify({ ready: true, host, port: actual }));
});

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function isArea(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(value);
}

function isPulse(value) {
  return Number.isInteger(value) && value >= 200 && value <= 10_000;
}

function isRequestId(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 80;
}
