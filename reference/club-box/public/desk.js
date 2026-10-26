// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
const appEl = document.querySelector("#app");
const i18n = window.clubI18n;
let token = sessionStorage.getItem("club-box-staff-token") || "";

function t(key, vars) {
  return i18n.t(key, vars);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function money(amountMinor, currency) {
  return i18n.formatMoney(amountMinor, currency, i18n.currencyDecimals);
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(pathname, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t("common.failed", { status: response.status }));
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
  document.querySelector("#headcount").textContent = t("desk.headcount", {
    members: String(site.members.length),
    guests: String(site.guestCount),
    people: String(site.headcount),
  });
  const people = document.querySelector("#people");
  people.replaceChildren();
  for (const member of site.members) {
    const block = document.createElement("article");
    block.className = "card";
    const title = document.createElement("h2");
    title.textContent = member.displayName;
    const meta = document.createElement("p");
    meta.className = "note";
    meta.textContent = t("desk.meta", {
      type: member.membershipType,
      credential: member.credentialType,
      guests: String(member.guestCount),
    });
    block.append(title, meta);
    if (member.hasPhoto) {
      const image = document.createElement("img");
      image.alt = t("desk.photoAlt");
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
    button.textContent = t("desk.checkout");
    button.addEventListener("click", async () => {
      await api(`/api/staff/checkins/${member.checkinId}/checkout`, { method: "POST" });
      await refresh();
    });
    const charge = document.createElement("button");
    charge.type = "button";
    charge.className = "secondary";
    charge.textContent = t("desk.chargeMember");
    charge.addEventListener("click", () => {
      document.querySelector("#charge-form").elements.memberId.value = member.memberId;
      document.querySelector("#charge-form").elements.memberId.focus();
    });
    block.append(button, charge);
    people.append(block);
  }
  const list = document.querySelector("#bookings");
  list.replaceChildren();
  for (const booking of bookings.bookings) {
    const line = document.createElement("p");
    const names = booking.players.map((player) => player.displayName || player.email || t("desk.player")).join(", ");
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

document.querySelector("#charge-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const body = {
    memberId: String(data.get("memberId") || "").trim(),
    description: String(data.get("description") || "").trim(),
    amountMinor: Number(data.get("amountMinor")),
  };
  const guestId = String(data.get("guestId") || "").trim();
  const requestId = String(data.get("requestId") || "").trim();
  if (guestId) body.guestId = guestId;
  if (requestId) body.requestId = requestId;
  try {
    const result = await api("/api/staff/tabs/charges", { method: "POST", body: JSON.stringify(body) });
    writeCharge(result);
    form.elements.description.value = "";
    form.elements.amountMinor.value = "";
    form.elements.requestId.value = "";
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#lookup-tab").addEventListener("click", async () => {
  const memberId = document.querySelector("#charge-form").elements.memberId.value.trim();
  try {
    const result = await api(`/api/staff/members/${encodeURIComponent(memberId)}/tab`);
    writeCharge({ balance: result.balance, entry: null, idempotentReplay: false });
  } catch (error) {
    setStatus(error.message);
  }
});

function writeCharge(result) {
  const balance = result.balance;
  const allowance = balance.allowance
    ? t("desk.allowanceLeft", { amount: String(balance.allowance.remainingMinor) })
    : t("desk.noAllowance");
  const posted = result.entry
    ? `${result.idempotentReplay ? t("desk.alreadyPosted") : t("desk.posted")}${t("desk.allowanceTab", {
        allowance: String(result.entry.allowanceMinor),
        tab: String(result.entry.tabMinor),
      })}`
    : "";
  const frozen = balance.tab.frozen ? t("desk.frozen") : "";
  document.querySelector("#charge-result").textContent = `${posted}${allowance} ${t("desk.owed", {
    minor: String(balance.tab.openMinor),
    major: money(balance.tab.openMinor, balance.currency),
  })}${frozen}`;
  setStatus("");
}

if (token) {
  document.querySelector("#token").value = token;
  refresh().catch((error) => setStatus(error.message));
}
