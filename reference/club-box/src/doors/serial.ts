// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { writeFile } from "node:fs/promises";
import type { DoorController, DoorPulse, DoorPulseResult } from "./types.js";

/**
 * Writes one pulse line to a serial device or a file a relay daemon reads.
 * The line is only `pulse-entry`. This driver never sends lock or fire-release.
 */
export class SerialDoorController implements DoorController {
  readonly name = "serial" as const;

  constructor(
    private readonly devicePath: string,
    private readonly writeImpl: (path: string, line: string) => Promise<void> = defaultWrite,
  ) {}

  async pulseEntry(pulse: DoorPulse): Promise<DoorPulseResult> {
    const line = `pulse-entry ${pulse.area} ${pulse.pulseMs} ${pulse.requestId}\n`;
    try {
      await this.writeImpl(this.devicePath, line);
      return { ok: true };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }
}

function defaultWrite(devicePath: string, line: string): Promise<void> {
  return writeFile(devicePath, line);
}
