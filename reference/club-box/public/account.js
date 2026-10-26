// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
let email = sessionStorage.getItem("club-player-email") || "";

function setStatus(text) {
  statusEl.textContent = text;
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(pathname, { ...options, headers, credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

document.querySelector("#code-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  email = event.currentTarget.email.value.trim();
  sessionStorage.setItem("club-player-email", email);
  try {
    await api("/api/player/code", { method: "POST", body: JSON.stringify({ email }) });
    setStatus("Code sent. Check your email.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/player/session", {
      method: "POST",
      body: JSON.stringify({ email, code: event.currentTarget.code.value.trim() }),
    });
    await load();
  } catch (error) {
    setStatus(error.message);
  }
});

async function load() {
  const data = await api("/api/player/bookings");
  document.querySelector("#bookings").hidden = false;
  const upcoming = document.querySelector("#upcoming");
  upcoming.replaceChildren();
  if (data.upcoming.length === 0) upcoming.textContent = "No upcoming bookings.";
  for (const booking of data.upcoming) {
    const block = document.createElement("article");
    block.className = "slot";
    const title = document.createElement("h3");
    title.textContent = booking.courtName;
    const when = document.createElement("p");
    when.textContent = `${new Date(booking.startsAt).toLocaleString()} · ${booking.paymentMethod} · ${booking.amountMinor} ${booking.currency} minor units`;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Cancel booking";
    cancel.addEventListener("click", async () => {
      try {
        const result = await api(`/api/player/bookings/${booking.id}/cancel`, { method: "POST" });
        setStatus(result.refundStatus ? `Cancelled. Refund ${result.refundStatus}.` : "Cancelled.");
        await load();
      } catch (error) {
        setStatus(error.message);
      }
    });
    block.append(title, when, cancel);
    upcoming.append(block);
  }
  const past = document.querySelector("#past");
  past.replaceChildren();
  if (data.past.length === 0) past.textContent = "No past bookings.";
  for (const booking of data.past) {
    const line = document.createElement("p");
    line.textContent = `${booking.courtName} ${new Date(booking.startsAt).toLocaleString()}${booking.cancelledAt ? " cancelled" : ""}`;
    past.append(line);
  }
  setStatus(`Logged in as ${data.player.email}. Cancel at least ${data.cancelWindowHours} hours ahead. Refunds: ${data.cancelRefund}.`);
  await loadTab();
}

async function loadTab() {
  const section = document.querySelector("#tab");
  try {
    const health = await fetch("/api/health").then((response) => response.json());
    const select = document.querySelector("#settle-method");
    const chosen = select.value || "lightning";
    select.replaceChildren();
    const methods = ["lightning", ...(health.cardProviders || [])];
    for (const method of methods) {
      const option = document.createElement("option");
      option.value = method;
      option.textContent = method;
      option.selected = method === chosen;
      select.append(option);
    }
    const data = await api("/api/player/tab");
    section.hidden = false;
    const balance = data.balance;
    const allowance = balance.allowance
      ? `Allowance left: ${balance.allowance.remainingMinor} of ${balance.allowance.configuredMinor} minor units (${balance.allowance.remainingMajor} ${balance.currency}) for this ${balance.allowance.period}.`
      : "This membership has no allowance set.";
    document.querySelector("#tab-summary").textContent =
      `${allowance} Tab owed: ${balance.tab.openMinor} minor units (${balance.tab.openMajor} ${balance.currency}).${balance.tab.frozen ? " The tab is frozen. Ask the desk." : ""}`;
    const lines = document.querySelector("#tab-lines");
    lines.replaceChildren();
    if (balance.recent.length === 0) {
      lines.textContent = "No charges yet.";
    }
    for (const entry of balance.recent) {
      const line = document.createElement("p");
      const guest = entry.guestLabel ? ` for ${entry.guestLabel}` : "";
      line.textContent = `${new Date(entry.at).toLocaleString()} · ${entry.description}${guest} · tab ${entry.tabMinor} ${entry.currency} minor units`;
      lines.append(line);
    }
    const waiting = balance.pendingMinor == null ? balance.tab.pendingMinor : balance.pendingMinor;
    const canSettle = !balance.tab.frozen && balance.tab.openMinor - waiting >= 1;
    document.querySelector("#settle-form").hidden = !canSettle;
    if (balance.tab.pendingMinor > 0) {
      const waitingLine = document.createElement("p");
      waitingLine.textContent = `${balance.tab.pendingMinor} minor units already have a payment waiting.`;
      lines.append(waitingLine);
    }
  } catch (error) {
    if (String(error.message).includes("No membership")) {
      section.hidden = true;
      return;
    }
    setStatus(error.message);
  }
}

document.querySelector("#settle-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const method = new FormData(event.currentTarget).get("method");
  try {
    const result = await api("/api/player/tab/settle", {
      method: "POST",
      body: JSON.stringify({ method }),
    });
    const pay = document.querySelector("#tab-pay");
    pay.replaceChildren();
    const settlement = result.settlement;
    const intro = document.createElement("span");
    const sats = settlement.amountSats == null ? "" : ` (${settlement.amountSats} sats)`;
    intro.textContent = `Pay ${settlement.amountMinor} minor units${sats} before ${new Date(settlement.expiresAt).toLocaleString()}. `;
    pay.append(intro);
    if (settlement.checkoutUrl) {
      const link = document.createElement("a");
      link.href = settlement.checkoutUrl;
      link.textContent = "Open card checkout";
      pay.append(link);
    } else {
      const invoice = document.createElement("span");
      invoice.textContent = settlement.bolt11;
      pay.append(invoice);
    }
    const check = document.createElement("button");
    check.type = "button";
    check.className = "secondary";
    check.textContent = "Check payment";
    check.addEventListener("click", async () => {
      try {
        const latest = await api(`/api/player/tab/settlements/${settlement.id}`);
        setStatus(latest.settlement.status === "paid" ? "Tab payment settled." : `Payment is ${latest.settlement.status}.`);
        await loadTab();
      } catch (error) {
        setStatus(error.message);
      }
    });
    pay.append(check);
    await loadTab();
  } catch (error) {
    setStatus(error.message);
  }
});

load().catch(() => {
  setStatus("Enter your email to get a code.");
});
