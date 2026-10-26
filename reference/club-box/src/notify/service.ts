// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type Database from "better-sqlite3";
import { applyEmailBrand } from "../brand/email.js";
import { defaultClubBrand } from "../brand/model.js";
import { loadClubBrand } from "../brand/store.js";
import type { AppConfig } from "../config.js";
import { one } from "../db.js";
import { AppError } from "../errors.js";
import { formatMoney } from "../i18n/format.js";
import { clubLocale, localeForRecipient } from "../i18n/preference.js";
import { translate } from "../i18n/catalog.js";
import type { LocaleId } from "../i18n/locales.js";
import { log } from "../log.js";
import type { Channel, MessageKind, Notifier, OutboundMessage } from "./types.js";

export type EmailBrandSource = {
  db: Database.Database;
  publicBaseUrl?: string;
};

export async function sendTransactional(
  notifier: Notifier,
  message: OutboundMessage,
  source?: EmailBrandSource,
): Promise<{ id: string }> {
  if (message.kind !== "transactional") throw new AppError(500, "Expected a transactional message");
  return providerFor(notifier, message.channel).send(withBrand(message, source));
}

/** Marketing never sends unless a consent row is still active. */
export async function sendMarketing(
  db: Database.Database,
  notifier: Notifier,
  message: OutboundMessage,
  publicBaseUrl?: string,
): Promise<{ id: string }> {
  if (message.kind !== "marketing") throw new AppError(500, "Expected a marketing message");
  if (!isOptedIn(db, message.channel, message.to)) {
    throw new AppError(409, "That contact has not opted in to marketing");
  }
  return providerFor(notifier, message.channel).send(withBrand(message, { db, publicBaseUrl }));
}

export function isOptedIn(db: Database.Database, channel: Channel, to: string): boolean {
  const kind = contactKind(channel);
  const value = kind === "email" ? to.trim().toLowerCase() : to.trim();
  const row = one<{ id: string }>(
    db,
    `SELECT id FROM marketing_consents
     WHERE contact_kind = ? AND lower(contact_value) = lower(?) AND unsubscribed_at IS NULL
     LIMIT 1`,
    kind,
    value,
  );
  return Boolean(row);
}

export async function notifyAdminAlert(
  notifier: Notifier,
  config: AppConfig,
  text: string,
  db?: Database.Database,
): Promise<void> {
  const source = db ? { db, publicBaseUrl: config.publicBaseUrl } : undefined;
  const jobs: Array<Promise<unknown>> = [];
  const alertLocale = db ? clubLocale(db) : "en";
  if (config.notifyAdminEmail) {
    jobs.push(
      sendTransactional(
        notifier,
        {
          channel: "email",
          kind: "transactional",
          to: config.notifyAdminEmail,
          subject: translate(alertLocale, "email.alert.subject"),
          text,
        },
        source,
      ),
    );
  }
  if (config.notifyAdminSms) {
    jobs.push(
      sendTransactional(notifier, {
        channel: "sms",
        kind: "transactional",
        to: config.notifyAdminSms,
        subject: null,
        text,
      }),
    );
  }
  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === "rejected") {
      const reason = result.reason;
      log("error", "admin alert failed", { error: reason instanceof Error ? reason.message : "error" });
    }
  }
}

export async function sendReceipt(
  notifier: Notifier,
  input: {
    to: string;
    bookingId: string;
    amountMinor: number;
    currency: string;
    currencyDecimals: number;
    locale: LocaleId;
  },
  source?: EmailBrandSource,
): Promise<void> {
  const amount = formatMoney(input.amountMinor, input.currency, input.currencyDecimals, input.locale);
  await sendTransactional(
    notifier,
    {
      channel: "email",
      kind: "transactional",
      to: input.to,
      subject: translate(input.locale, "email.receipt.subject"),
      text: translate(input.locale, "email.receipt.text", { bookingId: input.bookingId, amount }),
    },
    source,
  );
}

export async function sendPrivacyLink(
  notifier: Notifier,
  config: AppConfig,
  input: { contactKind: "email" | "phone"; to: string; privacyToken: string; hintLocale?: string | null },
  db?: Database.Database,
): Promise<void> {
  const url = `${config.publicBaseUrl}/privacy?token=${encodeURIComponent(input.privacyToken)}`;
  const channel: Channel = input.contactKind === "email" ? "email" : "sms";
  const locale = db
    ? localeForRecipient(db, {
        email: input.contactKind === "email" ? input.to : null,
        phone: input.contactKind === "phone" ? input.to : null,
        hint: input.hintLocale,
      })
    : "en";
  await sendTransactional(
    notifier,
    {
      channel,
      kind: "transactional",
      to: input.to,
      subject: channel === "email" ? translate(locale, "email.privacy.subject") : null,
      text: translate(locale, "email.privacy.text", { url }),
    },
    db ? { db, publicBaseUrl: config.publicBaseUrl } : undefined,
  );
}

export async function sendHouseholdNotice(
  db: Database.Database,
  notifier: Notifier,
  primaryMemberId: string,
  kind: "created" | "updated",
  publicBaseUrl?: string,
): Promise<void> {
  const row = one<{ email: string | null }>(db, "SELECT email FROM members WHERE id = ?", primaryMemberId);
  const email = row?.email?.trim() ?? "";
  if (!email) return;
  const locale = localeForRecipient(db, { memberId: primaryMemberId });
  const textKey = kind === "created" ? "email.household.created" : "email.household.updated";
  await sendTransactional(
    notifier,
    {
      channel: "email",
      kind: "transactional",
      to: email,
      subject: translate(locale, "email.household.subject"),
      text: translate(locale, textKey),
    },
    { db, publicBaseUrl },
  );
}

function withBrand(message: OutboundMessage, source?: EmailBrandSource): OutboundMessage {
  if (message.channel !== "email") return message;
  const brand = source ? loadClubBrand(source.db) : defaultClubBrand();
  return applyEmailBrand(brand, message, source?.publicBaseUrl);
}

function providerFor(notifier: Notifier, channel: Channel) {
  switch (channel) {
    case "email":
      return notifier.email;
    case "sms":
      return notifier.sms;
    default: {
      const unknown: never = channel;
      throw new Error(`Unknown channel: ${String(unknown)}`);
    }
  }
}

function contactKind(channel: Channel): "email" | "phone" {
  switch (channel) {
    case "email":
      return "email";
    case "sms":
      return "phone";
    default: {
      const unknown: never = channel;
      throw new Error(`Unknown channel: ${String(unknown)}`);
    }
  }
}

export function assertMessageKind(kind: MessageKind): MessageKind {
  switch (kind) {
    case "transactional":
    case "marketing":
      return kind;
    default: {
      const unknown: never = kind;
      throw new Error(`Unknown message kind: ${String(unknown)}`);
    }
  }
}
