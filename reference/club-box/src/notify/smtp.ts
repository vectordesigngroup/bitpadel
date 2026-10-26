// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { MessageProvider, OutboundMessage } from "./types.js";

export type MailTransport = {
  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<{ messageId?: string }>;
};

/** SMTP email. The transport is nodemailer in production and a fake in tests. */
export class SmtpEmailProvider implements MessageProvider {
  readonly id = "smtp";
  readonly channel = "email" as const;

  constructor(
    private readonly from: string,
    private readonly transport: MailTransport,
  ) {}

  async send(message: OutboundMessage): Promise<{ id: string }> {
    if (message.channel !== "email") throw new Error("SMTP provider only sends email");
    const info = await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject ?? "Club message",
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    return { id: info.messageId || "smtp" };
  }
}
