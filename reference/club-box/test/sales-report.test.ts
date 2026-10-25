// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import assert from "node:assert/strict";
import test from "node:test";
import { adminHeaders, api, createCourtAndSlot, FIXTURE_PRICE_MINOR, startTestApp } from "./helpers.js";

test("sales CSV is date filtered and includes stored Playtomic payments", async () => {
  const app = await startTestApp();
  try {
    const slot = await createCourtAndSlot(app, FIXTURE_PRICE_MINOR, "Court Sales");
    const hold = await api(app.baseUrl, "/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot.slotId }),
    });
    const holdId = (hold.body.hold as { id: string }).id;
    const paid = await api(app.baseUrl, `/api/admin/holds/${holdId}/simulate-payment`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal((paid.body as { outcome: string }).outcome, "confirmed");
    app.db
      .prepare(
        `INSERT INTO playtomic_payments (
           club_payment_id, payment_id, refund_id, status, total_text, payment_date, service_date, product_sku, synced_at
         ) VALUES ('pay-in', 'ext', NULL, 'PAID', '10.00', '2026-06-01T16:00:00.000Z', NULL, 'court', '2026-06-01T16:00:00.000Z')`,
      )
      .run();
    app.db
      .prepare(
        `INSERT INTO playtomic_payments (
           club_payment_id, payment_id, refund_id, status, total_text, payment_date, service_date, product_sku, synced_at
         ) VALUES ('pay-out', 'ext2', NULL, 'PAID', '99.00', '2025-01-01T00:00:00.000Z', NULL, 'old', '2025-01-01T00:00:00.000Z')`,
      )
      .run();
    const response = await fetch(`${app.baseUrl}/api/admin/reports/sales.csv?from=2026-06-01&to=2026-06-01`, {
      headers: { authorization: adminHeaders().authorization ?? "" },
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /lightning,/);
    assert.match(text, /playtomic,pay-in,PAID,10.00/);
    assert.doesNotMatch(text, /pay-out/);
    const missing = await fetch(`${app.baseUrl}/api/admin/reports/sales.csv`, {
      headers: { authorization: adminHeaders().authorization ?? "" },
    });
    assert.equal(missing.status, 400);
  } finally {
    await app.close();
  }
});
