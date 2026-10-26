// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formatDateTime, formatMoney, formatSats } from "../src/i18n/format.js";
import { LOCALE_IDS, canonicalizeLocale } from "../src/i18n/locales.js";
import { resolveLocale } from "../src/i18n/negotiate.js";
import { ConsoleMessageProvider } from "../src/notify/console.js";
import { adminHeaders, api, createCourtAndSlot, FIXTURE_PRICE_MINOR, startTestApp, type RunningApp } from "./helpers.js";

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../locales");

function catalog(id: string): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(path.join(localesDir, `${id}.json`), "utf8"));
  assert.equal(typeof parsed, "object");
  assert.ok(parsed);
  const messages: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    assert.equal(typeof value, "string", `${id} ${key} must be a string`);
    assert.ok((value as string).trim().length > 0, `${id} ${key} is empty`);
    messages[key] = value as string;
  }
  return messages;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1] ?? "").sort();
}

test("every English key exists in every other catalog, with the same placeholders", () => {
  const english = catalog("en");
  const englishKeys = Object.keys(english).sort();
  for (const id of LOCALE_IDS) {
    if (id === "en") continue;
    const messages = catalog(id);
    assert.deepEqual(Object.keys(messages).sort(), englishKeys, id);
    for (const key of englishKeys) {
      assert.deepEqual(placeholders(messages[key] ?? ""), placeholders(english[key] ?? ""), `${id} ${key}`);
    }
  }
  const review = JSON.parse(readFileSync(path.join(localesDir, "review.json"), "utf8")) as {
    legalReviewKeys: string[];
    machineDraftLocales: string[];
  };
  assert.deepEqual(review.machineDraftLocales, ["es", "fr", "it", "pt-BR"]);
  for (const key of review.legalReviewKeys) {
    assert.equal(typeof english[key], "string", key);
  }
});

test("locale tags fold onto a catalog, and Portugal stays on Brazilian Portuguese until it has a file", () => {
  assert.equal(canonicalizeLocale("pt"), "pt-BR");
  assert.equal(canonicalizeLocale("pt-PT"), "pt-BR");
  assert.equal(canonicalizeLocale("pt_pt"), "pt-BR");
  assert.equal(canonicalizeLocale("es-MX"), "es");
  assert.equal(canonicalizeLocale("fr-CA"), "fr");
  assert.equal(canonicalizeLocale("EN"), "en");
  assert.equal(canonicalizeLocale("de"), null);
  assert.equal(canonicalizeLocale("pt-BR"), "pt-BR");
});

test("language choice prefers the request, then the profile, then the browser, then the club", () => {
  assert.deepEqual(
    resolveLocale({ query: "es", profile: "fr", cookie: "it", acceptLanguage: "pt-BR", clubDefault: "en" }),
    { locale: "es", source: "query" },
  );
  assert.deepEqual(
    resolveLocale({ profile: "fr", cookie: "it", acceptLanguage: "es", clubDefault: "en" }),
    { locale: "fr", source: "profile" },
  );
  assert.deepEqual(
    resolveLocale({ cookie: "it", acceptLanguage: "es", clubDefault: "fr" }),
    { locale: "it", source: "cookie" },
  );
  assert.deepEqual(
    resolveLocale({ acceptLanguage: "es-MX,en;q=0.5", clubDefault: "fr" }),
    { locale: "es", source: "accept-language" },
  );
  assert.deepEqual(resolveLocale({ acceptLanguage: "de", clubDefault: "fr" }), { locale: "fr", source: "club" });
  assert.deepEqual(resolveLocale({ acceptLanguage: "de" }), { locale: "en", source: "default" });
  assert.deepEqual(
    resolveLocale({ acceptLanguage: "de;q=0.9, es;q=0.2" }),
    { locale: "es", source: "accept-language" },
  );
});

test("dates, money, and sats follow the locale", () => {
  const instant = new Date("2026-06-01T15:00:00.000Z");
  assert.match(formatDateTime(instant, "en", "America/New_York"), /11:00/);
  assert.match(formatDateTime(instant, "es", "UTC"), /15:00/);
  assert.equal(formatSats(1000, "es"), "1.000 sats");
  assert.equal(formatSats(1000, "en"), "1,000 sats");
  assert.equal(formatSats(1000, "it"), "1.000 sats");
  assert.equal(formatSats(1000, "pt-BR"), "1.000 sats");
  assert.equal(formatSats(1000, "fr").replace(/[\s\u00a0\u202f]/g, " "), "1 000 sats");
  const euros = formatMoney(1050, "EUR", 2, "es");
  assert.match(euros, /10,50/);
  assert.match(euros, /€/);
  assert.match(formatMoney(1, "XXX", 2, "en"), /0\.01 XXX/);
});

test("pages follow Accept-Language, the cookie, the profile, and the club default", async () => {
  const app = await startTestApp();
  try {
    const saved = await api(app.baseUrl, "/api/admin/brand", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(brandBody({ defaultLocale: "fr" })),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.defaultLocale, "fr");

    const spanish = await fetch(`${app.baseUrl}/`, { headers: { "accept-language": "es,en;q=0.5" } });
    const spanishHtml = await spanish.text();
    assert.match(spanishHtml, /<html lang="es">/);
    assert.match(spanishHtml, /Reservar una pista/);

    const german = await fetch(`${app.baseUrl}/`, { headers: { "accept-language": "de" } });
    assert.match(await german.text(), /<html lang="fr">/);

    const cookie = await fetch(`${app.baseUrl}/`, {
      headers: { cookie: "club_locale=it", "accept-language": "es" },
    });
    assert.match(await cookie.text(), /<html lang="it">/);

    const query = await fetch(`${app.baseUrl}/?lang=es`, { headers: { "accept-language": "fr" } });
    const queryHtml = await query.text();
    assert.match(queryHtml, /<html lang="es">/);
    assert.match(queryHtml, /Reservar una pista/);
    const setCookie = query.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /club_locale=es/);
    assert.match(setCookie, /HttpOnly/);
    assert.doesNotMatch(setCookie, /Max-Age/);

    const playerEmail = "member@example.invalid";
    const session = await loginPlayer(app, playerEmail);
    const chosen = await api(app.baseUrl, "/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ locale: "es" }),
    });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.locale, "es");
    assert.equal(chosen.body.savedOnProfile, true);

    const again = await api(app.baseUrl, "/api/player/code", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "fr" },
      body: JSON.stringify({ email: playerEmail }),
    });
    assert.equal(again.status, 200);
    const email = app.notifier.email;
    assert.ok(email instanceof ConsoleMessageProvider);
    const message = [...email.sent].reverse().find((row) => row.to === playerEmail);
    assert.ok(message);
    assert.match(message.subject ?? "", /Tu código para reservar pista/);
    assert.match(message.text, /\d{6}/);

    const profilePage = await fetch(`${app.baseUrl}/`, {
      headers: { cookie: `${session}; club_locale=it`, "accept-language": "fr" },
    });
    assert.match(await profilePage.text(), /<html lang="es">/);
  } finally {
    await app.close();
  }
});

test("a hold keeps the page language, and an English receipt still says it is transactional", async () => {
  const app = await startTestApp();
  try {
    const { slotId } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR, "Court A");
    const spanish = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "es" },
      body: JSON.stringify({ slotId, receiptEmail: "es@example.invalid" }),
    });
    assert.equal(spanish.status, 201);
    const spanishId = (spanish.body.hold as { id: string }).id;
    const stored = app.db.prepare("SELECT locale FROM holds WHERE id = ?").get(spanishId) as { locale: string };
    assert.equal(stored.locale, "es");
    const paidEs = await api(app.baseUrl, `/api/admin/holds/${spanishId}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(paidEs.status, 200);

    const { slotId: englishSlot } = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR, "Court B");
    const english = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: englishSlot, receiptEmail: "en@example.invalid" }),
    });
    assert.equal(english.status, 201);
    const englishId = (english.body.hold as { id: string }).id;
    const paidEn = await api(app.baseUrl, `/api/admin/holds/${englishId}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(paidEn.status, 200);

    const email = app.notifier.email;
    assert.ok(email instanceof ConsoleMessageProvider);
    const spanishReceipt = email.sent.find((row) => row.to === "es@example.invalid");
    const englishReceipt = email.sent.find((row) => row.to === "en@example.invalid");
    assert.ok(spanishReceipt);
    assert.ok(englishReceipt);
    assert.match(spanishReceipt.text, /pagada/);
    assert.doesNotMatch(spanishReceipt.text, /transactional/);
    assert.match(englishReceipt.subject ?? "", /Court booking receipt/);
    assert.match(englishReceipt.text, /transactional/);
  } finally {
    await app.close();
  }
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

async function loginPlayer(app: RunningApp, email: string): Promise<string> {
  const requested = await api(app.baseUrl, "/api/player/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(requested.status, 200);
  const provider = app.notifier.email;
  if (!(provider instanceof ConsoleMessageProvider)) throw new Error("expected console email");
  const message = [...provider.sent].reverse().find((row) => row.to === email);
  const code = message ? /(\d{6})/.exec(message.text)?.[1] : undefined;
  if (!code) throw new Error("login code missing");
  const response = await fetch(`${app.baseUrl}/api/player/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().find((row) => row.startsWith("player_session="));
  if (!cookie) throw new Error("player cookie missing");
  return cookie.split(";")[0] ?? "";
}
