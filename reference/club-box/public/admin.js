// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const statusEl = document.querySelector("#status");
const appEl = document.querySelector("#app");
let token = sessionStorage.getItem("club-box-admin-token") || "";
let config = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function t(key, vars) {
  return window.clubI18n.t(key, vars);
}

function named(prefix, value) {
  if (value === undefined || value === null || value === "") return "";
  const key = `${prefix}.${value}`;
  const text = t(key);
  return text === key ? String(value) : text;
}

function when(value) {
  return window.clubI18n.formatDateTime(value);
}

function count(value) {
  return window.clubI18n.formatNumber(Number(value));
}

function ratioText(value) {
  return new Intl.NumberFormat(window.clubI18n.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(pathname, { ...options, headers });
  if (pathname.endsWith(".csv")) {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(body.code || body.error ? window.clubI18n.errorText(body, response.status) : t("admin.downloadFailed"));
      error.code = body.code || "";
      throw error;
    }
    return response.text();
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(window.clubI18n.errorText(body, response.status));
    error.code = body.code || "";
    throw error;
  }
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
      if (!response.ok) throw new Error(body.code || body.error ? window.clubI18n.errorText(body, response.status) : t("admin.loginFailed"));
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

document.querySelector("#ledger-csv").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const csv = await api("/api/admin/ledger.csv");
    downloadText(csv, "ledger.csv");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#allowance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await api("/api/admin/allowances", {
      method: "POST",
      body: JSON.stringify({
        membershipType: data.get("membershipType"),
        amountMinor: Number(data.get("amountMinor")),
        period: data.get("period"),
      }),
    });
    form.elements.amountMinor.value = "";
    await refresh();
    setStatus(t("admin.allowanceSaved"));
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
    setStatus(t("admin.priceRuleSaved"));
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
    setStatus(t("admin.summaryEmailed"));
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
    const balance = health.balanceSats == null
      ? t("admin.noBalance")
      : window.clubI18n.formatSats(health.balanceSats);
    const detail = window.clubI18n.errorText(health, 200);
    setStatus(t("admin.healthLine", {
      state: health.ok ? t("admin.backendOk") : t("admin.backendFailed"),
      detail,
      balance,
    }));
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
    setStatus(t("admin.staffSaved"));
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
    setStatus(t("admin.marketingSent"));
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
  document.querySelector("#server").textContent = t("admin.serverLine", {
    currency: config.currency,
    decimals: String(config.currencyDecimals),
    payments: config.paymentBackend,
    door: config.doorBackend,
    email: config.emailProvider,
    sms: config.smsProvider,
    photos: config.storageBackend,
    guidance: t("kiosk.safetyEntry"),
  });
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
  await renderAllowances();
  await renderLedger();
  await renderBrand();
  setStatus("");
}

async function renderAllowances() {
  const select = document.querySelector("#allowance-type");
  const current = select.value;
  select.replaceChildren();
  for (const type of config.membershipTypes || []) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    option.selected = type === current;
    select.append(option);
  }
  const root = document.querySelector("#allowances");
  const data = await api("/api/admin/allowances");
  root.replaceChildren();
  if (data.allowances.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = t("admin.allowanceEmpty");
    root.append(empty);
    return;
  }
  for (const plan of data.allowances) {
    const line = document.createElement("p");
    line.textContent = t("admin.allowanceLine", {
      type: plan.membershipType,
      amount: count(plan.amountMinor),
      major: String(plan.amountMajor),
      currency: plan.currency,
      period: named("account.period", plan.period),
    });
    root.append(line);
  }
}

async function renderLedger() {
  const root = document.querySelector("#ledger");
  const data = await api("/api/admin/ledger?limit=12");
  root.replaceChildren();
  if (data.entries.length === 0) {
    root.textContent = t("admin.ledgerEmpty");
    return;
  }
  for (const entry of data.entries) {
    const line = document.createElement("p");
    line.className = "note";
    const guest = entry.guestLabel ? t("admin.ledgerGuest", { name: entry.guestLabel }) : "";
    const sats = entry.amountSats == null ? "" : t("admin.ledgerSats", { amount: window.clubI18n.formatSats(entry.amountSats) });
    line.textContent = t("admin.ledgerLine", {
      when: when(entry.at),
      kind: named("admin.ledger", entry.kind),
      description: entry.description,
      allowance: count(entry.allowanceMinor),
      tab: count(entry.tabMinor),
      currency: entry.currency,
      sats,
      guest,
    });
    root.append(line);
  }
}

async function renderPriceRules() {
  const root = document.querySelector("#price-rules");
  const data = await api("/api/admin/price-rules");
  root.replaceChildren();
  for (const rule of data.rules) {
    const line = document.createElement("p");
    line.textContent = t("admin.priceRuleLine", {
      label: rule.label,
      days: String(rule.days),
      start: String(rule.startMin),
      end: String(rule.endMin),
      member: count(rule.memberPriceMinor),
      guest: count(rule.guestPriceMinor),
    });
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
    line.textContent = t("admin.staffActionLine", {
      when: when(action.at),
      actor: action.actorLabel,
      method: action.method,
      path: action.path,
      status: String(action.status),
    });
    root.append(line);
  }
}

function renderSlots(slots) {
  const root = document.querySelector("#slots");
  root.replaceChildren();
  if (slots.length === 0) {
    root.textContent = t("admin.slotsEmpty");
    return;
  }
  for (const slot of slots) {
    const block = document.createElement("article");
    block.className = "slot";
    const title = document.createElement("h3");
    title.textContent = t("admin.slotTitle", { court: slot.courtName, status: named("booking.status", slot.status) });
    const slotWhen = document.createElement("p");
    slotWhen.textContent = t("admin.slotWhen", { start: when(slot.startsAt), end: when(slot.endsAt) });
    const price = document.createElement("p");
    price.textContent = t("admin.slotPrice", { amount: count(slot.priceMinor), currency: slot.currency });
    block.append(title, slotWhen, price);
    if (slot.status === "open") {
      const priceInput = document.createElement("input");
      priceInput.inputMode = "numeric";
      priceInput.setAttribute("aria-label", t("admin.newPrice"));
      const save = document.createElement("button");
      save.type = "button";
      save.className = "secondary";
      save.textContent = t("admin.updatePrice");
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
      cancel.textContent = t("admin.cancelSlot");
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
      pay.textContent = t("admin.simulatePayment");
      pay.addEventListener("click", async () => {
        try {
          const result = await api(`/api/admin/holds/${slot.holdId}/simulate-payment`, { method: "POST" });
          setStatus(t("admin.paymentResult", { outcome: result.outcome }));
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
    title.textContent = t("admin.memberTitle", { label: member.label, status: named("admin.status", member.status) });
    block.append(title);
    const idLine = document.createElement("p");
    idLine.className = "mono note";
    idLine.textContent = member.householdId
      ? t("admin.householdId", { id: member.id, household: member.householdId })
      : member.id;
    block.append(idLine);
    for (const key of member.keys) {
      const line = document.createElement("p");
      line.className = "mono note";
      line.textContent = key.revokedAt ? t("admin.keyRevoked", { key: key.pubkey }) : key.pubkey;
      block.append(line);
      if (!key.revokedAt) {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "secondary";
        revoke.textContent = t("admin.revokeKey");
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
    enroll.textContent = t("admin.enrollmentQr");
    enroll.addEventListener("click", async () => {
      try {
        const result = await api(`/api/admin/members/${member.id}/enroll`, { method: "POST" });
        const link = document.createElement("a");
        link.href = result.enrollPath;
        link.textContent = t("admin.openEnrollment");
        link.target = "_blank";
        block.append(link);
      } catch (error) {
        setStatus(error.message);
      }
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary";
    toggle.textContent = member.status === "active" ? t("admin.revokeMember") : t("admin.restoreMember");
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
    profile.textContent = t("admin.saveProfile");
    const name = field(t("admin.displayName"), member.displayName || "");
    const email = field(t("admin.email"), member.email || "");
    const phone = field(t("admin.phone"), member.phone || "");
    const language = document.createElement("select");
    language.setAttribute("aria-label", t("admin.memberLanguage"));
    const blankLanguage = document.createElement("option");
    blankLanguage.value = "";
    blankLanguage.textContent = t("admin.memberLanguageBlank");
    language.append(blankLanguage);
    for (const choice of window.clubI18n.locales) {
      const option = document.createElement("option");
      option.value = choice.id;
      option.textContent = choice.name;
      option.selected = choice.id === member.preferredLocale;
      language.append(option);
    }
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
            preferredLocale: language.value === "" ? null : language.value,
          }),
        });
        await refresh();
        setStatus(t("admin.profileSaved"));
      } catch (error) {
        setStatus(error.message);
      }
    });
    const player = field(t("admin.playtomicId"), member.playtomicPlayerId || "");
    const membership = document.createElement("select");
    membership.setAttribute("aria-label", t("admin.membershipType"));
    for (const type of config.membershipTypes || []) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = type === member.membershipType;
      membership.append(option);
    }
    const guests = field(t("admin.guestCap"), member.guestLimit == null ? "" : String(member.guestLimit));
    const photo = document.createElement("input");
    photo.type = "file";
    photo.accept = "image/jpeg,image/png,image/webp";
    photo.setAttribute("aria-label", t("admin.photoAlt"));
    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "secondary";
    upload.textContent = member.hasPhoto ? t("admin.replacePhoto") : t("admin.uploadPhoto");
    upload.addEventListener("click", async () => {
      const file = photo.files && photo.files[0];
      if (!file) {
        setStatus(t("admin.choosePhoto"));
        return;
      }
      try {
        const data = await fileToBase64(file);
        await api(`/api/admin/members/${member.id}/photo`, {
          method: "POST",
          body: JSON.stringify({ contentType: file.type, data }),
        });
        await refresh();
        setStatus(t("admin.photoSaved"));
      } catch (error) {
        setStatus(error.message);
      }
    });
    const household = document.createElement("button");
    household.type = "button";
    household.className = "secondary";
    household.textContent = t("admin.makePrimary");
    household.addEventListener("click", async () => {
      try {
        await api("/api/admin/households", {
          method: "POST",
          body: JSON.stringify({ label: `${member.label} household`, primaryMemberId: member.id }),
        });
        await refresh();
        setStatus(t("admin.householdSaved"));
      } catch (error) {
        setStatus(error.message);
      }
    });
    const dependent = field(t("admin.dependentId"), "");
    const addDependent = document.createElement("button");
    addDependent.type = "button";
    addDependent.className = "secondary";
    addDependent.textContent = t("admin.addDependent");
    addDependent.addEventListener("click", async () => {
      if (!member.householdId) {
        setStatus(t("admin.needPrimary"));
        return;
      }
      try {
        await api(`/api/admin/households/${member.householdId}/members`, {
          method: "POST",
          body: JSON.stringify({ memberId: dependent.value.trim(), role: "dependent" }),
        });
        await refresh();
        setStatus(t("admin.dependentAdded"));
      } catch (error) {
        setStatus(error.message);
      }
    });
    const uid = field(t("admin.cardUid"), "");
    const issue = document.createElement("button");
    issue.type = "button";
    issue.className = "secondary";
    issue.textContent = t("admin.enrollCard");
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
    const tabPanel = document.createElement("div");
    const showTab = document.createElement("button");
    showTab.type = "button";
    showTab.className = "secondary";
    showTab.textContent = t("admin.showTab");
    showTab.addEventListener("click", async () => {
      try {
        const data = await api(`/api/admin/members/${member.id}/tab`);
        renderMemberTab(tabPanel, member.id, data.balance);
      } catch (error) {
        setStatus(error.message);
      }
    });
    block.append(name, email, phone, language, player, membership, guests, profile, photo, upload, household, dependent, addDependent, uid, issue, showTab, tabPanel);
    for (const card of member.cards || []) {
      const line = document.createElement("p");
      line.className = "mono note";
      line.textContent = t("admin.cardLine", {
        scheme: card.scheme,
        uid: card.uid,
        status: named("admin.status", card.status),
      });
      block.append(line);
      if (card.status === "active") {
        block.append(cardButton(card.id, "revoke", t("admin.revokeCard")), cardButton(card.id, "lost", t("admin.markLost")));
      }
    }
    block.append(enroll, toggle);
    root.append(block);
  }
}

function renderMemberTab(root, memberId, balance) {
  root.replaceChildren();
  const summary = document.createElement("p");
  const allowance = balance.allowance
    ? t("admin.allowanceLeft", {
        remaining: count(balance.allowance.remainingMinor),
        configured: count(balance.allowance.configuredMinor),
        period: named("account.period", balance.allowance.period),
        periodKey: balance.allowance.periodKey || t("admin.noOpenVisit"),
      })
    : t("admin.allowanceNone");
  summary.textContent = `${allowance} ${t("admin.tabSummary", {
    open: count(balance.tab.openMinor),
    major: String(balance.tab.openMajor),
    currency: balance.currency,
    limit: count(balance.tab.limitMinor),
    state: balance.tab.frozen ? t("admin.tabFrozen") : t("admin.tabOpen"),
  })}`;
  const limit = field(t("admin.tabLimitField"), String(balance.tab.limitMinor));
  const saveLimit = document.createElement("button");
  saveLimit.type = "button";
  saveLimit.className = "secondary";
  saveLimit.textContent = t("admin.saveTabLimit");
  saveLimit.addEventListener("click", async () => {
    try {
      await api(`/api/admin/members/${memberId}/tab`, {
        method: "POST",
        body: JSON.stringify({ limitMinor: Number(limit.value) }),
      });
      const data = await api(`/api/admin/members/${memberId}/tab`);
      renderMemberTab(root, memberId, data.balance);
      setStatus(t("admin.tabLimitSaved"));
    } catch (error) {
      setStatus(error.message);
    }
  });
  const freeze = document.createElement("button");
  freeze.type = "button";
  freeze.className = "secondary";
  freeze.textContent = balance.tab.frozen ? t("admin.unfreezeTab") : t("admin.freezeTab");
  freeze.addEventListener("click", async () => {
    const action = balance.tab.frozen ? "unfreeze" : "freeze";
    try {
      await api(`/api/admin/members/${memberId}/tab/${action}`, { method: "POST" });
      const data = await api(`/api/admin/members/${memberId}/tab`);
      renderMemberTab(root, memberId, data.balance);
    } catch (error) {
      setStatus(error.message);
    }
  });
  const direction = document.createElement("select");
  direction.setAttribute("aria-label", t("admin.adjustmentDirection"));
  for (const value of ["credit", "debit"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(value === "credit" ? "admin.adjustCredit" : "admin.adjustDebit");
    direction.append(option);
  }
  const amount = field(t("admin.adjustmentAmount"), "");
  const reason = field(t("admin.adjustmentReason"), "");
  const adjust = document.createElement("button");
  adjust.type = "button";
  adjust.className = "secondary";
  adjust.textContent = t("admin.postAdjustment");
  adjust.addEventListener("click", async () => {
    try {
      await api(`/api/admin/members/${memberId}/tab/adjust`, {
        method: "POST",
        body: JSON.stringify({
          direction: direction.value,
          amountMinor: Number(amount.value),
          reason: reason.value,
        }),
      });
      const data = await api(`/api/admin/members/${memberId}/tab`);
      renderMemberTab(root, memberId, data.balance);
      setStatus(t("admin.adjustmentPosted"));
    } catch (error) {
      setStatus(error.message);
    }
  });
  root.append(summary, limit, saveLimit, freeze, direction, amount, reason, adjust);
  for (const entry of balance.recent) {
    const line = document.createElement("p");
    line.className = "note";
    const guest = entry.guestLabel ? t("admin.ledgerGuest", { name: entry.guestLabel }) : "";
    line.textContent = t("admin.memberLedgerLine", {
      when: when(entry.at),
      kind: named("admin.ledger", entry.kind),
      description: entry.description,
      tab: count(entry.tabMinor),
      guest,
    });
    root.append(line);
  }
  if (config.paymentBackend === "mock") {
    for (const pending of balance.pendingSettlements) {
      const pay = document.createElement("button");
      pay.type = "button";
      pay.textContent = t("admin.simulateTabPayment", { amount: count(pending.amountMinor) });
      pay.addEventListener("click", async () => {
        try {
          const result = await api(`/api/admin/tab-settlements/${pending.id}/simulate-payment`, { method: "POST" });
          setStatus(t("admin.paymentResult", { outcome: result.outcome }));
          const data = await api(`/api/admin/members/${memberId}/tab`);
          renderMemberTab(root, memberId, data.balance);
        } catch (error) {
          setStatus(error.message);
        }
      });
      root.append(pay);
    }
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
    reader.addEventListener("error", () => reject(new Error(t("admin.photoReadFailed"))));
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
    line.textContent = conflictText(conflict);
    list.append(line);
  }
}

function conflictText(conflict) {
  const unmapped = /^Playtomic court (.*) is not mapped to a local court$/.exec(conflict.detail);
  if (unmapped) return t("admin.playtomic.unmapped", { court: unmapped[1] });
  const booking = /^Imported booking overlaps local booking (.*)$/.exec(conflict.detail);
  if (booking) return t("admin.playtomic.overlapBooking", { id: booking[1] });
  const hold = /^Imported booking overlaps pending hold (.*)$/.exec(conflict.detail);
  if (hold) return t("admin.playtomic.overlapHold", { id: hold[1] });
  return conflict.detail;
}

function renderBookings(bookings) {
  const root = document.querySelector("#bookings");
  root.replaceChildren();
  if (bookings.length === 0) {
    root.textContent = t("admin.bookingsEmpty");
    return;
  }
  for (const booking of bookings) {
    const line = document.createElement("p");
    line.textContent = t("admin.bookingLine", {
      id: booking.id,
      court: booking.courtName,
      when: when(booking.startsAt),
      amount: count(booking.amountMinor),
      currency: booking.currency,
    });
    const refund = document.createElement("button");
    refund.type = "button";
    refund.className = "secondary";
    refund.textContent = t("admin.refund");
    refund.addEventListener("click", async () => {
      const reason = window.prompt(t("admin.refundReasonPrompt"));
      if (!reason) return;
      const bolt11 = window.prompt(t("admin.refundBolt11Prompt")) || "";
      try {
        const result = await api(`/api/admin/bookings/${booking.id}/refund`, {
          method: "POST",
          body: JSON.stringify({ reason, bolt11: bolt11.trim() || undefined }),
        });
        setStatus(t("admin.refundResult", { status: result.status, id: result.refundId }));
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
    root.textContent = t("admin.auditEmpty");
    return;
  }
  for (const row of rows) {
    const line = document.createElement("p");
    line.textContent = t("admin.auditLine", {
      when: when(row.at),
      result: named("audit.result", row.result),
      reason: named("audit.reason", row.reason),
      area: row.area ? ` ${row.area}` : "",
    });
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
    setStatus(t("admin.synced", { count: count(result.report.bookings) }));
    await refresh();
  } catch (error) {
    setStatus(error.message);
  }
});

const BRAND_COLORS = ["primary", "accent", "background", "text"];

function normalizeHex(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-f]{6}$/.test(withHash) ? withHash : null;
}

function channelLuminance(value) {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const body = hex.slice(1);
  const red = Number.parseInt(body.slice(0, 2), 16);
  const green = Number.parseInt(body.slice(2, 4), 16);
  const blue = Number.parseInt(body.slice(4, 6), 16);
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

function contrastRatio(left, right) {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastMessages(draft) {
  const warnings = [];
  const text = contrastRatio(draft.textColor, draft.backgroundColor);
  if (text < 4.5) warnings.push(t("admin.contrast.text", { ratio: ratioText(text) }));
  const button = contrastRatio(draft.backgroundColor, draft.primaryColor);
  if (button < 4.5) warnings.push(t("admin.contrast.button", { ratio: ratioText(button) }));
  const links = contrastRatio(draft.accentColor, draft.backgroundColor);
  if (links < 4.5) warnings.push(t("admin.contrast.links", { ratio: ratioText(links) }));
  return warnings;
}

function readBrandDraft() {
  const form = document.querySelector("#brand-form");
  return {
    clubName: form.clubName.value.trim(),
    shortName: form.shortName.value.trim(),
    primaryColor: normalizeHex(form.primaryColor.value),
    accentColor: normalizeHex(form.accentColor.value),
    backgroundColor: normalizeHex(form.backgroundColor.value),
    textColor: normalizeHex(form.textColor.value),
    fontKey: form.fontKey.value,
    footerText: form.footerText.value.trim(),
    contactText: form.contactText.value.trim(),
    defaultLocale: form.defaultLocale.value,
  };
}

function brandLinks(form) {
  const labels = [...form.querySelectorAll("[name=linkLabel]")];
  const urls = [...form.querySelectorAll("[name=linkUrl]")];
  const links = [];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index].value.trim();
    const url = urls[index].value.trim();
    if (!label && !url) continue;
    links.push({ label, url });
  }
  return links;
}

let brandPreviewTimer = 0;

function scheduleBrandPreview() {
  window.clearTimeout(brandPreviewTimer);
  brandPreviewTimer = window.setTimeout(updateBrandPreview, 80);
}

function updateBrandPreview() {
  const draft = readBrandDraft();
  const preview = document.querySelector("#brand-preview");
  preview.querySelector(".brand-preview-name").textContent = draft.clubName || draft.shortName || t("admin.previewClub");
  preview.querySelector(".brand-preview-footer").textContent = draft.footerText;
  const warnings = document.querySelector("#brand-contrast");
  if (!draft.primaryColor || !draft.accentColor || !draft.backgroundColor || !draft.textColor) {
    warnings.textContent = t("admin.hexHint");
    return;
  }
  const params = new URLSearchParams({
    background: draft.backgroundColor,
    text: draft.textColor,
    primary: draft.primaryColor,
    accent: draft.accentColor,
    font: draft.fontKey,
  });
  document.querySelector("#brand-preview-css").href = `/brand/preview.css?${params}`;
  warnings.textContent = contrastMessages(draft).join(" ");
}

function setBrandColor(name, value) {
  const hex = normalizeHex(value) || value;
  document.querySelector(`#${name}-hex`).value = hex;
  const normalized = normalizeHex(value);
  if (normalized) document.querySelector(`#${name}-picker`).value = normalized;
}

async function renderBrand() {
  const brand = await api("/api/admin/brand");
  const form = document.querySelector("#brand-form");
  form.clubName.value = brand.clubName;
  form.shortName.value = brand.shortName;
  setBrandColor("primary", brand.primaryColor);
  setBrandColor("accent", brand.accentColor);
  setBrandColor("background", brand.backgroundColor);
  setBrandColor("text", brand.textColor);
  form.fontKey.value = brand.fontKey;
  form.defaultLocale.value = brand.defaultLocale || "en";
  form.footerText.value = brand.footerText;
  form.contactText.value = brand.contactText;
  const labels = [...form.querySelectorAll("[name=linkLabel]")];
  const urls = [...form.querySelectorAll("[name=linkUrl]")];
  labels.forEach((input, index) => {
    input.value = brand.links[index] ? brand.links[index].label : "";
    urls[index].value = brand.links[index] ? brand.links[index].url : "";
  });
  document.querySelector("#brand-placeholder-note").textContent = brand.usingPlaceholder ? brand.placeholderNote : "";
  const logo = document.querySelector("#brand-logo-current");
  if (brand.hasLogo) {
    logo.hidden = false;
    logo.src = `/brand/logo?v=${encodeURIComponent(brand.updatedAt || "")}`;
  } else {
    logo.hidden = true;
    logo.removeAttribute("src");
  }
  const favicon = document.querySelector("#brand-favicon-current");
  if (brand.hasFavicon) {
    favicon.hidden = false;
    favicon.src = `/brand/favicon?v=${encodeURIComponent(brand.updatedAt || "")}`;
  } else {
    favicon.hidden = true;
    favicon.removeAttribute("src");
  }
  updateBrandPreview();
}

async function postBrandFile(pathname, file) {
  const response = await fetch(pathname, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(window.clubI18n.errorText(body, response.status));
    error.code = body.code || "";
    throw error;
  }
  return body;
}

for (const name of BRAND_COLORS) {
  const picker = document.querySelector(`#${name}-picker`);
  const hex = document.querySelector(`#${name}-hex`);
  picker.addEventListener("input", () => {
    hex.value = picker.value;
    scheduleBrandPreview();
  });
  hex.addEventListener("input", () => {
    const normalized = normalizeHex(hex.value);
    if (normalized) picker.value = normalized;
    scheduleBrandPreview();
  });
}

document.querySelector("#brand-form").addEventListener("input", scheduleBrandPreview);
document.querySelector("#brand-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const draft = readBrandDraft();
  if (!draft.primaryColor || !draft.accentColor || !draft.backgroundColor || !draft.textColor) {
    setStatus(t("admin.hexHint"));
    return;
  }
  try {
    const saved = await api("/api/admin/brand", {
      method: "POST",
      body: JSON.stringify({
        clubName: draft.clubName,
        shortName: draft.shortName,
        primaryColor: draft.primaryColor,
        accentColor: draft.accentColor,
        backgroundColor: draft.backgroundColor,
        textColor: draft.textColor,
        fontKey: draft.fontKey,
        footerText: draft.footerText,
        contactText: draft.contactText,
        links: brandLinks(form),
        defaultLocale: draft.defaultLocale,
      }),
    });
    await refresh();
    const warnings = contrastMessages(draft);
    setStatus(warnings.length ? `${t("admin.savedBranding")} ${warnings.join(" ")}` : t("admin.savedBranding"));
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#brand-logo-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = document.querySelector("#brand-logo-file").files[0];
  if (!file) {
    setStatus(t("admin.chooseLogo"));
    return;
  }
  try {
    await postBrandFile("/api/admin/brand/logo", file);
    await refresh();
    setStatus(t("admin.logoSaved"));
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#brand-logo-clear").addEventListener("click", async () => {
  try {
    await api("/api/admin/brand/logo/clear", { method: "POST" });
    await refresh();
    setStatus(t("admin.logoRemoved"));
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#brand-favicon-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = document.querySelector("#brand-favicon-file").files[0];
  if (!file) {
    setStatus(t("admin.chooseFavicon"));
    return;
  }
  try {
    await postBrandFile("/api/admin/brand/favicon", file);
    await refresh();
    setStatus(t("admin.faviconSaved"));
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#brand-favicon-clear").addEventListener("click", async () => {
  try {
    await api("/api/admin/brand/favicon/clear", { method: "POST" });
    await refresh();
    setStatus(t("admin.faviconRemoved"));
  } catch (error) {
    setStatus(error.message);
  }
});

if (token) {
  document.querySelector("#token").value = token;
  refresh().catch((error) => setStatus(error.message));
}
