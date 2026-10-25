// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { HttpDoorController } from "../src/doors/http-relay.js";
import { adminHeaders, api, freshKey, signK1, startTestApp } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const relayPath = path.join(here, "..", "examples", "http-relay", "server.mjs");
const token = "relay-token-test-value";

test("HTTP door adapter sends pulse-entry and does not follow redirects", async () => {
  const relay = await startRelay();
  const redirect = await startRedirect();
  try {
    const door = new HttpDoorController({
      url: `http://127.0.0.1:${relay.port}/pulse`,
      token,
      timeoutMs: 2000,
    });
    const ok = await door.pulseEntry({ area: "lounge", requestId: "aud_test_request", pulseMs: 3000 });
    assert.deepEqual(ok, { ok: true });
    await waitFor(() => relay.output, /"msg":"pulse-entry"/);
    assert.equal(countPulses(relay.output), 1);

    const rejected = await fetch(`http://127.0.0.1:${relay.port}/pulse`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ command: "lock", area: "lounge" }),
    });
    assert.equal(rejected.status, 400);
    const fire = await fetch(`http://127.0.0.1:${relay.port}/pulse`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ command: "fire-release", area: "lounge" }),
    });
    assert.equal(fire.status, 400);
    await waitFor(() => relay.output, /"command":"fire-release"/);
    assert.equal(countPulses(relay.output), 1);
    assert.match(relay.output, /"command":"lock"/);

    const redirected = new HttpDoorController({
      url: `http://127.0.0.1:${redirect.port}/go`,
      token,
      timeoutMs: 1000,
    });
    const missed = await redirected.pulseEntry({ area: "lounge", requestId: "aud_redirect", pulseMs: 1000 });
    assert.deepEqual(missed, { ok: false, reason: "unreachable" });
  } finally {
    await relay.stop();
    await redirect.close();
  }
});

test("an enrolled member can pulse the example relay and only the entry command", async () => {
  const relay = await startRelay();
  const app = await startTestApp({
    DOOR_BACKEND: "http",
    DOOR_HTTP_URL: `http://127.0.0.1:${relay.port}/pulse`,
    DOOR_HTTP_TOKEN: token,
  });
  try {
    const signer = await freshKey();
    const member = await api(app.baseUrl, "/api/admin/members", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ label: "membership-number" }),
    });
    const memberId = (member.body.member as { id: string }).id;
    const enroll = await api(app.baseUrl, `/api/admin/members/${memberId}/enroll`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const enrollK1 = (enroll.body.challenge as { k1: string }).k1;
    const enrollSig = await signK1(signer.privateKey, enrollK1);
    const enrolled = await api(
      app.baseUrl,
      `/api/access/enroll/callback?k1=${enrollK1}&sig=${enrollSig}&key=${signer.pubkey}`,
    );
    assert.equal(enrolled.body.status, "OK");
    const challenge = await api(app.baseUrl, "/api/access/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area: "lounge" }),
    });
    const k1 = (challenge.body.challenge as { k1: string }).k1;
    const sig = await signK1(signer.privateKey, k1);
    const opened = await api(app.baseUrl, `/api/access/callback?k1=${k1}&sig=${sig}&key=${signer.pubkey}`);
    assert.equal(opened.body.status, "OK");
    assert.match(relay.output, /"msg":"pulse-entry"/);
    assert.match(relay.output, /"area":"lounge"/);
  } finally {
    await app.close();
    await relay.stop();
  }
});

async function waitFor(read: () => string, pattern: RegExp): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    if (pattern.test(read())) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${pattern}. output: ${read()}`);
}

function countPulses(output: string): number {
  return output.split('"msg":"pulse-entry"').length - 1;
}

function startRelay(): Promise<{ port: number; output: string; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, [relayPath], {
    env: { ...process.env, RELAY_TOKEN: token, RELAY_HOST: "127.0.0.1", RELAY_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relay did not start: ${output}`)), 5000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split("\n").find((item) => item.includes("\"ready\""));
      if (!line) return;
      clearTimeout(timer);
      const parsed = JSON.parse(line) as { port: number };
      resolve({
        port: parsed.port,
        get output() {
          return output;
        },
        stop: () => stopChild(child),
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

function startRedirect(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(302, { location: "http://127.0.0.1/somewhere-else" });
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}
