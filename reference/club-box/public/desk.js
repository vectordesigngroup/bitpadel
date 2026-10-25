// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
const appEl = document.querySelector("#app");
let token = sessionStorage.getItem("club-box-staff-token") || "";

function setStatus(text) {
  statusEl.textContent = text;
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(pathname, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

document.querySelector("#login").addEventListener("submit", (event) => {
  event.preventDefault();
  token = document.querySelector("#token").value.trim();
  sessionStorage.setItem("club-box-staff-token", token);
  refresh().catch((error) => setStatus(error.message));
});

async function refresh() {
  const site = await api("/api/staff/onsite");
  const bookings = await api("/api/staff/playtomic/today");
  const conflicts = await api("/api/admin/playtomic/conflicts");
  appEl.hidden = false;
  document.querySelector("#headcount").textContent =
    `${site.members.length} members, ${site.guestCount} guests, ${site.headcount} people on site.`;
  const people = document.querySelector("#people");
  people.replaceChildren();
  for (const member of site.members) {
    const block = document.createElement("article");
    block.className = "card";
    const title = document.createElement("h2");
    title.textContent = member.displayName;
    const meta = document.createElement("p");
    meta.className = "note";
    meta.textContent = `${member.membershipType} · ${member.credentialType} · ${member.guestCount} guests`;
    block.append(title, meta);
    if (member.hasPhoto) {
      const image = document.createElement("img");
      image.alt = "Member photo";
      image.width = 120;
      image.height = 120;
      const response = await fetch(`/api/staff/members/${encodeURIComponent(member.memberId)}/photo`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        image.src = URL.createObjectURL(await response.blob());
        block.append(image);
      }
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Check out";
    button.addEventListener("click", async () => {
      await api(`/api/staff/checkins/${member.checkinId}/checkout`, { method: "POST" });
      await refresh();
    });
    block.append(button);
    people.append(block);
  }
  const list = document.querySelector("#bookings");
  list.replaceChildren();
  for (const booking of bookings.bookings) {
    const line = document.createElement("p");
    const names = booking.players.map((player) => player.displayName || player.email || "Player").join(", ");
    line.textContent = `${booking.courtName || booking.resourceName} · ${names}`;
    list.append(line);
  }
  const flags = document.querySelector("#conflicts");
  flags.replaceChildren();
  for (const conflict of conflicts.conflicts) {
    const line = document.createElement("p");
    line.textContent = conflict.detail;
    flags.append(line);
  }
  setStatus("");
}

if (token) {
  document.querySelector("#token").value = token;
  refresh().catch((error) => setStatus(error.message));
}
