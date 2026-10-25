// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const params = new URLSearchParams(location.search);
const k1 = params.get("k1") || "";
const statusEl = document.querySelector("#status");
const qrEl = document.querySelector("#qr");

function setStatus(text) {
  statusEl.textContent = text;
}

async function start() {
  if (!/^[0-9a-f]{64}$/i.test(k1)) {
    setStatus("Open the enrollment link from the admin page.");
    return;
  }
  qrEl.hidden = false;
  qrEl.src = `/api/access/challenges/${k1}/qr.png`;
  setStatus("Scan with the wallet that should open the door.");
  const timer = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/access/challenges/${k1}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(body.error || "This code is no longer available.");
        window.clearInterval(timer);
        return;
      }
      if (body.challenge.status === "enrolled") {
        setStatus("Wallet enrolled. You can close this page.");
        window.clearInterval(timer);
      } else if (body.challenge.status === "denied" || body.challenge.status === "expired") {
        setStatus("Enrollment did not finish. Ask staff for a new code.");
        window.clearInterval(timer);
      }
    } catch {
      setStatus("Cannot reach the club server.");
    }
  }, 1500);
}

start();
