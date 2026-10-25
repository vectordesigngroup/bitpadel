// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import test from "node:test";
import { UnimplementedDesfirePersonalizer, UnimplementedDesfireReaderBridge } from "../src/nfc/desfire-stub.js";

test("DESFire personalization and the reader bridge are explicit stubs", async () => {
  const personalizer = new UnimplementedDesfirePersonalizer();
  await assert.rejects(personalizer.personalize({ uid: "04aabb" }), /DESFire personalization is not implemented/);
  const bridge = new UnimplementedDesfireReaderBridge();
  await assert.rejects(bridge.readProof(), /DESFire reader bridge is not implemented/);
});
