// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

import type { OutboundMessage } from "../notify/types.js";
import { cssVariables } from "./color.js";
import { fontStack, type ClubBrand } from "./model.js";

/** Put the club name, colors, and footer on an email. SMS is left unchanged. */
export function applyEmailBrand(brand: ClubBrand, message: OutboundMessage, publicBaseUrl?: string): OutboundMessage {
  if (message.channel !== "email") return message;
  const subjectBase = message.subject ?? "Message";
  const prefix = `${brand.shortName}: `;
  const subject = subjectBase.startsWith(prefix) ? subjectBase : `${prefix}${subjectBase}`;
  const lines = [message.text, "", "--", brand.clubName];
  if (brand.contactText) lines.push(brand.contactText);
  if (brand.footerText) lines.push(brand.footerText);
  for (const link of brand.links) lines.push(`${link.label}: ${link.url}`);
  return {
    ...message,
    subject,
    text: lines.join("\n"),
    html: renderEmailHtml(brand, message.text, publicBaseUrl),
  };
}

function renderEmailHtml(brand: ClubBrand, text: string, publicBaseUrl?: string): string {
  const colors = cssVariables(brand);
  const logo =
    brand.logo && publicBaseUrl
      ? `<img src="${escapeHtml(trimSlash(publicBaseUrl))}/brand/logo" alt="" height="40" style="height:40px;width:auto;">`
      : "";
  const links = brand.links
    .map(
      (link) =>
        `<a href="${escapeHtml(link.url)}" style="color:${colors["--accent"]};">${escapeHtml(link.label)}</a>`,
    )
    .join(" ");
  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:${colors["--bg"]};color:${colors["--text"]};font-family:${escapeHtml(fontStack(brand.fontKey))};">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    ${logo}
    <h1 style="font-size:20px;line-height:1.2;color:${colors["--primary"]};">${escapeHtml(brand.clubName)}</h1>
    <p style="white-space:pre-wrap;">${escapeHtml(text)}</p>
    <p style="color:${colors["--muted"]};">${escapeHtml(brand.contactText)}</p>
    <p style="color:${colors["--muted"]};">${escapeHtml(brand.footerText)}</p>
    <p>${links}</p>
  </div>
</body>
</html>`;
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
