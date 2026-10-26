// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const params = new URLSearchParams(location.search);
const k1 = params.get("k1") || "";
const statusEl = document.querySelector("#status");
const qrEl = document.querySelector("#qr");
const i18n = window.clubI18n;

function setStatus(text) {
  statusEl.textContent = text;
}

async function start() {
  if (!/^[0-9a-f]{64}$/i.test(k1)) {
    setStatus(i18n.t("enroll.openFromAdmin"));
    return;
  }
  qrEl.hidden = false;
  qrEl.src = `/api/access/challenges/${k1}/qr.png`;
  setStatus(i18n.t("enroll.scan"));
  const timer = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/access/challenges/${k1}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(body.error || i18n.t("enroll.unavailable"));
        window.clearInterval(timer);
        return;
      }
      if (body.challenge.status === "enrolled") {
        setStatus(i18n.t("enroll.done"));
        window.clearInterval(timer);
      } else if (body.challenge.status === "denied" || body.challenge.status === "expired") {
        setStatus(i18n.t("enroll.failed"));
        window.clearInterval(timer);
      }
    } catch {
      setStatus(i18n.t("enroll.offline"));
    }
  }, 1500);
}

start();
