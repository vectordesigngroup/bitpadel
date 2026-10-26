// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

// The server already writes the saved name into the page. This keeps the
// header, footer, logo, and favicon in sync with /api/brand.
async function applyPublicBrand() {
  try {
    const response = await fetch("/api/brand");
    if (!response.ok) return;
    const brand = await response.json();
    const shortName = typeof brand.shortName === "string" && brand.shortName ? brand.shortName : "Your club";
    const clubName = typeof brand.clubName === "string" && brand.clubName ? brand.clubName : shortName;
    document.querySelectorAll(".brand-name-text").forEach((el) => {
      el.textContent = clubName;
    });
    document.querySelectorAll(".brand-footer-text").forEach((el) => {
      el.textContent = typeof brand.footerText === "string" ? brand.footerText : "";
    });
    document.querySelectorAll(".brand-contact").forEach((el) => {
      el.textContent = typeof brand.contactText === "string" ? brand.contactText : "";
    });
    document.querySelectorAll(".brand-links").forEach((el) => {
      el.replaceChildren();
      const links = Array.isArray(brand.links) ? brand.links : [];
      for (const link of links) {
        if (!link || typeof link.url !== "string" || typeof link.label !== "string") continue;
        if (!/^https?:\/\//i.test(link.url)) continue;
        const anchor = document.createElement("a");
        anchor.href = link.url;
        anchor.textContent = link.label;
        el.append(anchor);
      }
    });
    document.querySelectorAll(".brand-logo").forEach((img) => {
      if (brand.hasLogo) {
        img.src = `/brand/logo?v=${encodeURIComponent(brand.updatedAt || "")}`;
        img.hidden = false;
      } else {
        img.hidden = true;
        img.removeAttribute("src");
      }
    });
    if (brand.hasFavicon) {
      let icon = document.querySelector('link[rel="icon"]');
      if (!icon) {
        icon = document.createElement("link");
        icon.rel = "icon";
        document.head.append(icon);
      }
      icon.href = `/brand/favicon?v=${encodeURIComponent(brand.updatedAt || "")}`;
    }
    const titled = `${shortName} — `;
    if (!document.title.startsWith(titled) && !document.title.startsWith(`${shortName} - `)) {
      document.title = `${titled}${document.title}`;
    }
  } catch {
    // Keep the names the server wrote into the page.
  }
}

applyPublicBrand();
