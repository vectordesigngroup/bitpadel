// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
const i18n = window.clubI18n;

document.querySelector("#privacy").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const action = event.submitter?.value === "delete" ? "delete" : "unsubscribe";
  try {
    const response = await fetch(`/api/privacy/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: data.get("token") }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.code || body.error ? i18n.errorText(body, response.status) : i18n.t("privacy.failed"));
    statusEl.textContent = action === "delete" ? i18n.t("privacy.deleted") : i18n.t("privacy.unsubscribed");
  } catch (error) {
    statusEl.textContent = error.message;
  }
});
