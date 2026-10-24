import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { newId } from "../src/ids.js";
import { ConsoleMessageProvider } from "../src/notify/console.js";
import { PostmarkEmailProvider } from "../src/notify/postmark.js";
import { sendMarketing, sendTransactional } from "../src/notify/service.js";
import { SmtpEmailProvider } from "../src/notify/smtp.js";
import { TwilioSmsProvider } from "../src/notify/twilio.js";
import { WebhookSmsProvider } from "../src/notify/webhook.js";
import { adminHeaders, api, startTestApp } from "./helpers.js";

test("marketing stays off until a contact opts in, and transactional does not", async () => {
  const app = await startTestApp();
  try {
    const email = app.notifier.email;
    const sms = app.notifier.sms;
    assert.ok(email instanceof ConsoleMessageProvider);
    assert.ok(sms instanceof ConsoleMessageProvider);
    const refused = await api(app.baseUrl, "/api/admin/marketing/send", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        channel: "email",
        to: "guest@example.invalid",
        subject: "News",
        text: "A marketing note",
      }),
    });
    assert.equal(refused.status, 409);
    assert.equal(email.sent.length, 0);

    app.db
      .prepare(
        `INSERT INTO marketing_consents (
           id, privacy_token, contact_kind, contact_value, consent_text_version, consented_at, unsubscribed_at, source
         ) VALUES (?, ?, 'email', ?, '1', ?, NULL, 'test')`,
      )
      .run(newId("mkt"), "token-opt-in", "guest@example.invalid", app.now().toISOString());

    const sent = await api(app.baseUrl, "/api/admin/marketing/send", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        channel: "email",
        to: "guest@example.invalid",
        subject: "News",
        text: "A marketing note",
      }),
    });
    assert.equal(sent.status, 200);
    assert.equal(email.sent.at(-1)?.kind, "marketing");

    await sendTransactional(app.notifier, {
      channel: "sms",
      kind: "transactional",
      to: "+15550001111",
      subject: null,
      text: "Receipt text",
    });
    assert.equal(sms.sent.at(-1)?.kind, "transactional");
    const marketingSms = await sendMarketing(app.db, app.notifier, {
      channel: "sms",
      kind: "marketing",
      to: "+15550001111",
      subject: null,
      text: "No consent",
    }).then(
      () => "sent",
      (error: unknown) => (error instanceof Error ? error.message : "error"),
    );
    assert.match(marketingSms, /not opted in/);
  } finally {
    await app.close();
  }
});

test("Postmark, Twilio, webhook, and SMTP adapters use the injected transport", async () => {
  const postmarkCalls: Array<{ url: string; token: string }> = [];
  const postmark = new PostmarkEmailProvider("server-token", "desk@example.invalid", async (url, init) => {
    postmarkCalls.push({
      url: String(url),
      token: String((init?.headers as Record<string, string>)["x-postmark-server-token"]),
    });
    return new Response(JSON.stringify({ MessageID: "pm_1" }), { status: 200 });
  });
  const posted = await postmark.send({
    channel: "email",
    kind: "transactional",
    to: "person@example.invalid",
    subject: "Hello",
    text: "Body",
  });
  assert.equal(posted.id, "pm_1");
  assert.equal(postmarkCalls[0]?.url, "https://api.postmarkapp.com/email");
  assert.equal(postmarkCalls[0]?.token, "server-token");

  const twilio = new TwilioSmsProvider("AC123", "auth-token", "+15551110000", async (url, init) => {
    assert.match(String(url), /AC123/);
    assert.match(String(init?.headers && (init.headers as Record<string, string>).authorization), /^Basic /);
    return new Response(JSON.stringify({ sid: "SM1" }), { status: 200 });
  });
  assert.equal(
    (
      await twilio.send({
        channel: "sms",
        kind: "transactional",
        to: "+15552220000",
        subject: null,
        text: "Ping",
      })
    ).id,
    "SM1",
  );

  const hooks: unknown[] = [];
  const server = await listenJson(async (body, authorization) => {
    hooks.push({ body, authorization });
    return { id: "hook_1" };
  });
  try {
    const webhook = new WebhookSmsProvider(server.url, "hook-token");
    const sent = await webhook.send({
      channel: "sms",
      kind: "transactional",
      to: "+15553330000",
      subject: null,
      text: "Webhook body",
    });
    assert.equal(sent.id, "hook_1");
    assert.deepEqual(hooks[0], {
      body: { to: "+15553330000", text: "Webhook body", kind: "transactional" },
      authorization: "Bearer hook-token",
    });
  } finally {
    await closeServer(server.server);
  }

  const smtp = new SmtpEmailProvider("desk@example.invalid", {
    async sendMail(input) {
      assert.equal(input.from, "desk@example.invalid");
      assert.equal(input.to, "person@example.invalid");
      return { messageId: "smtp_1" };
    },
  });
  assert.equal(
    (
      await smtp.send({
        channel: "email",
        kind: "transactional",
        to: "person@example.invalid",
        subject: "Receipt",
        text: "Paid",
      })
    ).id,
    "smtp_1",
  );
});

async function listenJson(
  handler: (body: unknown, authorization: string) => Promise<unknown> | unknown,
): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as unknown) : null;
    const result = await handler(body, req.headers.authorization ?? "");
    const payload = Buffer.from(JSON.stringify(result));
    res.writeHead(200, { "content-type": "application/json", "content-length": payload.length });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, server };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
