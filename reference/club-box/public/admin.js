const statusEl = document.querySelector("#status");
const appEl = document.querySelector("#app");
let token = sessionStorage.getItem("club-box-admin-token") || "";
let config = null;

function setStatus(text) {
  statusEl.textContent = text;
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(pathname, { ...options, headers });
  if (pathname.endsWith(".csv")) {
    if (!response.ok) throw new Error("Could not download bookings");
    return response.text();
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

document.querySelector("#login").addEventListener("submit", (event) => {
  event.preventDefault();
  token = document.querySelector("#token").value.trim();
  sessionStorage.setItem("club-box-admin-token", token);
  refresh().catch((error) => setStatus(error.message));
});

document.querySelector("#csv").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const csv = await api("/api/admin/bookings.csv");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bookings.csv";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#court-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/courts", { method: "POST", body: JSON.stringify({ name: new FormData(form).get("name") }) });
    form.reset();
    await refresh();
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#slot-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const priceMinor = Number(data.get("priceMinor"));
  try {
    await api("/api/admin/slots", {
      method: "POST",
      body: JSON.stringify({
        courtId: data.get("courtId"),
        startsAt: new Date(data.get("startsAt")).toISOString(),
        endsAt: new Date(data.get("endsAt")).toISOString(),
        priceMinor,
      }),
    });
    form.elements.priceMinor.value = "";
    await refresh();
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/members", {
      method: "POST",
      body: JSON.stringify({ label: new FormData(form).get("label") }),
    });
    form.reset();
    await refresh();
  } catch (error) {
    setStatus(error.message);
  }
});

async function refresh() {
  config = await api("/api/admin/config");
  appEl.hidden = false;
  document.querySelector("#server").textContent =
    `${config.currency} with ${config.currencyDecimals} decimal digits. Payments: ${config.paymentBackend}. Door: ${config.doorBackend}. ${config.entryGuidance}`;
  const courts = await api("/api/admin/courts");
  const select = document.querySelector("#slot-form select");
  select.replaceChildren();
  for (const court of courts.courts.filter((court) => court.active)) {
    const option = document.createElement("option");
    option.value = court.id;
    option.textContent = court.name;
    select.append(option);
  }
  const slots = await api(`/api/admin/slots?from=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`);
  renderSlots(slots.slots);
  const members = await api("/api/admin/members");
  renderMembers(members.members);
  const bookings = await api("/api/admin/bookings");
  renderBookings(bookings.bookings);
  const audit = await api("/api/admin/audit?limit=20");
  renderAudit(audit.audit);
  setStatus("");
}

function renderSlots(slots) {
  const root = document.querySelector("#slots");
  root.replaceChildren();
  if (slots.length === 0) {
    root.textContent = "No slots in this window.";
    return;
  }
  for (const slot of slots) {
    const block = document.createElement("article");
    block.className = "slot";
    const title = document.createElement("h3");
    title.textContent = `${slot.courtName} · ${slot.status}`;
    const when = document.createElement("p");
    when.textContent = `${new Date(slot.startsAt).toLocaleString()} – ${new Date(slot.endsAt).toLocaleString()}`;
    const price = document.createElement("p");
    price.textContent = `${slot.priceMinor} ${slot.currency} minor units`;
    block.append(title, when, price);
    if (slot.status === "open") {
      const priceInput = document.createElement("input");
      priceInput.inputMode = "numeric";
      priceInput.setAttribute("aria-label", "New price in minor units");
      const save = document.createElement("button");
      save.type = "button";
      save.className = "secondary";
      save.textContent = "Update price";
      save.addEventListener("click", async () => {
        try {
          await api(`/api/admin/slots/${slot.id}/price`, {
            method: "POST",
            body: JSON.stringify({ priceMinor: Number(priceInput.value) }),
          });
          await refresh();
        } catch (error) {
          setStatus(error.message);
        }
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = "Cancel slot";
      cancel.addEventListener("click", async () => {
        try {
          await api(`/api/admin/slots/${slot.id}/cancel`, { method: "POST" });
          await refresh();
        } catch (error) {
          setStatus(error.message);
        }
      });
      block.append(priceInput, save, cancel);
    }
    if (slot.holdId && config.paymentBackend === "mock") {
      const pay = document.createElement("button");
      pay.type = "button";
      pay.textContent = "Simulate payment";
      pay.addEventListener("click", async () => {
        try {
          const result = await api(`/api/admin/holds/${slot.holdId}/simulate-payment`, { method: "POST" });
          setStatus(`Payment result: ${result.outcome}`);
          await refresh();
        } catch (error) {
          setStatus(error.message);
        }
      });
      block.append(pay);
    }
    root.append(block);
  }
}

function renderMembers(members) {
  const root = document.querySelector("#members");
  root.replaceChildren();
  for (const member of members) {
    const block = document.createElement("article");
    block.className = "member";
    const title = document.createElement("h3");
    title.textContent = `${member.label} · ${member.status}`;
    block.append(title);
    for (const key of member.keys) {
      const line = document.createElement("p");
      line.className = "mono note";
      line.textContent = key.revokedAt ? `${key.pubkey} revoked` : key.pubkey;
      block.append(line);
      if (!key.revokedAt) {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "secondary";
        revoke.textContent = "Revoke key";
        revoke.addEventListener("click", async () => {
          try {
            await api(`/api/admin/keys/${key.id}/revoke`, { method: "POST" });
            await refresh();
          } catch (error) {
            setStatus(error.message);
          }
        });
        block.append(revoke);
      }
    }
    const enroll = document.createElement("button");
    enroll.type = "button";
    enroll.textContent = "Enrollment QR";
    enroll.addEventListener("click", async () => {
      try {
        const result = await api(`/api/admin/members/${member.id}/enroll`, { method: "POST" });
        const link = document.createElement("a");
        link.href = result.enrollPath;
        link.textContent = "Open enrollment page";
        link.target = "_blank";
        block.append(link);
      } catch (error) {
        setStatus(error.message);
      }
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary";
    toggle.textContent = member.status === "active" ? "Revoke member" : "Restore member";
    toggle.addEventListener("click", async () => {
      const action = member.status === "active" ? "revoke" : "restore";
      try {
        await api(`/api/admin/members/${member.id}/${action}`, { method: "POST" });
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    block.append(enroll, toggle);
    root.append(block);
  }
}

function renderBookings(bookings) {
  const root = document.querySelector("#bookings");
  root.replaceChildren();
  if (bookings.length === 0) {
    root.textContent = "No settled bookings yet.";
    return;
  }
  for (const booking of bookings) {
    const line = document.createElement("p");
    line.textContent = `${booking.courtName} ${new Date(booking.startsAt).toLocaleString()} · ${booking.amountMinor} ${booking.currency} minor units`;
    root.append(line);
  }
}

function renderAudit(rows) {
  const root = document.querySelector("#audit");
  root.replaceChildren();
  if (rows.length === 0) {
    root.textContent = "No access attempts yet.";
    return;
  }
  for (const row of rows) {
    const line = document.createElement("p");
    line.textContent = `${new Date(row.at).toLocaleString()} ${row.result} ${row.reason}${row.area ? ` ${row.area}` : ""}`;
    root.append(line);
  }
}

if (token) {
  document.querySelector("#token").value = token;
  refresh().catch((error) => setStatus(error.message));
}
