const statusEl = document.querySelector("#status");
const qrEl = document.querySelector("#qr");
const areasEl = document.querySelector("#areas");
const checkinEl = document.querySelector("#checkin");
const uidWarning = document.querySelector("#uid-warning");
let area = new URLSearchParams(location.search).get("area") || "";
let timer = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

async function start() {
  let health;
  try {
    health = await fetch("/api/health").then((response) => {
      if (!response.ok) throw new Error("Access server unreachable.");
      return response.json();
    });
  } catch {
    qrEl.hidden = true;
    setStatus("Access server unreachable. Use a fob, a PIN, or staff. Exits stay available without this screen.");
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
    setStatus("Choose an area. The QR proves a wallet, then pulses entry only.");
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
    if (!response.ok) throw new Error(body.error || "Could not start a code.");
    const challenge = body.challenge;
    qrEl.hidden = false;
    qrEl.src = `/api/access/challenges/${challenge.k1}/qr.png?ts=${Date.now()}`;
    setStatus("Scan with an enrolled Lightning wallet.");
    watch(challenge.k1, new Date(challenge.expiresAt).getTime());
  } catch (error) {
    qrEl.hidden = true;
    setStatus(`${error.message} Use a fob, a PIN, or staff if you cannot get in.`);
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
      if (!response.ok) throw new Error("Code check failed.");
      const body = await response.json();
      if (body.challenge.status === "unlocked") {
        qrEl.hidden = true;
        showCheckin(body.challenge.checkin);
        setStatus("Entry pulsed. The strike releases on its own. You can always leave without this screen.");
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
      setStatus("Access server unreachable. Use a fob, a PIN, or staff. Exits stay available without this screen.");
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
    photo.alt = "Member photo";
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
    setStatus("That is over the guest limit.");
    return;
  }
  const response = await fetch(`/api/checkins/${checkin.id}/guest-count`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: checkin.token, guestCount: next }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.error || "Could not update guests.");
    return;
  }
  count.textContent = String(body.checkin.guestCount);
}

function reasonText(reason) {
  switch (reason) {
    case "door-failed":
      return "Entry controller did not respond. Use a fob, PIN, or staff.";
    case "unknown-key":
      return "This wallet is not enrolled.";
    case "member-inactive":
      return "Membership is not active.";
    case "outside-hours":
      return "That area is closed right now.";
    case "replay":
    case "counter-replay":
      return "That code or card counter was already used.";
    case "expired":
      return "That code expired.";
    case "revoked":
    case "lost":
      return "That card is not active.";
    case "unknown-card":
      return "This card is not enrolled.";
    default:
      return "Entry was not granted. Use a fob, PIN, or staff if you need to get in.";
  }
}

start();
