// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { AppError } from "../errors.js";
import { isRecord } from "../validate.js";
import type { MessageProvider, OutboundMessage } from "./types.js";

/** Postmark HTTP API. No vendor SDK. */
export class PostmarkEmailProvider implements MessageProvider {
  readonly id = "postmark";
  readonly channel = "email" as const;

  constructor(
    private readonly serverToken: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<{ id: string }> {
    if (message.channel !== "email") throw new Error("Postmark provider only sends email");
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-postmark-server-token": this.serverToken,
        },
        body: JSON.stringify({
          From: this.from,
          To: message.to,
          Subject: message.subject ?? "Club message",
          TextBody: message.text,
          MessageStream: "outbound",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(502, "Email provider did not respond");
    }
    const text = await response.text();
    if (!response.ok) throw new AppError(502, `Email provider returned HTTP ${response.status}`);
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    const id = isRecord(parsed) && typeof parsed.MessageID === "string" ? parsed.MessageID : "postmark";
    return { id };
  }
}
