// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
const qrEl = document.querySelector("#qr");
const areasEl = document.querySelector("#areas");
const checkinEl = document.querySelector("#checkin");
const uidWarning = document.querySelector("#uid-warning");
const i18n = window.clubI18n;
let area = new URLSearchParams(location.search).get("area") || "";
let timer = 0;

function t(key, vars) {
  return i18n.t(key, vars);
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function start() {
  let health;
  try {
    health = await fetch("/api/health").then((response) => {
      if (!response.ok) throw new Error(t("kiosk.unreachable"));
      return response.json();
    });
  } catch {
    qrEl.hidden = true;
    setStatus(t("kiosk.unreachable"));
    return;
  }
  uidWarning.hidden = health.uidMode !== "insecure-dev";
  if (!area || !health.areas.includes(area)) {
    area = "";
    areasEl.replaceChildren();
    for (const id of health.areas) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = id;
      button.addEventListener("click", () => {
        area = id;
        const url = new URL(location.href);
        url.searchParams.set("area", id);
        history.replaceState(null, "", url);
        rotate();
      });
      areasEl.append(button);
    }
    setStatus(t("kiosk.chooseArea"));
    return;
  }
  await rotate();
}

async function rotate() {
  window.clearTimeout(timer);
  try {
    const response = await fetch("/api/access/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || t("kiosk.couldNotStart"));
    const challenge = body.challenge;
    qrEl.hidden = false;
    qrEl.src = `/api/access/challenges/${challenge.k1}/qr.png?ts=${Date.now()}`;
    setStatus(t("kiosk.scan"));
    watch(challenge.k1, new Date(challenge.expiresAt).getTime());
  } catch (error) {
    qrEl.hidden = true;
    setStatus(`${error.message} ${t("kiosk.fallbackSuffix")}`);
    timer = window.setTimeout(rotate, 5000);
  }
}

function watch(k1, expiresAt) {
  const tick = async () => {
    if (Date.now() > expiresAt - 5000) {
      await rotate();
      return;
    }
    try {
      const response = await fetch(`/api/access/challenges/${k1}`);
      if (!response.ok) throw new Error(t("kiosk.codeCheckFailed"));
      const body = await response.json();
      if (body.challenge.status === "unlocked") {
        qrEl.hidden = true;
        showCheckin(body.challenge.checkin);
        setStatus(t("kiosk.entryPulsed"));
        return;
      }
      if (body.challenge.status === "denied") {
        qrEl.hidden = true;
        setStatus(reasonText(body.challenge.reason));
        timer = window.setTimeout(rotate, 4000);
        return;
      }
      timer = window.setTimeout(tick, 1000);
    } catch {
      setStatus(t("kiosk.unreachable"));
      timer = window.setTimeout(rotate, 5000);
    }
  };
  timer = window.setTimeout(tick, 1000);
}

function showCheckin(checkin) {
  if (!checkin) return;
  checkinEl.hidden = false;
  document.querySelector("#checkin-name").textContent = checkin.displayName;
  const photo = document.querySelector("#checkin-photo");
  if (checkin.hasPhoto) {
    photo.hidden = false;
    photo.alt = t("kiosk.photoAlt");
    photo.src = `/api/checkins/${checkin.id}/photo?token=${encodeURIComponent(checkin.token)}`;
  }
  const count = document.querySelector("#guest-count");
  count.textContent = String(checkin.guestCount);
  document.querySelector("#guest-link").href = `/guest?checkin=${encodeURIComponent(checkin.id)}&token=${encodeURIComponent(checkin.token)}`;
  document.querySelector("#guest-up").onclick = () => changeGuests(checkin, 1, count);
  document.querySelector("#guest-down").onclick = () => changeGuests(checkin, -1, count);
}

async function changeGuests(checkin, delta, count) {
  const next = Math.max(0, Number(count.textContent) + delta);
  if (next > checkin.guestLimit) {
    setStatus(t("kiosk.overLimit"));
    return;
  }
  const response = await fetch(`/api/checkins/${checkin.id}/guest-count`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: checkin.token, guestCount: next }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || t("kiosk.couldNotUpdate"));
    return;
  }
  count.textContent = String(body.checkin.guestCount);
}

function reasonText(reason) {
  switch (reason) {
    case "door-failed":
      return t("kiosk.reason.door-failed");
    case "unknown-key":
      return t("kiosk.reason.unknown-key");
    case "member-inactive":
      return t("kiosk.reason.member-inactive");
    case "outside-hours":
      return t("kiosk.reason.outside-hours");
    case "replay":
    case "counter-replay":
      return t("kiosk.reason.replay");
    case "expired":
      return t("kiosk.reason.expired");
    case "revoked":
    case "lost":
      return t("kiosk.reason.revoked");
    case "unknown-card":
      return t("kiosk.reason.unknown-card");
    default:
      return t("kiosk.reason.default");
  }
}

start();
