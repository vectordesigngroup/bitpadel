// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

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
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not download the file");
    }
    return response.text();
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

document.querySelector("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#username").value.trim();
  const password = document.querySelector("#password").value;
  try {
    if (username) {
      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Login failed");
      token = body.token;
    } else {
      token = document.querySelector("#token").value.trim();
    }
    sessionStorage.setItem("club-box-admin-token", token);
    await refresh();
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#csv").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const csv = await api("/api/admin/bookings.csv");
    downloadText(csv, "bookings.csv");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#marketing-csv").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const csv = await api("/api/admin/marketing.csv");
    downloadText(csv, "marketing.csv");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#price-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const days = form.days.value.split(",").map((part) => Number(part.trim())).filter((day) => Number.isInteger(day));
  try {
    await api("/api/admin/price-rules", {
      method: "POST",
      body: JSON.stringify({
        label: form.label.value,
        days,
        start: form.start.value,
        end: form.end.value,
        memberPriceMinor: Number(form.memberPriceMinor.value),
        guestPriceMinor: Number(form.guestPriceMinor.value),
        courtId: form.courtId.value.trim() || null,
      }),
    });
    form.reset();
    await refresh();
    setStatus("Price rule saved.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#daily-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const date = event.currentTarget.date.value;
  try {
    const body = await api(`/api/admin/reports/daily?date=${encodeURIComponent(date)}`);
    document.querySelector("#daily-summary").textContent = JSON.stringify(body.summary, null, 2);
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#daily-email").addEventListener("click", async () => {
  const date = document.querySelector("#daily-form").date.value;
  try {
    await api("/api/admin/reports/daily/email", {
      method: "POST",
      body: JSON.stringify({ date }),
    });
    setStatus("Summary emailed.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#audit-csv").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const csv = await api("/api/admin/staff-actions.csv");
    downloadText(csv, "staff-actions.csv");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#sales-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const from = form.from.value;
  const to = form.to.value;
  try {
    const csv = await api(`/api/admin/reports/sales.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    downloadText(csv, "sales.csv");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#payment-health").addEventListener("click", async () => {
  try {
    const health = await api("/api/admin/payments/health");
    const balance = health.balanceSats == null ? "no balance reported" : `${health.balanceSats} sats`;
    setStatus(`${health.ok ? "Backend responded" : "Backend check failed"}. ${health.detail}. ${balance}.`);
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#staff-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/staff", {
      method: "POST",
      body: JSON.stringify({
        username: form.username.value,
        displayName: form.displayName.value,
        password: form.password.value,
        role: form.role.value,
      }),
    });
    form.reset();
    setStatus("Staff account saved.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#marketing-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/marketing/send", {
      method: "POST",
      body: JSON.stringify({
        channel: form.channel.value,
        to: form.to.value,
        subject: form.subject.value,
        text: form.text.value,
      }),
    });
    setStatus("Marketing message sent to an opted-in contact.");
  } catch (error) {
    setStatus(error.message);
  }
});

function downloadText(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

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
    `${config.currency} with ${config.currencyDecimals} decimal digits. Payments: ${config.paymentBackend}. Door: ${config.doorBackend}. Email: ${config.emailProvider}. SMS: ${config.smsProvider}. Photos: ${config.storageBackend}. ${config.entryGuidance}`;
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
  await renderPlaytomic(courts.courts);
  await renderPriceRules();
  await renderStaffActions();
  setStatus("");
}

async function renderPriceRules() {
  const root = document.querySelector("#price-rules");
  const data = await api("/api/admin/price-rules");
  root.replaceChildren();
  for (const rule of data.rules) {
    const line = document.createElement("p");
    line.textContent = `${rule.label}: days ${rule.days} ${rule.startMin}-${rule.endMin} member ${rule.memberPriceMinor} guest ${rule.guestPriceMinor}`;
    root.append(line);
  }
}

async function renderStaffActions() {
  const root = document.querySelector("#staff-actions");
  const data = await api("/api/admin/staff-actions");
  root.replaceChildren();
  for (const action of data.actions.slice(0, 12)) {
    const line = document.createElement("p");
    line.className = "note";
    line.textContent = `${action.at} ${action.actorLabel} ${action.method} ${action.path} ${action.status}`;
    root.append(line);
  }
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
    const idLine = document.createElement("p");
    idLine.className = "mono note";
    idLine.textContent = member.householdId
      ? `${member.id} · household ${member.householdId}`
      : member.id;
    block.append(idLine);
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
    const profile = document.createElement("button");
    profile.type = "button";
    profile.className = "secondary";
    profile.textContent = "Save profile";
    const name = field("Display name", member.displayName || "");
    const email = field("Email", member.email || "");
    const phone = field("Phone", member.phone || "");
    profile.addEventListener("click", async () => {
      try {
        await api(`/api/admin/members/${member.id}/profile`, {
          method: "POST",
          body: JSON.stringify({
            displayName: name.value,
            email: email.value,
            phone: phone.value,
            playtomicPlayerId: player.value || null,
            membershipType: membership.value,
            guestLimit: guests.value.trim() === "" ? null : Number(guests.value),
          }),
        });
        await refresh();
        setStatus("Profile saved.");
      } catch (error) {
        setStatus(error.message);
      }
    });
    const player = field("Playtomic player id", member.playtomicPlayerId || "");
    const membership = document.createElement("select");
    membership.setAttribute("aria-label", "Membership type");
    for (const type of config.membershipTypes || []) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = type === member.membershipType;
      membership.append(option);
    }
    const guests = field("Guest cap, blank uses the club default", member.guestLimit == null ? "" : String(member.guestLimit));
    const photo = document.createElement("input");
    photo.type = "file";
    photo.accept = "image/jpeg,image/png,image/webp";
    photo.setAttribute("aria-label", "Member photo");
    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "secondary";
    upload.textContent = member.hasPhoto ? "Replace photo" : "Upload photo";
    upload.addEventListener("click", async () => {
      const file = photo.files && photo.files[0];
      if (!file) {
        setStatus("Choose a JPEG, PNG, or WebP first.");
        return;
      }
      try {
        const data = await fileToBase64(file);
        await api(`/api/admin/members/${member.id}/photo`, {
          method: "POST",
          body: JSON.stringify({ contentType: file.type, data }),
        });
        await refresh();
        setStatus("Photo saved.");
      } catch (error) {
        setStatus(error.message);
      }
    });
    const household = document.createElement("button");
    household.type = "button";
    household.className = "secondary";
    household.textContent = "Make household primary";
    household.addEventListener("click", async () => {
      try {
        await api("/api/admin/households", {
          method: "POST",
          body: JSON.stringify({ label: `${member.label} household`, primaryMemberId: member.id }),
        });
        await refresh();
        setStatus("Household saved. A notice is sent when the primary has an email.");
      } catch (error) {
        setStatus(error.message);
      }
    });
    const dependent = field("Dependent member id", "");
    const addDependent = document.createElement("button");
    addDependent.type = "button";
    addDependent.className = "secondary";
    addDependent.textContent = "Add dependent";
    addDependent.addEventListener("click", async () => {
      if (!member.householdId) {
        setStatus("Make this member a household primary first, or add them from the primary's card.");
        return;
      }
      try {
        await api(`/api/admin/households/${member.householdId}/members`, {
          method: "POST",
          body: JSON.stringify({ memberId: dependent.value.trim(), role: "dependent" }),
        });
        await refresh();
        setStatus("Dependent added.");
      } catch (error) {
        setStatus(error.message);
      }
    });
    const uid = field("Card UID hex", "");
    const issue = document.createElement("button");
    issue.type = "button";
    issue.className = "secondary";
    issue.textContent = "Enroll card";
    issue.addEventListener("click", async () => {
      try {
        await api(`/api/admin/members/${member.id}/cards`, {
          method: "POST",
          body: JSON.stringify({ uid: uid.value, scheme: "ntag424-sun", label: "issued" }),
        });
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    block.append(name, email, phone, player, membership, guests, profile, photo, upload, household, dependent, addDependent, uid, issue);
    for (const card of member.cards || []) {
      const line = document.createElement("p");
      line.className = "mono note";
      line.textContent = `${card.scheme} ${card.uid} ${card.status}`;
      block.append(line);
      if (card.status === "active") {
        block.append(cardButton(card.id, "revoke", "Revoke card"), cardButton(card.id, "lost", "Mark lost"));
      }
    }
    block.append(enroll, toggle);
    root.append(block);
  }
}

function field(label, value) {
  const input = document.createElement("input");
  input.value = value;
  input.setAttribute("aria-label", label);
  input.placeholder = label;
  return input;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("Could not read the photo")));
    reader.addEventListener("load", () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    });
    reader.readAsDataURL(file);
  });
}

function cardButton(cardId, action, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = text;
  button.addEventListener("click", async () => {
    try {
      await api(`/api/admin/cards/${cardId}/${action}`, { method: "POST" });
      await refresh();
    } catch (error) {
      setStatus(error.message);
    }
  });
  return button;
}

async function renderPlaytomic(courts) {
  const select = document.querySelector("#map-form select");
  select.replaceChildren();
  for (const court of courts.filter((court) => court.active)) {
    const option = document.createElement("option");
    option.value = court.id;
    option.textContent = court.name;
    select.append(option);
  }
  const maps = await api("/api/admin/playtomic/maps");
  const root = document.querySelector("#maps");
  root.replaceChildren();
  for (const map of maps.maps) {
    const line = document.createElement("p");
    line.textContent = `${map.courtName} ← ${map.resourceId}`;
    root.append(line);
  }
  const conflicts = await api("/api/admin/playtomic/conflicts");
  const list = document.querySelector("#conflicts");
  list.replaceChildren();
  for (const conflict of conflicts.conflicts) {
    const line = document.createElement("p");
    line.textContent = conflict.detail;
    list.append(line);
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
    line.textContent = `${booking.id} · ${booking.courtName} ${new Date(booking.startsAt).toLocaleString()} · ${booking.amountMinor} ${booking.currency} minor units`;
    const refund = document.createElement("button");
    refund.type = "button";
    refund.className = "secondary";
    refund.textContent = "Refund";
    refund.addEventListener("click", async () => {
      const reason = window.prompt("Refund reason");
      if (!reason) return;
      const bolt11 = window.prompt("Customer BOLT11 if the backend requires one. Leave empty for mock or BTCPay.") || "";
      try {
        const result = await api(`/api/admin/bookings/${booking.id}/refund`, {
          method: "POST",
          body: JSON.stringify({ reason, bolt11: bolt11.trim() || undefined }),
        });
        setStatus(`Refund ${result.status}: ${result.refundId}`);
      } catch (error) {
        setStatus(error.message);
      }
    });
    root.append(line, refund);
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

document.querySelector("#map-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await api("/api/admin/playtomic/maps", {
      method: "POST",
      body: JSON.stringify({ courtId: data.get("courtId"), resourceId: data.get("resourceId") }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#sync").addEventListener("click", async () => {
  try {
    const result = await api("/api/admin/playtomic/sync", { method: "POST" });
    setStatus(`Synced ${result.report.bookings} bookings.`);
    await refresh();
  } catch (error) {
    setStatus(error.message);
  }
});

if (token) {
  document.querySelector("#token").value = token;
  refresh().catch((error) => setStatus(error.message));
}
