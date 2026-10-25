// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

/**
 * Fixed safety contract for this process.
 * The strings are also shown on the kiosk page so they remain visible if the API is down.
 */
export const SAFETY = {
  entryOnly: true,
  controlsEgress: false,
  controlsLifeSafety: false,
  entryGuidance:
    "This service can pulse an entry lock only. It cannot lock a door shut, block an exit, or control fire or other life-safety systems.",
  offlineGuidance:
    "If this screen cannot reach the club server, use a fob, a PIN, or staff. Leaving does not use this service.",
} as const;
