// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { DoorController, DoorPulse, DoorPulseResult } from "./types.js";

/** Records entry pulses in memory. It does not drive a lock. */
export class MockDoorController implements DoorController {
  readonly name = "mock" as const;
  readonly pulses: DoorPulse[] = [];
  failNext: DoorPulseResult | null = null;

  async pulseEntry(pulse: DoorPulse): Promise<DoorPulseResult> {
    if (this.failNext) {
      const result = this.failNext;
      this.failNext = null;
      return result;
    }
    this.pulses.push({ ...pulse });
    return { ok: true };
  }
}
