// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { DoorHttpConfig } from "../config.js";
import type { DoorController, DoorPulse, DoorPulseResult } from "./types.js";

/**
 * Tells a club-run HTTP relay to pulse the entry strike.
 * The body has one command, `pulse-entry`. Redirects are refused so a relay
 * cannot bounce the request somewhere else. There is no retry: a late pulse
 * could open the door after the member has walked away.
 */
export class HttpDoorController implements DoorController {
  readonly name = "http" as const;

  constructor(private readonly config: DoorHttpConfig) {}

  async pulseEntry(pulse: DoorPulse): Promise<DoorPulseResult> {
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({
          command: "pulse-entry",
          area: pulse.area,
          pulseMs: pulse.pulseMs,
          requestId: pulse.requestId,
        }),
      });
      if (!response.ok) return { ok: false, reason: "rejected" };
      return { ok: true };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }
}
