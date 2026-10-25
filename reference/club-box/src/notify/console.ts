// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { randomBytes } from "node:crypto";
import { log } from "../log.js";
import type { Channel, MessageProvider, OutboundMessage } from "./types.js";

/** Prints a redacted line. The full message stays on `sent` for tests. */
export class ConsoleMessageProvider implements MessageProvider {
  readonly id = "console";
  readonly sent: OutboundMessage[] = [];

  constructor(readonly channel: Channel) {}

  async send(message: OutboundMessage): Promise<{ id: string }> {
    if (message.channel !== this.channel) {
      throw new Error(`Console ${this.channel} provider cannot send ${message.channel}`);
    }
    this.sent.push(message);
    log("info", "notification", {
      provider: this.id,
      channel: message.channel,
      kind: message.kind,
      to: redactAddress(message.to),
    });
    return { id: `console_${randomBytes(8).toString("hex")}` };
  }
}

function redactAddress(value: string): string {
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${(name ?? "").slice(0, 1)}***@${domain ?? ""}`;
  }
  return `***${value.slice(-2)}`;
}
