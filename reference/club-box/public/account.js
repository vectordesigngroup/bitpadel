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
}

load().catch(() => {
  setStatus("Enter your email to get a code.");
});
