// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

// Formatting options match src/i18n/format.ts. The catalog is embedded by the server. No other site is called.
(function initLocale() {
  const bootNode = document.getElementById("i18n-boot");
  let boot = null;
  try {
    boot = bootNode ? JSON.parse(bootNode.textContent || "") : null;
  } catch {
    boot = null;
  }

  function missing(key) {
    return key;
  }

  if (!boot || typeof boot.messages !== "object" || boot.messages === null) {
    window.clubI18n = {
      t: missing,
      locale: "en",
      locales: [],
      timeZone: "UTC",
      currency: "",
      currencyDecimals: 2,
      formatDateTime: function (value) { return String(value); },
      formatTime: function (value) { return String(value); },
      formatDate: function (value) { return String(value); },
      formatNumber: function (value) { return String(value); },
      formatMoney: function (amount, currency) { return `${amount} ${currency}`; },
      formatSats: function (amount) { return `${amount} sats`; },
      apply: function () {},
    };
    return;
  }

  const messages = boot.messages;

  function t(key, vars) {
    const template = messages[key];
    if (typeof template !== "string") return key;
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, function (token, name) {
      if (!vars || vars[name] === undefined || vars[name] === null) return token;
      return String(vars[name]);
    });
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      const key = el.getAttribute("data-i18n");
      if (!key || typeof messages[key] !== "string") return;
      el.textContent = t(key);
    });
    scope.querySelectorAll("[data-i18n-alt]").forEach(function (el) {
      const key = el.getAttribute("data-i18n-alt");
      if (key) el.alt = t(key);
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      const key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });
    const titleKey = document.body && document.body.getAttribute("data-i18n-title");
    if (titleKey && typeof messages[titleKey] === "string") document.title = t(titleKey);
    document.documentElement.lang = boot.locale;
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat(boot.locale, {
      timeZone: boot.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat(boot.locale, { timeZone: boot.timeZone, timeStyle: "short" }).format(new Date(value));
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(boot.locale, { timeZone: boot.timeZone, dateStyle: "medium" }).format(new Date(value));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(boot.locale, { maximumFractionDigits: 0, useGrouping: "always" }).format(value);
  }

  function formatMoney(amountMinor, currency, decimals) {
    const scale = decimals === undefined || decimals === null ? boot.currencyDecimals : decimals;
    const major = amountMinor / 10 ** scale;
    const number = new Intl.NumberFormat(boot.locale, {
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
      useGrouping: "always",
    }).format(major);
    try {
      const formatted = new Intl.NumberFormat(boot.locale, {
        style: "currency",
        currency: currency,
        minimumFractionDigits: scale,
        maximumFractionDigits: scale,
        useGrouping: "always",
      }).format(major);
      if (formatted.indexOf("¤") >= 0) return `${number} ${currency}`;
      return formatted;
    } catch {
      return `${number} ${currency}`;
    }
  }

  function formatSats(amount) {
    return t("format.sats", { amount: formatNumber(amount) });
  }

  window.clubI18n = {
    t: t,
    locale: boot.locale,
    locales: boot.locales || [],
    timeZone: boot.timeZone,
    currency: boot.currency,
    currencyDecimals: boot.currencyDecimals,
    formatDateTime: formatDateTime,
    formatTime: formatTime,
    formatDate: formatDate,
    formatNumber: formatNumber,
    formatMoney: formatMoney,
    formatSats: formatSats,
    apply: apply,
  };

  apply(document);

  const form = document.querySelector(".locale-switch");
  if (!form) return;
  const select = form.querySelector("select");
  const applyButton = form.querySelector("button");
  if (applyButton) applyButton.hidden = true;
  if (!select) return;
  select.addEventListener("change", function () {
    saveLocale(select.value);
  });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    saveLocale(select.value);
  });

  function saveLocale(locale) {
    fetch("/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ locale: locale }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("locale");
        const url = new URL(location.href);
        url.searchParams.delete("lang");
        location.assign(url.toString());
      })
      .catch(function () {
        form.submit();
      });
  }
})();
