// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
const slotsEl = document.querySelector("#slots");
const courtsEl = document.querySelector("#courts");
const invoiceEl = document.querySelector("#invoice");
const i18n = window.clubI18n;
let health = null;
let courtId = "";
let pollTimer = 0;

function t(key, vars) {
  return i18n.t(key, vars);
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t("common.failed", { status: response.status }));
  return body;
}

function money(amount, currency) {
  return i18n.formatMoney(amount, currency, health ? health.currencyDecimals : i18n.currencyDecimals);
}

function whenRange(startsAt, endsAt) {
  return `${i18n.formatDateTime(startsAt)} – ${i18n.formatDateTime(endsAt)}`;
}

function statusLabel(status) {
  const key = `booking.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

async function load() {
  health = await getJson("/api/health");
  const payWith = document.querySelector("#pay-with");
  for (const name of health.cardProviders || []) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "method";
    input.value = name;
    const text = document.createElement("span");
    text.textContent = name === "stripe" ? t("booking.cardStripe") : name === "square" ? t("booking.cardSquare") : name;
    label.append(input, document.createTextNode(" "), text);
    payWith.append(label);
  }
  const courts = await getJson("/api/courts");
  courtsEl.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.className = "secondary";
  all.textContent = t("booking.allCourts");
  all.addEventListener("click", () => {
    courtId = "";
    loadSlots();
  });
  courtsEl.append(all);
  for (const court of courts.courts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = court.name;
    button.addEventListener("click", () => {
      courtId = court.id;
      loadSlots();
    });
    courtsEl.append(button);
  }
  await loadSlots();
  await loadImported();
}

async function loadSlots() {
  const params = new URLSearchParams({ from: new Date().toISOString() });
  if (courtId) params.set("courtId", courtId);
  const data = await getJson(`/api/slots?${params}`);
  slotsEl.replaceChildren();
  if (data.slots.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = t("booking.empty");
    slotsEl.append(empty);
    return;
  }
  for (const slot of data.slots) {
    const block = document.createElement("article");
    block.className = "slot";
    const title = document.createElement("h2");
    title.textContent = slot.courtName;
    const when = document.createElement("p");
    when.textContent = whenRange(slot.startsAt, slot.endsAt);
    const price = document.createElement("p");
    const guest = slot.guestPriceMinor ?? slot.priceMinor;
    const member = slot.memberPriceMinor ?? guest;
    const guestMoney = money(guest, slot.currency);
    const memberMoney = money(member, slot.currency);
    price.textContent = guest === member ? guestMoney : t("booking.priceBoth", { guest: guestMoney, member: memberMoney });
    const state = document.createElement("p");
    state.className = "note";
    state.textContent = slot.blocked ? t("booking.importedCovers") : statusLabel(slot.status);
    block.append(title, when, price, state);
    if (slot.status === "open" && !slot.blocked) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("booking.hold");
      button.addEventListener("click", () => hold(slot.id, button));
      block.append(button);
    }
    slotsEl.append(block);
  }
}

async function loadImported() {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const data = await getJson(`/api/calendar?from=${encodeURIComponent(from)}`);
  const imported = data.blocks.filter(
    (block) => block.source === "playtomic" && new Date(block.endsAt).getTime() > Date.now(),
  );
  if (imported.length === 0) return;
  const heading = document.createElement("h2");
  heading.textContent = t("booking.importedHeading");
  slotsEl.append(heading);
  for (const block of imported) {
    const row = document.createElement("article");
    row.className = "slot";
    const title = document.createElement("h2");
    title.textContent = block.courtName;
    const when = document.createElement("p");
    when.textContent = whenRange(block.startsAt, block.endsAt);
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = block.label;
    row.append(title, when, note);
    slotsEl.append(row);
  }
}

async function hold(slotId, button) {
  button.disabled = true;
  setStatus(t("booking.holding"));
  try {
    const data = await getJson("/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slotId,
        method: document.querySelector("input[name=method]:checked")?.value || "lightning",
        receiptEmail: document.querySelector("#receipt-email").value.trim() || undefined,
        reminderEmail: document.querySelector("#reminder-email").checked,
        reminderSms: document.querySelector("#reminder-sms").checked,
        reminderPhone: document.querySelector("#reminder-phone").value.trim() || undefined,
      }),
    });
    showInvoice(data.hold);
  } catch (error) {
    setStatus(error.message);
    button.disabled = false;
  }
}

function showInvoice(hold) {
  invoiceEl.hidden = false;
  const card = hold.paymentMethod === "stripe" || hold.paymentMethod === "square";
  document.querySelector("#invoice-qr").hidden = card;
  if (!card) {
    document.querySelector("#invoice-qr").src = `/api/holds/${hold.id}/qr.png`;
    document.querySelector("#invoice-qr").alt = hold.payable ? t("booking.qrAltLightning") : t("booking.qrAltMock");
  }
  document.querySelector("#invoice-amount").textContent = money(hold.amountMinor, hold.currency);
  document.querySelector("#bolt11").textContent = card ? hold.checkoutUrl || "" : hold.bolt11;
  document.querySelector("#invoice-title").textContent = card ? t("booking.cardTitle") : t("booking.invoiceTitle");
  document.querySelector("#invoice-note").textContent = card
    ? t("booking.cardNote")
    : hold.payable
      ? t("booking.payNote")
      : t("booking.mockNote");
  poll(hold.id);
}

async function poll(holdId) {
  window.clearInterval(pollTimer);
  const tick = async () => {
    try {
      const data = await getJson(`/api/holds/${holdId}`);
      const hold = data.hold;
      if (hold.status === "paid") {
        document.querySelector("#invoice-status").textContent = t("booking.paid");
        window.clearInterval(pollTimer);
        await loadSlots();
        return;
      }
      if (hold.status === "expired" || hold.status === "released") {
        document.querySelector("#invoice-status").textContent = t("booking.expired");
        window.clearInterval(pollTimer);
        await loadSlots();
        return;
      }
      document.querySelector("#invoice-status").textContent = t("booking.waiting", {
        time: i18n.formatTime(hold.expiresAt),
      });
    } catch (error) {
      document.querySelector("#invoice-status").textContent = error.message;
    }
  };
  await tick();
  pollTimer = window.setInterval(tick, 2000);
}

load().catch((error) => setStatus(error.message));
