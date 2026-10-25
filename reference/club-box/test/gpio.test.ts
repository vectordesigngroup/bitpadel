// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import test from "node:test";
import { GpioDoorController, openOnoffPin, type GpioPin } from "../src/doors/gpio.js";
import { SerialDoorController } from "../src/doors/serial.js";

test("GPIO and serial drivers only pulse entry", async () => {
  const writes: Array<0 | 1> = [];
  const pin: GpioPin = {
    async write(value) {
      writes.push(value);
    },
    unexport() {
      writes.push(0);
    },
  };
  const gpio = new GpioDoorController(pin, true);
  const pulsed = await gpio.pulseEntry({ area: "lounge", requestId: "req-1", pulseMs: 1 });
  assert.deepEqual(pulsed, { ok: true });
  assert.deepEqual(writes, [1, 0]);

  const lines: string[] = [];
  const serial = new SerialDoorController("/dev/relay0", async (_device, line) => {
    lines.push(line);
  });
  const sent = await serial.pulseEntry({ area: "lounge", requestId: "req-2", pulseMs: 250 });
  assert.deepEqual(sent, { ok: true });
  assert.match(lines[0] ?? "", /^pulse-entry lounge 250 req-2\n$/);
  assert.doesNotMatch(lines[0] ?? "", /lock|fire|egress/);

  await assert.rejects(openOnoffPin(17), /optional onoff package/);
});
