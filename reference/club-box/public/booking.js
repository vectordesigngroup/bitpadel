const statusEl = document.querySelector("#status");
const slotsEl = document.querySelector("#slots");
const courtsEl = document.querySelector("#courts");
const invoiceEl = document.querySelector("#invoice");
let health = null;
let courtId = "";
let pollTimer = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function formatMinor(amount, currency, decimals) {
  let formatted = `${amount} ${currency} minor units`;
  try {
    formatted = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 10 ** decimals);
  } catch {
    formatted = `${amount} ${currency} minor units`;
  }
  return `${formatted} (${amount} minor units)`;
}

async function load() {
  health = await getJson("/api/health");
  const courts = await getJson("/api/courts");
  courtsEl.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.className = "secondary";
  all.textContent = "All courts";
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
    empty.textContent = "No slots yet. Add courts, times, and prices in admin.";
    slotsEl.append(empty);
    return;
  }
  for (const slot of data.slots) {
    const block = document.createElement("article");
    block.className = "slot";
    const title = document.createElement("h2");
    title.textContent = slot.courtName;
    const when = document.createElement("p");
    when.textContent = `${new Date(slot.startsAt).toLocaleString()} – ${new Date(slot.endsAt).toLocaleString()}`;
    const price = document.createElement("p");
    price.textContent = formatMinor(slot.priceMinor, slot.currency, health.currencyDecimals);
    const state = document.createElement("p");
    state.className = "note";
    state.textContent = slot.blocked ? "Imported booking covers this time" : slot.status;
    block.append(title, when, price, state);
    if (slot.status === "open" && !slot.blocked) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Hold and get invoice";
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
  heading.textContent = "Imported bookings";
  slotsEl.append(heading);
  for (const block of imported) {
    const row = document.createElement("article");
    row.className = "slot";
    const title = document.createElement("h2");
    title.textContent = block.courtName;
    const when = document.createElement("p");
    when.textContent = `${new Date(block.startsAt).toLocaleString()} – ${new Date(block.endsAt).toLocaleString()}`;
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = block.label;
    row.append(title, when, note);
    slotsEl.append(row);
  }
}

async function hold(slotId, button) {
  button.disabled = true;
  setStatus("Holding the slot…");
  try {
    const data = await getJson("/api/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slotId,
        receiptEmail: document.querySelector("#receipt-email").value.trim() || undefined,
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
  document.querySelector("#invoice-qr").src = `/api/holds/${hold.id}/qr.png`;
  document.querySelector("#invoice-qr").alt = hold.payable ? "Lightning invoice QR" : "Mock invoice QR, not payable";
  document.querySelector("#invoice-amount").textContent = formatMinor(hold.amountMinor, hold.currency, health.currencyDecimals);
  document.querySelector("#bolt11").textContent = hold.bolt11;
  document.querySelector("#invoice-note").textContent = hold.payable
    ? "Pay this invoice from a Lightning wallet. The booking confirms when the payment settles."
    : "Mock backend: this invoice cannot be paid. Confirm it from the admin page. A real BTCPay or LNbits backend replaces this.";
  poll(hold.id);
}

async function poll(holdId) {
  window.clearInterval(pollTimer);
  const tick = async () => {
    try {
      const data = await getJson(`/api/holds/${holdId}`);
      const hold = data.hold;
      if (hold.status === "paid") {
        document.querySelector("#invoice-status").textContent = "Booked. Payment settled.";
        window.clearInterval(pollTimer);
        await loadSlots();
        return;
      }
      if (hold.status === "expired" || hold.status === "released") {
        document.querySelector("#invoice-status").textContent = "The hold expired and the slot was released.";
        window.clearInterval(pollTimer);
        await loadSlots();
        return;
      }
      document.querySelector("#invoice-status").textContent = `Waiting for payment until ${new Date(hold.expiresAt).toLocaleTimeString()}.`;
    } catch (error) {
      document.querySelector("#invoice-status").textContent = error.message;
    }
  };
  await tick();
  pollTimer = window.setInterval(tick, 2000);
}

load().catch((error) => setStatus(error.message));
