// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio, contrastWarnings } from "../src/brand/color.js";
import { DEFAULT_FOOTER_TEXT } from "../src/brand/model.js";
import { sanitizeSvg } from "../src/brand/svg.js";
import { ConsoleMessageProvider } from "../src/notify/console.js";
import { PostmarkEmailProvider } from "../src/notify/postmark.js";
import { SmtpEmailProvider } from "../src/notify/smtp.js";
import { adminHeaders, api, createCourtAndSlot, FIXTURE_PRICE_MINOR, startTestApp } from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SAFE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#112233"/></svg>`;

const PAGES = ["/", "/booking", "/admin", "/kiosk", "/enroll", "/desk", "/guest", "/privacy", "/account"];

test("svg sanitizer keeps drawings and rejects active content", () => {
  const clean = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><metadata><desc>skip</desc></metadata><rect width="10" height="10" fill="#112233"/></svg>`,
  );
  assert.match(clean, /<rect /);
  assert.doesNotMatch(clean, /metadata/);
  assert.equal(sanitizeSvg(`<svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="1" fill="#fff"/></svg>`).startsWith("<svg"), true);
  assert.throws(() => sanitizeSvg(`${SAFE_SVG.slice(0, -6)}<script>alert(1)</script></svg>`), /script/i);
  assert.throws(() => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`), /script|active/i);
  const external = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="https://evil.example/a.svg"/></svg>`,
  );
  assert.doesNotMatch(external, /evil\.example/);
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00");
  const warnings = contrastWarnings({
    backgroundColor: "#ffffff",
    textColor: "#ffffff",
    primaryColor: "#ffffff",
    accentColor: "#ffffff",
  });
  assert.equal(warnings.length, 3);
});

test("branding defaults, validation, pages, and audit", async () => {
  const app = await startTestApp();
  try {
    const css = await fetch(`${app.baseUrl}/brand.css`);
    assert.equal(css.status, 200);
    const stylesheet = await css.text();
    assert.match(stylesheet, /--bg: #0f172a;/);
    assert.match(stylesheet, /--primary: #14b8a6;/);
    assert.match(stylesheet, /--surface: #1e293b;/);

    const open = await fetch(`${app.baseUrl}/`);
    const openHtml = await open.text();
    assert.match(openHtml, /Your club/);
    assert.match(openHtml, /BitPadel name and logo are not your club's brand/);
    assert.match(openHtml, /href="\/brand\.css"/);
    assert.doesNotMatch(openHtml, /North Court/);

    const anon = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(brandBody()),
    });
    assert.equal(anon.status, 401);

    const reserved = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(brandBody({ clubName: "BitPadel" })),
    });
    assert.equal(reserved.status, 400);
    assert.match(String(reserved.body.error), /own name/);

    const badColor = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(brandBody({ primaryColor: "teal" })),
    });
    assert.equal(badColor.status, 400);

    const badLink = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(brandBody({ links: [{ label: "Home", url: "javascript:alert(1)" }] })),
    });
    assert.equal(badLink.status, 400);

    const badFont = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(brandBody({ fontKey: "comic-sans-from-the-web" })),
    });
    assert.equal(badFont.status, 400);

    const pale = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(
        brandBody({
          backgroundColor: "#ffffff",
          textColor: "#ffffff",
          primaryColor: "#ffffff",
          accentColor: "#ffffff",
        }),
      ),
    });
    assert.equal(pale.status, 200);
    assert.equal((pale.body.contrastWarnings as string[]).length, 3);

    const saved = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(
        brandBody({
          clubName: "North <Court> Club",
          shortName: "North Court",
          primaryColor: "#14532d",
          accentColor: "#fef08a",
          backgroundColor: "#f8fafc",
          textColor: "#0f172a",
          fontKey: "serif",
          contactText: "Desk phone on the club card",
          footerText: "Book on this site.",
          links: [{ label: "Hours", url: "https://example.invalid/hours" }],
        }),
      ),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.clubName, "North <Court> Club");
    assert.equal(saved.body.usingPlaceholder, false);

    const publicBrand = await api(app.baseUrl, "/api/brand");
    assert.equal(publicBrand.status, 200);
    assert.equal(publicBrand.body.shortName, "North Court");
    assert.equal((publicBrand.body as { logo?: unknown }).logo, undefined);

    const brandedCss = await (await fetch(`${app.baseUrl}/brand.css`)).text();
    assert.match(brandedCss, /--bg: #f8fafc;/);
    assert.match(brandedCss, /--primary: #14532d;/);
    assert.match(brandedCss, /Georgia/);

    for (const path of PAGES) {
      const page = await fetch(`${app.baseUrl}${path}`);
      assert.equal(page.status, 200, path);
      const html = await page.text();
      assert.match(html, /North Court/, path);
      assert.match(html, /North &lt;Court&gt; Club/, path);
      assert.match(html, /Book on this site\./, path);
      assert.match(html, /Desk phone on the club card/, path);
      assert.match(html, /https:\/\/example\.invalid\/hours/, path);
      assert.doesNotMatch(html, /North <Court> Club/, path);
    }

    const actions = await api(app.baseUrl, "/api/admin/staff-actions", { headers: adminHeaders() });
    const rows = actions.body.actions as Array<{ method: string; path: string }>;
    assert.ok(rows.some((row) => row.method === "POST" && row.path === "/api/admin/brand"));

    const desk = await api(app.baseUrl, "/api/admin/staff", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        username: "front",
        password: "another-long-password",
        displayName: "Front",
        role: "front-desk",
      }),
    });
    assert.equal(desk.status, 201);
    const login = await api(app.baseUrl, "/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "front", password: "another-long-password" }),
    });
    const denied = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: { authorization: `Bearer ${login.body.token as string}`, "content-type": "application/json" },
      body: JSON.stringify(brandBody({ clubName: "Front desk club", shortName: "Front" })),
    });
    assert.equal(denied.status, 401);
    const still = await api(app.baseUrl, "/api/brand");
    assert.equal(still.body.shortName, "North Court");
  } finally {
    await app.close();
  }
});

test("logo and favicon uploads are limited, sanitized, and shown on the page", async () => {
  const app = await startTestApp();
  try {
    const script = await fetch(`${app.baseUrl}/api/admin/brand/logo`, {
      method: "POST",
        headers: { authorization: adminHeaders().authorization },
      body: Buffer.from(`${SAFE_SVG.slice(0, -6)}<script>alert(1)</script></svg>`),
    });
    assert.equal(script.status, 400);
    const scriptBody = (await script.json()) as { error: string };
    assert.match(scriptBody.error, /script|active/i);

    const named = await fetch(`${app.baseUrl}/api/admin/brand/logo`, {
      method: "POST",
        headers: { authorization: adminHeaders().authorization },
      body: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="0" y="8">BitPadel</text></svg>`,
      ),
    });
    assert.equal(named.status, 400);

    const junk = await fetch(`${app.baseUrl}/api/admin/brand/logo`, {
      method: "POST",
        headers: { authorization: adminHeaders().authorization },
      body: Buffer.from("not an image"),
    });
    assert.equal(junk.status, 400);

    const logo = await fetch(`${app.baseUrl}/api/admin/brand/logo`, {
      method: "POST",
        headers: { authorization: adminHeaders().authorization },
      body: Buffer.from(SAFE_SVG),
    });
    assert.equal(logo.status, 200);
    const logoJson = (await logo.json()) as { hasLogo: boolean };
    assert.equal(logoJson.hasLogo, true);
    const served = await fetch(`${app.baseUrl}/brand/logo`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/svg+xml");
    assert.match(served.headers.get("content-security-policy") ?? "", /sandbox/);
    const servedSvg = await served.text();
    assert.match(servedSvg, /rect/);
    assert.doesNotMatch(servedSvg, /<script/i);
    const page = await (await fetch(`${app.baseUrl}/`)).text();
    assert.match(page, /src="\/brand\/logo\?v=/);

    const png = await fetch(`${app.baseUrl}/api/admin/brand/favicon`, {
      method: "POST",
        headers: { authorization: adminHeaders().authorization },
      body: PNG,
    });
    assert.equal(png.status, 200);
    const icon = await fetch(`${app.baseUrl}/brand/favicon`);
    assert.equal(icon.headers.get("content-type"), "image/png");
    assert.equal(Buffer.compare(Buffer.from(await icon.arrayBuffer()), PNG), 0);
    const withIcon = await (await fetch(`${app.baseUrl}/kiosk`)).text();
    assert.match(withIcon, /rel="icon" href="\/brand\/favicon\?v=/);

    const jpeg = await fetch(`${app.baseUrl}/api/admin/brand/logo`, {
      method: "POST",
        headers: { authorization: adminHeaders().authorization },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    assert.equal(jpeg.status, 200);
    assert.equal((await fetch(`${app.baseUrl}/brand/logo`)).headers.get("content-type"), "image/jpeg");

    const ico = Buffer.alloc(22);
    ico[2] = 1;
    const faviconIco = await fetch(`${app.baseUrl}/api/admin/brand/favicon`, {
      method: "POST",
        headers: { authorization: adminHeaders().authorization },
      body: ico,
    });
    assert.equal(faviconIco.status, 200);
    assert.equal((await fetch(`${app.baseUrl}/brand/favicon`)).headers.get("content-type"), "image/x-icon");

    const cleared = await api(app.baseUrl, "/api/admin/brand/logo/clear", {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.hasLogo, false);
    assert.equal((await fetch(`${app.baseUrl}/brand/logo`)).status, 404);
  } finally {
    await app.close();
  }
});

test("receipts and other email use the saved club brand", async () => {
  const app = await startTestApp();
  try {
    const saved = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(
        brandBody({
          clubName: "North Court Club",
          shortName: "North Court",
          primaryColor: "#14532d",
          contactText: "Ask the front desk",
        }),
      ),
    });
    assert.equal(saved.status, 200);
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR);
    const held = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId, receiptEmail: "payer@example.invalid" }),
    });
    assert.equal(held.status, 201);
    const holdId = (held.body.hold as { id: string }).id;
    const paid = await api(app.baseUrl, `/api/admin/holds/${holdId}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(paid.status, 200);
    const email = app.notifier.email;
    assert.ok(email instanceof ConsoleMessageProvider);
    const receipt = email.sent.find((message) => message.to === "payer@example.invalid");
    assert.ok(receipt);
    assert.match(receipt.subject ?? "", /^North Court: /);
    assert.match(receipt.text, /North Court Club/);
    assert.match(receipt.text, /Ask the front desk/);
    assert.match(receipt.text, /transactional/);
    assert.match(receipt.html ?? "", /#14532d/);
    assert.match(receipt.html ?? "", /North Court Club/);
  } finally {
    await app.close();
  }
});

test("email providers forward the branded html body", async () => {
  let posted = "";
  const postmark = new PostmarkEmailProvider("server-token", "desk@example.invalid", async (_url, init) => {
    posted = String(init?.body ?? "");
    return new Response(JSON.stringify({ MessageID: "pm_brand" }), { status: 200 });
  });
  const sent = await postmark.send({
    channel: "email",
    kind: "transactional",
    to: "person@example.invalid",
    subject: "North Court: Court booking receipt",
    text: "Paid",
    html: "<p>North Court Club</p>",
  });
  assert.equal(sent.id, "pm_brand");
  assert.match(posted, /HtmlBody/);
  assert.match(posted, /North Court Club/);

  let html = "";
  const smtp = new SmtpEmailProvider("desk@example.invalid", {
    async sendMail(input) {
      html = input.html ?? "";
      return { messageId: "smtp_brand" };
    },
  });
  await smtp.send({
    channel: "email",
    kind: "transactional",
    to: "person@example.invalid",
    subject: "Receipt",
    text: "Paid",
    html: "<p>North Court Club</p>",
  });
  assert.match(html, /North Court Club/);
  assert.equal(DEFAULT_FOOTER_TEXT.includes("BitPadel"), true);
});

function brandBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clubName: "North Court Club",
    shortName: "North Court",
    primaryColor: "#14532d",
    accentColor: "#fef08a",
    backgroundColor: "#f8fafc",
    textColor: "#0f172a",
    fontKey: "system",
    footerText: "Book on this site.",
    contactText: "",
    links: [],
    ...overrides,
  };
}
