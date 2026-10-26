// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const params = new URLSearchParams(location.search);
const statusEl = document.querySelector("#status");
const i18n = window.clubI18n;

document.querySelector("#guest").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const checkin = params.get("checkin") || "";
  const token = params.get("token") || "";
  try {
    const response = await fetch(`/api/checkins/${encodeURIComponent(checkin)}/guests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        displayName: data.get("displayName"),
        contactKind: data.get("contactKind"),
        contactValue: data.get("contactValue"),
        waiverAccepted: data.get("waiverAccepted") === "on",
        marketingConsent: data.get("marketingConsent") === "on",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.code || body.error ? i18n.errorText(body, response.status) : i18n.t("guest.failed"));
    statusEl.textContent = i18n.t("guest.added");
    if (form instanceof HTMLFormElement) form.reset();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});
