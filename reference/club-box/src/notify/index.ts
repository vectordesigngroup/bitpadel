// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import nodemailer from "nodemailer";
import type { AppConfig } from "../config.js";
import { ConsoleMessageProvider } from "./console.js";
import { PostmarkEmailProvider } from "./postmark.js";
import { SmtpEmailProvider } from "./smtp.js";
import { TwilioSmsProvider } from "./twilio.js";
import type { MessageProvider, Notifier } from "./types.js";
import { WebhookSmsProvider } from "./webhook.js";

/**
 * Build the email and SMS providers selected by environment.
 *
 * Add a provider by implementing `MessageProvider`, parsing its secrets in
 * `loadConfig`, and handling the new name in the switches below. The `never`
 * default fails the build until that case exists. Do not import a vendor SDK
 * unless the club wants that dependency.
 */
export function createNotifier(config: AppConfig): Notifier {
  return {
    email: createEmail(config),
    sms: createSms(config),
  };
}

function createEmail(config: AppConfig): MessageProvider {
  switch (config.emailProvider) {
    case "console":
      return new ConsoleMessageProvider("email");
    case "smtp": {
      if (!config.smtp) throw new Error("SMTP email is not configured");
      const transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        connectionTimeout: 10_000,
        socketTimeout: 10_000,
      });
      return new SmtpEmailProvider(config.smtp.from, transport);
    }
    case "postmark": {
      if (!config.postmark) throw new Error("Postmark email is not configured");
      return new PostmarkEmailProvider(config.postmark.serverToken, config.postmark.from);
    }
    default: {
      const unknown: never = config.emailProvider;
      throw new Error(`Unknown email provider: ${String(unknown)}`);
    }
  }
}

function createSms(config: AppConfig): MessageProvider {
  switch (config.smsProvider) {
    case "console":
      return new ConsoleMessageProvider("sms");
    case "twilio": {
      if (!config.twilio) throw new Error("Twilio SMS is not configured");
      return new TwilioSmsProvider(config.twilio.accountSid, config.twilio.authToken, config.twilio.from);
    }
    case "webhook": {
      if (!config.smsWebhook) throw new Error("SMS webhook is not configured");
      return new WebhookSmsProvider(config.smsWebhook.url, config.smsWebhook.token);
    }
    default: {
      const unknown: never = config.smsProvider;
      throw new Error(`Unknown SMS provider: ${String(unknown)}`);
    }
  }
}
