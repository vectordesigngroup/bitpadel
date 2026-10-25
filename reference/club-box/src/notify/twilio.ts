// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "../errors.js";
import { isRecord } from "../validate.js";
import type { MessageProvider, OutboundMessage } from "./types.js";

/** Twilio Programmable SMS over HTTP. No vendor SDK. */
export class TwilioSmsProvider implements MessageProvider {
  readonly id = "twilio";
  readonly channel = "sms" as const;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<{ id: string }> {
    if (message.channel !== "sms") throw new Error("Twilio provider only sends SMS");
    const body = new URLSearchParams({ To: message.to, From: this.from, Body: message.text });
    const token = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${token}`,
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new AppError(502, "SMS provider did not respond");
    }
    const text = await response.text();
    if (!response.ok) throw new AppError(502, `SMS provider returned HTTP ${response.status}`);
    let parsed: unknown = null;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      parsed = null;
    }
    const id = isRecord(parsed) && typeof parsed.sid === "string" ? parsed.sid : "twilio";
    return { id };
  }
}
