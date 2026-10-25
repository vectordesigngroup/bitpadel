// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import { parseNdefHttps } from "./ndef.js";
import { dataOf, readBinary, selectNdefApplication, statusOf } from "./ev2.js";

/**
 * Read an NDEF URL from a card and request it.
 * Keys stay on the club server. This process only forwards the URL the card presents.
 */
export async function bridgeFromReader(): Promise<void> {
  const { openPcscTransport } = await import("./pcsc-transport.js");
  const opened = await openPcscTransport();
  try {
    const selected = await opened.transport.transceive(selectNdefApplication());
    if (statusOf(selected) !== 0x9000) throw new Error("The card did not select the NDEF application");
    const read = await opened.transport.transceive(readBinary(255));
    if (statusOf(read) !== 0x9000) throw new Error("The card did not return the NDEF file");
    const url = parseNdefHttps(dataOf(read));
    if (!url) throw new Error("The card does not hold an HTTP or HTTPS NDEF URL");
    const response = await fetch(url, { redirect: "error" });
    const text = await response.text();
    console.log(text.slice(0, 500));
    if (!response.ok && response.status !== 200) {
      throw new Error(`Tap URL returned status ${response.status}`);
    }
  } finally {
    await opened.close();
  }
}

const executed = process.argv[1]?.includes("bridge-cli");
if (executed) {
  bridgeFromReader().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "reader bridge failed");
    process.exit(1);
  });
}
