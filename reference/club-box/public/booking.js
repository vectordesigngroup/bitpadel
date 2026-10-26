// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import {
  addCivilDays,
  buildSchedule,
  chipLabel,
  civilDate,
  dayAriaLabel,
  dayBoundsIso,
  durationChoices,
  durationMinutesOf,
  formatClock,
  formatDuration,
  formatPrice,
  formatTimeRange,
  formatYmdHeading,
  monthBoundsIso,
  monthMatrix,
  monthOf,
  monthTitle,
  openDayCounts,
  priceLabel,
  rangeMidpoint,
  shiftMonth,
  shouldSplitSlotPage,
  sportChoices,
  sportOf,
  stateLabel,
  upcomingDays,
  weekdayHeaders,
} from "./booking-schedule.js";

const statusEl = document.querySelector("#status");
const scheduleEl = document.querySelector("#schedule");
const calendarEl = document.querySelector("#calendar");
const chipsEl = document.querySelector("#day-chips");
const invoiceEl = document.querySelector("#invoice");
const sheetEl = document.querySelector("#slot-sheet");
const mobileQuery = window.matchMedia("(max-width: 719px)");

const view = {
  health: null,
  courts: [],
  timeZone: "UTC",
  decimals: 0,
  todayYmd: "",
  visibleMonth: { year: 1970, month: 1 },
  selectedYmd: "",
  monthSlots: [],
  daySlots: [],
  dayTruncated: false,
  duration: "",
  sport: "",
  courtId: "",
  selectedSlot: null,
};

let pollTimer = 0;
let dayRequest = 0;
let monthRequest = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function fetchSlotRange(fromIso, toIso) {
  const params = new URLSearchParams({ from: fromIso, to: toIso });
  const data = await getJson(`/api/slots?${params}`);
  const slots = Array.isArray(data.slots) ? data.slots : [];
  const span = Date.parse(toIso) - Date.parse(fromIso);
  if (!shouldSplitSlotPage(slots.length, span)) {
    return { slots, truncated: slots.length >= 500 && span <= 60 * 60 * 1000 };
  }
  const mid = rangeMidpoint(fromIso, toIso);
  if (!mid) return { slots, truncated: true };
  const [left, right] = await Promise.all([fetchSlotRange(fromIso, mid), fetchSlotRange(mid, toIso)]);
  return {
    slots: left.slots.concat(right.slots),
    truncated: left.truncated || right.truncated,
  };
}

function addPaymentMethods(providers) {
  const payWith = document.querySelector("#pay-with");
  for (const name of providers) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "method";
    input.value = name;
    label.append(input, document.createTextNode(name === "stripe" ? " Card (Stripe)" : " Card (Square)"));
    payWith.append(label);
  }
}

function fillCourtFilter() {
  const label = document.querySelector("#court-filter-label");
  const select = document.querySelector("#court-filter");
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All courts";
  select.append(all);
  for (const court of view.courts) {
    const option = document.createElement("option");
    option.value = court.id;
    option.textContent = court.name;
    select.append(option);
  }
  label.hidden = view.courts.length < 2;
}

function fillSportFilter() {
  const label = document.querySelector("#sport-filter-label");
  const select = document.querySelector("#sport-filter");
  const sports = sportChoices(view.courts);
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All sports";
  select.append(all);
  for (const sport of sports) {
    const option = document.createElement("option");
    option.value = sport;
    option.textContent = sport;
    select.append(option);
  }
  label.hidden = sports.length < 2;
}

function slotsForFilters() {
  return view.daySlots.filter((slot) => {
    if (view.courtId && slot.courtId !== view.courtId) return false;
    if (view.sport && sportOf(slot.courtName) !== view.sport) return false;
    return true;
  });
}

function fillDurationFilter() {
  const select = document.querySelector("#duration-filter");
  const previous = view.duration;
  const choices = durationChoices(slotsForFilters());
  select.replaceChildren();
  const any = document.createElement("option");
  any.value = "";
  any.textContent = "Any length";
  select.append(any);
  for (const minutes of choices) {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = formatDuration(minutes);
    select.append(option);
  }
  const keep = choices.some((minutes) => String(minutes) === previous);
  view.duration = keep ? previous : "";
  select.value = view.duration;
  select.disabled = choices.length < 2;
}

function openCounts() {
  const slots = view.monthSlots.filter((slot) => {
    if (view.courtId && slot.courtId !== view.courtId) return false;
    if (view.sport && sportOf(slot.courtName) !== view.sport) return false;
    if (view.duration && durationMinutesOf(slot) !== Number(view.duration)) return false;
    return true;
  });
  return openDayCounts(slots, view.timeZone, Date.now());
}

function renderChips() {
  const focused = document.activeElement instanceof HTMLElement && chipsEl.contains(document.activeElement)
    ? document.activeElement.dataset.date ?? ""
    : "";
  chipsEl.replaceChildren();
  for (const ymd of upcomingDays(view.todayYmd, 7)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.date = ymd;
    button.textContent = chipLabel(ymd, view.todayYmd);
    button.setAttribute("aria-pressed", ymd === view.selectedYmd ? "true" : "false");
    button.addEventListener("click", () => selectDay(ymd));
    chipsEl.append(button);
  }
  if (focused) chipsEl.querySelector(`[data-date="${focused}"]`)?.focus();
}

function renderCalendar() {
  const focused = document.activeElement instanceof HTMLElement && calendarEl.contains(document.activeElement)
    ? document.activeElement.dataset.date ?? ""
    : "";
  const counts = openCounts();
  const { year, month } = view.visibleMonth;
  document.querySelector("#cal-title").textContent = monthTitle(year, month);
  calendarEl.replaceChildren();
  const header = document.createElement("div");
  header.role = "row";
  for (const weekday of weekdayHeaders()) {
    const cell = document.createElement("div");
    cell.role = "columnheader";
    cell.textContent = weekday.shortLabel;
    cell.setAttribute("aria-label", weekday.longLabel);
    header.append(cell);
  }
  calendarEl.append(header);
  for (const week of monthMatrix(year, month)) {
    const row = document.createElement("div");
    row.role = "row";
    for (const cell of week) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "gridcell";
      button.className = "booking-day";
      button.dataset.date = cell.ymd;
      if (!cell.inMonth) button.classList.add("is-outside");
      if (cell.ymd === view.todayYmd) button.classList.add("is-today");
      const selected = cell.ymd === view.selectedYmd;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = -1;
      const count = counts.get(cell.ymd) ?? 0;
      button.setAttribute("aria-label", dayAriaLabel(cell.ymd, count));
      const number = document.createElement("span");
      number.textContent = String(Number(cell.ymd.slice(8, 10)));
      button.append(number);
      if (count > 0) {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.setAttribute("aria-hidden", "true");
        button.append(dot);
        button.classList.add("has-open");
      }
      button.addEventListener("click", () => selectDay(cell.ymd));
      row.append(button);
    }
    calendarEl.append(row);
  }
  const selectedButton = calendarEl.querySelector(`[data-date="${view.selectedYmd}"]`);
  const tabStop = selectedButton instanceof HTMLElement
    ? selectedButton
    : calendarEl.querySelector(".booking-day");
  if (tabStop instanceof HTMLElement) tabStop.tabIndex = 0;
  if (focused) calendarEl.querySelector(`[data-date="${focused}"]`)?.focus();
}

function currentSchedule() {
  return buildSchedule({
    slots: view.daySlots,
    courts: view.courts,
    nowMs: Date.now(),
    durationMinutes: view.duration ? Number(view.duration) : 0,
    sport: view.sport,
    courtId: view.courtId,
  });
}

function stateText(cell) {
  if (cell.state === "continued" && cell.slot) return `Until ${formatClock(cell.slot.endsAt, view.timeZone)}`;
  return stateLabel(cell.state);
}

function slotButtonLabel(slot) {
  const when = formatTimeRange(slot.startsAt, slot.endsAt, view.timeZone);
  const length = formatDuration(durationMinutesOf(slot));
  return `${slot.courtName}, ${when}, ${length}, ${priceLabel(slot, view.decimals)}, open`;
}

function appendPrice(parent, slot) {
  const guest = slot.guestPriceMinor ?? slot.priceMinor;
  const member = slot.memberPriceMinor ?? guest;
  const guestLine = document.createElement("span");
  guestLine.textContent = formatPrice(guest, slot.currency, view.decimals);
  parent.append(guestLine);
  if (guest !== member) {
    const memberLine = document.createElement("span");
    memberLine.className = "booking-member";
    memberLine.textContent = `Member ${formatPrice(member, slot.currency, view.decimals)}`;
    parent.append(memberLine);
  }
}

function renderSchedule() {
  fillDurationFilter();
  const heading = document.querySelector("#day-heading");
  heading.textContent = view.selectedYmd ? formatYmdHeading(view.selectedYmd, view.timeZone) : "";
  const note = document.querySelector("#schedule-note");
  if (view.dayTruncated) {
    note.hidden = false;
    note.textContent = "This day has more times than the page can load. Ask the club if a time you need is missing.";
  } else {
    note.hidden = true;
    note.textContent = "";
  }
  scheduleEl.replaceChildren();
  const schedule = currentSchedule();
  if (view.daySlots.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No times on this day. Pick another date.";
    scheduleEl.append(empty);
    return;
  }
  if (schedule.rows.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No times match these filters.";
    scheduleEl.append(empty);
    return;
  }
  if (mobileQuery.matches) renderList(schedule);
  else renderGrid(schedule);
}

function renderGrid(schedule) {
  const wrap = document.createElement("div");
  wrap.className = "booking-grid-wrap";
  const grid = document.createElement("div");
  grid.className = "booking-grid";
  grid.role = "grid";
  grid.setAttribute("aria-labelledby", "day-heading");
  grid.style.setProperty("--courts", String(schedule.courts.length));
  const head = document.createElement("div");
  head.role = "row";
  head.className = "booking-grid-head";
  const timeHead = document.createElement("div");
  timeHead.role = "columnheader";
  timeHead.textContent = "Time";
  head.append(timeHead);
  for (const court of schedule.courts) {
    const cell = document.createElement("div");
    cell.role = "columnheader";
    cell.className = "booking-court-name";
    cell.textContent = court.name;
    head.append(cell);
  }
  grid.append(head);
  for (const row of schedule.rows) {
    const line = document.createElement("div");
    line.role = "row";
    const time = document.createElement("div");
    time.role = "rowheader";
    time.className = "booking-time";
    time.textContent = formatClock(row.startsAt, view.timeZone);
    line.append(time);
    for (const cell of row.cells) line.append(gridCell(cell, row.startsAt));
    grid.append(line);
  }
  wrap.append(grid);
  scheduleEl.append(wrap);
}

function gridCell(cell, startsAt) {
  const item = document.createElement("div");
  item.role = "gridcell";
  if (!cell.slot || cell.state === "empty") {
    item.setAttribute("aria-label", `${cell.court.name}, ${formatClock(startsAt, view.timeZone)}, not offered`);
    const dash = document.createElement("span");
    dash.className = "booking-state is-empty";
    dash.textContent = "—";
    dash.setAttribute("aria-hidden", "true");
    item.append(dash);
    return item;
  }
  if (cell.state === "open") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "booking-slot";
    button.setAttribute("aria-label", slotButtonLabel(cell.slot));
    appendPrice(button, cell.slot);
    button.addEventListener("click", () => openSheet(cell.slot));
    item.append(button);
    return item;
  }
  const label = stateText(cell);
  item.setAttribute(
    "aria-label",
    `${cell.court.name}, ${formatTimeRange(cell.slot.startsAt, cell.slot.endsAt, view.timeZone)}, ${label}`,
  );
  const state = document.createElement("span");
  state.className = `booking-state is-${cell.state}`;
  state.textContent = label;
  item.append(state);
  return item;
}

function renderList(schedule) {
  const list = document.createElement("div");
  list.className = "booking-groups";
  for (const row of schedule.rows) {
    const group = document.createElement("div");
    group.className = "booking-group";
    const title = document.createElement("h3");
    const slots = row.cells.map((cell) => cell.slot).filter((slot) => slot !== null);
    title.textContent = groupHeading(slots, row.startsAt);
    const items = document.createElement("ul");
    items.className = "booking-list";
    for (const cell of row.cells) {
      if (!cell.slot || cell.state === "empty") continue;
      items.append(listItem(cell));
    }
    group.append(title, items);
    list.append(group);
  }
  scheduleEl.append(list);
}

function groupHeading(slots, startsAt) {
  const ends = new Set(slots.map((slot) => slot.endsAt));
  if (ends.size === 1 && slots[0]) return formatTimeRange(slots[0].startsAt, slots[0].endsAt, view.timeZone);
  return formatClock(startsAt, view.timeZone);
}

function listItem(cell) {
  const item = document.createElement("li");
  const slot = cell.slot;
  if (cell.state === "open") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "booking-list-item is-open";
    button.setAttribute("aria-label", slotButtonLabel(slot));
    button.append(listBody(slot, "Open"));
    button.addEventListener("click", () => openSheet(slot));
    item.append(button);
    return item;
  }
  const row = document.createElement("div");
  row.className = `booking-list-item is-${cell.state}`;
  if (cell.state === "continued") {
    const name = document.createElement("span");
    name.className = "booking-list-court";
    name.textContent = slot.courtName;
    const state = document.createElement("span");
    state.className = "booking-list-state";
    state.textContent = stateText(cell);
    row.append(name, state);
  } else {
    row.append(listBody(slot, stateText(cell)));
  }
  item.append(row);
  return item;
}

function listBody(slot, label) {
  const fragment = document.createDocumentFragment();
  const name = document.createElement("span");
  name.className = "booking-list-court";
  name.textContent = slot.courtName;
  const meta = document.createElement("span");
  meta.className = "booking-list-meta";
  meta.textContent = formatDuration(durationMinutesOf(slot));
  const price = document.createElement("span");
  price.className = "booking-list-price";
  appendPrice(price, slot);
  const state = document.createElement("span");
  state.className = "booking-list-state";
  state.textContent = label;
  fragment.append(name, meta, price, state);
  return fragment;
}

function selectDay(ymd) {
  view.selectedYmd = ymd;
  const nextMonth = monthOf(ymd);
  const changed = nextMonth.year !== view.visibleMonth.year || nextMonth.month !== view.visibleMonth.month;
  view.visibleMonth = nextMonth;
  renderChips();
  renderCalendar();
  if (changed) void refreshMonth();
  void loadDay();
}

function shiftVisibleMonth(delta) {
  view.visibleMonth = shiftMonth(view.visibleMonth.year, view.visibleMonth.month, delta);
  renderCalendar();
  void refreshMonth();
}

async function refreshMonth() {
  const request = ++monthRequest;
  const { year, month } = view.visibleMonth;
  try {
    const bounds = monthBoundsIso(year, month, view.timeZone);
    const result = await fetchSlotRange(bounds.from, bounds.to);
    if (request !== monthRequest) return;
    if (year !== view.visibleMonth.year || month !== view.visibleMonth.month) return;
    view.monthSlots = result.slots;
    renderCalendar();
  } catch (error) {
    if (request !== monthRequest) return;
    setStatus(error.message);
  }
}

async function loadDay() {
  const request = ++dayRequest;
  const ymd = view.selectedYmd;
  scheduleEl.replaceChildren();
  scheduleEl.setAttribute("aria-busy", "true");
  const loading = document.createElement("p");
  loading.textContent = "Loading times…";
  scheduleEl.append(loading);
  try {
    const bounds = dayBoundsIso(ymd, view.timeZone);
    const result = await fetchSlotRange(bounds.from, bounds.to);
    if (request !== dayRequest) return;
    view.daySlots = result.slots;
    view.dayTruncated = result.truncated;
    scheduleEl.setAttribute("aria-busy", "false");
    renderSchedule();
  } catch (error) {
    if (request !== dayRequest) return;
    scheduleEl.setAttribute("aria-busy", "false");
    scheduleEl.replaceChildren();
    const failed = document.createElement("p");
    failed.textContent = error.message;
    scheduleEl.append(failed);
    setStatus(error.message);
  }
}

function firstOpenDay() {
  const counts = openDayCounts(view.monthSlots, view.timeZone, Date.now());
  if ((counts.get(view.selectedYmd) ?? 0) > 0) return view.selectedYmd;
  for (const ymd of upcomingDays(view.todayYmd, 62)) {
    if ((counts.get(ymd) ?? 0) > 0) return ymd;
  }
  return view.selectedYmd;
}

function openSheet(slot) {
  view.selectedSlot = slot;
  document.querySelector("#sheet-court").textContent = slot.courtName;
  const length = formatDuration(durationMinutesOf(slot));
  document.querySelector("#sheet-when").textContent = `${formatYmdHeading(civilDate(new Date(slot.startsAt), view.timeZone), view.timeZone)} · ${formatTimeRange(slot.startsAt, slot.endsAt, view.timeZone)} · ${length}`;
  const price = document.querySelector("#sheet-price");
  price.replaceChildren();
  const guest = slot.guestPriceMinor ?? slot.priceMinor;
  const member = slot.memberPriceMinor ?? guest;
  if (guest === member) {
    const line = document.createElement("p");
    line.textContent = formatPrice(guest, slot.currency, view.decimals);
    price.append(line);
  } else {
    const guestLine = document.createElement("p");
    guestLine.textContent = `You pay ${formatPrice(guest, slot.currency, view.decimals)}`;
    const memberLine = document.createElement("p");
    memberLine.textContent = `Member price ${formatPrice(member, slot.currency, view.decimals)}`;
    const memberNote = document.createElement("p");
    memberNote.className = "note";
    memberNote.textContent = "The member price applies when you are logged in on your bookings.";
    price.append(guestLine, memberLine, memberNote);
  }
  const minutes = view.health?.holdMinutes;
  document.querySelector("#sheet-hold-note").textContent = minutes
    ? `We'll hold this time for ${minutes} minutes while you pay.`
    : "We'll hold this time while you pay.";
  document.querySelector("#hold-button").disabled = false;
  sheetEl.showModal();
}

async function hold(event) {
  event.preventDefault();
  const slot = view.selectedSlot;
  const button = document.querySelector("#hold-button");
  if (!slot) return;
  button.disabled = true;
  setStatus("Holding the slot…");
  try {
    const data = await getJson("/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slotId: slot.id,
        method: document.querySelector("input[name=method]:checked")?.value || "lightning",
        receiptEmail: document.querySelector("#receipt-email").value.trim() || undefined,
        reminderEmail: document.querySelector("#reminder-email").checked,
        reminderSms: document.querySelector("#reminder-sms").checked,
        reminderPhone: document.querySelector("#reminder-phone").value.trim() || undefined,
      }),
    });
    sheetEl.close();
    showInvoice(data.hold);
  } catch (error) {
    setStatus(error.message);
    button.disabled = false;
  }
}

function showInvoice(hold) {
  setStatus("");
  invoiceEl.hidden = false;
  const card = hold.paymentMethod === "stripe" || hold.paymentMethod === "square";
  document.querySelector("#invoice-qr").hidden = card;
  if (!card) {
    document.querySelector("#invoice-qr").src = `/api/holds/${hold.id}/qr.png`;
    document.querySelector("#invoice-qr").alt = hold.payable ? "Lightning invoice QR" : "Mock invoice QR, not payable";
  }
  document.querySelector("#invoice-amount").textContent = formatPrice(hold.amountMinor, hold.currency, view.decimals);
  document.querySelector("#bolt11").textContent = card ? hold.checkoutUrl || "" : hold.bolt11;
  document.querySelector("#invoice-title").textContent = card ? "Card checkout" : "Lightning invoice";
  document.querySelector("#invoice-note").textContent = card
    ? "Continue on the card provider's page. The booking confirms when their webhook arrives. Test mode does not charge a real card."
    : hold.payable
      ? "Pay this invoice from a Lightning wallet. The booking confirms when the payment settles."
      : "Mock backend: this invoice cannot be paid. Confirm it from the admin page. A real BTCPay or LNbits backend replaces this.";
  invoiceEl.scrollIntoView({ block: "nearest" });
  poll(hold.id);
}

async function poll(holdId) {
  window.clearInterval(pollTimer);
  const tick = async () => {
    try {
      const data = await getJson(`/api/holds/${holdId}`);
      const held = data.hold;
      if (held.status === "paid") {
        document.querySelector("#invoice-status").textContent = "Booked. Payment settled.";
        window.clearInterval(pollTimer);
        await Promise.all([loadDay(), refreshMonth()]);
        return;
      }
      if (held.status === "expired" || held.status === "released") {
        document.querySelector("#invoice-status").textContent = "The hold expired and the slot was released.";
        window.clearInterval(pollTimer);
        await Promise.all([loadDay(), refreshMonth()]);
        return;
      }
      document.querySelector("#invoice-status").textContent = `Waiting for payment until ${formatClock(held.expiresAt, view.timeZone)}.`;
    } catch (error) {
      document.querySelector("#invoice-status").textContent = error.message;
    }
  };
  await tick();
  pollTimer = window.setInterval(tick, 2000);
}

function onCalendarKey(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.dataset.date) return;
  if (event.key === "PageUp" || event.key === "PageDown") {
    event.preventDefault();
    shiftVisibleMonth(event.key === "PageUp" ? -1 : 1);
    return;
  }
  const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[event.key];
  if (!delta) return;
  event.preventDefault();
  const next = addCivilDays(target.dataset.date, delta);
  const month = monthOf(next);
  const changed = month.year !== view.visibleMonth.year || month.month !== view.visibleMonth.month;
  if (changed) {
    view.visibleMonth = month;
    renderCalendar();
    void refreshMonth();
  }
  const button = calendarEl.querySelector(`[data-date="${next}"]`);
  if (button instanceof HTMLElement) {
    for (const day of calendarEl.querySelectorAll(".booking-day")) day.tabIndex = -1;
    button.tabIndex = 0;
    button.focus();
  }
}

async function load() {
  view.health = await getJson("/api/health");
  view.timeZone = view.health.clubTimeZone || "UTC";
  view.decimals = Number.isInteger(view.health.currencyDecimals) ? view.health.currencyDecimals : 0;
  addPaymentMethods(view.health.cardProviders || []);
  const courts = await getJson("/api/courts");
  view.courts = courts.courts || [];
  view.todayYmd = civilDate(new Date(), view.timeZone);
  view.selectedYmd = view.todayYmd;
  view.visibleMonth = monthOf(view.todayYmd);
  document.querySelector("#tz-note").textContent = `Times shown in club time (${view.timeZone.replaceAll("_", " ")}).`;
  fillCourtFilter();
  fillSportFilter();
  renderChips();
  await refreshMonth();
  const landing = firstOpenDay();
  if (landing !== view.selectedYmd) {
    view.selectedYmd = landing;
    const month = monthOf(landing);
    const changed = month.year !== view.visibleMonth.year || month.month !== view.visibleMonth.month;
    view.visibleMonth = month;
    if (changed) await refreshMonth();
  }
  renderChips();
  renderCalendar();
  await loadDay();
}

document.querySelector("#cal-prev").addEventListener("click", () => shiftVisibleMonth(-1));
document.querySelector("#cal-next").addEventListener("click", () => shiftVisibleMonth(1));
document.querySelector("#duration-filter").addEventListener("change", (event) => {
  view.duration = event.target.value;
  renderCalendar();
  renderSchedule();
});
document.querySelector("#court-filter").addEventListener("change", (event) => {
  view.courtId = event.target.value;
  renderCalendar();
  renderSchedule();
});
document.querySelector("#sport-filter").addEventListener("change", (event) => {
  view.sport = event.target.value;
  renderCalendar();
  renderSchedule();
});
document.querySelector("#slot-form").addEventListener("submit", (event) => {
  void hold(event);
});
document.querySelector("#sheet-close").addEventListener("click", () => sheetEl.close());
sheetEl.addEventListener("close", () => {
  document.querySelector("#hold-button").disabled = false;
});
calendarEl.addEventListener("keydown", onCalendarKey);
mobileQuery.addEventListener("change", () => {
  if (view.selectedYmd) renderSchedule();
});

load().catch((error) => setStatus(error.message));
