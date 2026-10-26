// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
const i18n = window.clubI18n;
let email = sessionStorage.getItem("club-player-email") || "";

function t(key, vars) {
  return i18n.t(key, vars);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function money(amountMinor, currency) {
  return i18n.formatMoney(amountMinor, currency, i18n.currencyDecimals);
}

function periodName(period) {
  const key = `account.period.${period}`;
  const label = t(key);
  return label === key ? String(period) : label;
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(pathname, { ...options, headers, credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(window.clubI18n.errorText(body, response.status));
    error.code = body.code || "";
    throw error;
  }
  return body;
}

document.querySelector("#code-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  email = event.currentTarget.email.value.trim();
  sessionStorage.setItem("club-player-email", email);
  try {
    await api("/api/player/code", { method: "POST", body: JSON.stringify({ email }) });
    setStatus(t("account.codeSent"));
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
  if (data.upcoming.length === 0) upcoming.textContent = t("account.noneUpcoming");
  for (const booking of data.upcoming) {
    const block = document.createElement("article");
    block.className = "slot";
    const title = document.createElement("h3");
    title.textContent = booking.courtName;
    const when = document.createElement("p");
    when.textContent = t("account.whenLine", {
      when: i18n.formatDateTime(booking.startsAt),
      method: booking.paymentMethod,
      amount: money(booking.amountMinor, booking.currency),
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = t("account.cancel");
    cancel.addEventListener("click", async () => {
      try {
        const result = await api(`/api/player/bookings/${booking.id}/cancel`, { method: "POST" });
        setStatus(
          result.refundStatus
            ? t("account.cancelledRefund", { status: result.refundStatus })
            : t("account.cancelled"),
        );
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
  if (data.past.length === 0) past.textContent = t("account.nonePast");
  for (const booking of data.past) {
    const line = document.createElement("p");
    const key = booking.cancelledAt ? "account.pastCancelled" : "account.pastLine";
    line.textContent = t(key, { court: booking.courtName, when: i18n.formatDateTime(booking.startsAt) });
    past.append(line);
  }
  setStatus(
    t("account.loggedIn", {
      email: data.player.email,
      hours: String(data.cancelWindowHours),
      refund: data.cancelRefund,
    }),
  );
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
      option.textContent = method === "lightning" ? t("booking.lightning") : method === "stripe" ? t("booking.cardStripe") : method === "square" ? t("booking.cardSquare") : method;
      option.selected = method === chosen;
      select.append(option);
    }
    const data = await api("/api/player/tab");
    section.hidden = false;
    const balance = data.balance;
    const allowance = balance.allowance
      ? t("account.allowanceLeft", {
          remaining: money(balance.allowance.remainingMinor, balance.currency),
          configured: money(balance.allowance.configuredMinor, balance.currency),
          period: periodName(balance.allowance.period),
        })
      : t("account.noAllowance");
    const frozen = balance.tab.frozen ? t("account.tabFrozen") : "";
    document.querySelector("#tab-summary").textContent = `${allowance} ${t("account.tabOwed", {
      amount: money(balance.tab.openMinor, balance.currency),
    })}${frozen}`;
    const lines = document.querySelector("#tab-lines");
    lines.replaceChildren();
    if (balance.recent.length === 0) {
      lines.textContent = t("account.noCharges");
    }
    for (const entry of balance.recent) {
      const line = document.createElement("p");
      const guest = entry.guestLabel ? t("account.forGuest", { name: entry.guestLabel }) : "";
      line.textContent = t("account.chargeLine", {
        when: i18n.formatDateTime(entry.at),
        description: entry.description,
        guest,
        amount: money(entry.tabMinor, entry.currency),
      });
      lines.append(line);
    }
    const waiting = balance.pendingMinor == null ? balance.tab.pendingMinor : balance.pendingMinor;
    const canSettle = !balance.tab.frozen && balance.tab.openMinor - waiting >= 1;
    document.querySelector("#settle-form").hidden = !canSettle;
    if (balance.tab.pendingMinor > 0) {
      const waitingLine = document.createElement("p");
      waitingLine.textContent = t("account.paymentWaiting", {
        amount: money(balance.tab.pendingMinor, balance.currency),
      });
      lines.append(waitingLine);
    }
  } catch (error) {
    if (error.code === "errors.no-membership-is-linked-to-this-login") {
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
    const sats = settlement.amountSats == null ? "" : t("account.satsParen", { amount: i18n.formatSats(settlement.amountSats) });
    intro.textContent = t("account.payBefore", {
      amount: money(settlement.amountMinor, settlement.currency),
      sats,
      when: i18n.formatDateTime(settlement.expiresAt),
    });
    pay.append(intro);
    if (settlement.checkoutUrl) {
      const link = document.createElement("a");
      link.href = settlement.checkoutUrl;
      link.textContent = t("account.openCheckout");
      pay.append(link);
    } else {
      const invoice = document.createElement("span");
      invoice.textContent = settlement.bolt11;
      pay.append(invoice);
    }
    const check = document.createElement("button");
    check.type = "button";
    check.className = "secondary";
    check.textContent = t("account.checkPayment");
    check.addEventListener("click", async () => {
      try {
        const latest = await api(`/api/player/tab/settlements/${settlement.id}`);
        setStatus(latest.settlement.status === "paid" ? t("account.tabSettled") : t("account.paymentStatus", { status: latest.settlement.status }));
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
  setStatus(t("account.enterEmail"));
});
