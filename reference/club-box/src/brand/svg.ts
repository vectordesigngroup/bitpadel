// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

const BANNED_TAGS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "image",
  "animate",
  "animatetransform",
  "animatemotion",
  "set",
  "handler",
  "style",
  "link",
  "video",
  "audio",
  "canvas",
  "math",
]);

const CANONICAL_TAGS: Record<string, string> = {
  svg: "svg",
  g: "g",
  path: "path",
  rect: "rect",
  circle: "circle",
  ellipse: "ellipse",
  line: "line",
  polyline: "polyline",
  polygon: "polygon",
  text: "text",
  tspan: "tspan",
  defs: "defs",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  stop: "stop",
  title: "title",
  desc: "desc",
  clippath: "clipPath",
  mask: "mask",
  symbol: "symbol",
  use: "use",
};

const CANONICAL_ATTRS: Record<string, string> = {
  xmlns: "xmlns",
  "xmlns:xlink": "xmlns:xlink",
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  width: "width",
  height: "height",
  x: "x",
  y: "y",
  x1: "x1",
  y1: "y1",
  x2: "x2",
  y2: "y2",
  cx: "cx",
  cy: "cy",
  r: "r",
  rx: "rx",
  ry: "ry",
  fx: "fx",
  fy: "fy",
  d: "d",
  points: "points",
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "stroke-width",
  "stroke-linecap": "stroke-linecap",
  "stroke-linejoin": "stroke-linejoin",
  "stroke-miterlimit": "stroke-miterlimit",
  "fill-opacity": "fill-opacity",
  "stroke-opacity": "stroke-opacity",
  "fill-rule": "fill-rule",
  "clip-rule": "clip-rule",
  opacity: "opacity",
  transform: "transform",
  id: "id",
  class: "class",
  offset: "offset",
  "stop-color": "stop-color",
  "stop-opacity": "stop-opacity",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  spreadmethod: "spreadMethod",
  "font-size": "font-size",
  "font-family": "font-family",
  "font-weight": "font-weight",
  "text-anchor": "text-anchor",
  "dominant-baseline": "dominant-baseline",
  "letter-spacing": "letter-spacing",
  "clip-path": "clip-path",
  mask: "mask",
  style: "style",
  href: "href",
  "xlink:href": "xlink:href",
  role: "role",
  "aria-label": "aria-label",
};

type Attr = { name: string; value: string };
type Tag = { closing: boolean; name: string; attrs: Attr[]; selfClosing: boolean; next: number };

const MAX_TAGS = 4000;

/**
 * Rebuild an SVG from a drawing subset and refuse active content.
 * The stored file is this output, not the upload.
 */
export function sanitizeSvg(raw: string): string {
  if (raw.includes("\0")) throw new Error("SVG contains a null byte");
  let source = raw.replace(/^\uFEFF/, "");
  source = source.replace(/<!--[\s\S]*?-->/g, "");
  source = source.replace(/<\?xml[\s\S]*?\?>/gi, "");
  if (source.length > 512 * 1024) throw new Error("SVG is too large");
  if (/<!|<\?/.test(source)) throw new Error("SVG contains disallowed markup");
  if (hasActiveContent(source)) {
    throw new Error("That SVG includes a script or other active content. Export a plain logo, or use PNG or JPG.");
  }

  const out: string[] = [];
  const stack: Array<{ name: string; skip: boolean }> = [];
  let index = 0;
  let tags = 0;
  let sawSvg = false;
  const skipping = () => stack.some((frame) => frame.skip);

  while (index < source.length) {
    if (source[index] !== "<") {
      const next = source.indexOf("<", index);
      const text = source.slice(index, next === -1 ? source.length : next);
      if (!skipping() && stack.length > 0 && text.length > 0) out.push(escapeText(text));
      index = next === -1 ? source.length : next;
      continue;
    }
    const tag = readTag(source, index);
    tags += 1;
    if (tags > MAX_TAGS) throw new Error("SVG is too complex");
    const lower = tag.name.toLowerCase();
    if (tag.closing) {
      const frame = stack.pop();
      if (!frame || frame.name !== lower) throw new Error("SVG tags are not closed");
      if (!frame.skip) out.push(`</${canonicalTag(lower)}>`);
      index = tag.next;
      continue;
    }
    if (BANNED_TAGS.has(lower)) {
      throw new Error("That SVG includes a script or other active content. Export a plain logo, or use PNG or JPG.");
    }
    const canonical = CANONICAL_TAGS[lower];
    if (!canonical || skipping()) {
      stack.push({ name: lower, skip: true });
      if (tag.selfClosing) stack.pop();
      index = tag.next;
      continue;
    }
    if (lower === "svg") sawSvg = true;
    const attrs = sanitizeAttrs(lower, tag.attrs);
    const rendered = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
    if (tag.selfClosing) {
      out.push(`<${canonical}${rendered}/>`);
    } else {
      out.push(`<${canonical}${rendered}>`);
      stack.push({ name: lower, skip: false });
    }
    index = tag.next;
  }
  if (!sawSvg) throw new Error("SVG is missing an svg root");
  if (stack.length !== 0) throw new Error("SVG tags are not closed");
  const result = out.join("");
  if (!result.startsWith("<svg")) throw new Error("SVG is missing an svg root");
  if (hasActiveContent(result)) {
    throw new Error("That SVG includes a script or other active content. Export a plain logo, or use PNG or JPG.");
  }
  return result;
}

function canonicalTag(lower: string): string {
  const name = CANONICAL_TAGS[lower];
  if (!name) throw new Error("SVG contains an element this app does not allow");
  return name;
}

function hasActiveContent(source: string): boolean {
  return /<\s*script\b|<\s*foreignObject\b|<\s*iframe\b|<\s*embed\b|<\s*object\b|<\s*image\b|<\s*animate\b|<\s*set\b|<\s*handler\b|javascript\s*:|vbscript\s*:|\son[a-z]+\s*=|expression\s*\(|@import|data\s*:|<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(
    source,
  );
}

function sanitizeAttrs(tag: string, attrs: Attr[]): string[] {
  const rendered: string[] = [];
  let xmlns = tag === "svg" ? false : true;
  for (const attr of attrs) {
    const lower = attr.name.toLowerCase();
    if (lower.startsWith("on")) {
      throw new Error("That SVG includes a script or other active content. Export a plain logo, or use PNG or JPG.");
    }
    const canonical = CANONICAL_ATTRS[lower];
    if (!canonical) continue;
    const value = sanitizeAttrValue(tag, lower, attr.value);
    if (value === null) continue;
    if (lower === "xmlns") xmlns = true;
    rendered.push(`${canonical}="${escapeAttr(value)}"`);
  }
  if (tag === "svg" && !xmlns) rendered.unshift('xmlns="http://www.w3.org/2000/svg"');
  return rendered;
}

function sanitizeAttrValue(tag: string, name: string, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 8000) return null;
  if (/javascript\s*:|vbscript\s*:|expression\s*\(|@import|data\s*:/i.test(trimmed)) {
    throw new Error("That SVG includes a script or other active content. Export a plain logo, or use PNG or JPG.");
  }
  switch (name) {
    case "xmlns":
      if (tag !== "svg" || trimmed !== "http://www.w3.org/2000/svg") return null;
      return trimmed;
    case "xmlns:xlink":
      if (trimmed !== "http://www.w3.org/1999/xlink") return null;
      return trimmed;
    case "href":
    case "xlink:href":
      return /^#[A-Za-z_][\w:.-]{0,80}$/.test(trimmed) ? trimmed : null;
    case "style":
      if (trimmed.length > 500 || /url\s*\(|expression|javascript|@import|behavior|-moz-binding|<|>/i.test(trimmed)) {
        throw new Error("That SVG includes a script or other active content. Export a plain logo, or use PNG or JPG.");
      }
      return trimmed;
    case "id":
      return /^[A-Za-z_][\w:.-]{0,80}$/.test(trimmed) ? trimmed : null;
    case "class":
      return /^[A-Za-z0-9_:\-\s]{1,120}$/.test(trimmed) ? trimmed : null;
    case "d":
      return /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,\s+-]+$/.test(trimmed) ? trimmed : null;
    case "points":
      return /^[\d\s.,eE+-]+$/.test(trimmed) ? trimmed : null;
    case "transform":
    case "gradienttransform":
      return /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[-+\d.eE,\s]+\)\s*)+$/.test(trimmed)
        ? trimmed
        : null;
    case "viewbox":
      return /^-?\d*\.?\d+(?:[\s,]+-?\d*\.?\d+){3}$/.test(trimmed) ? trimmed.replace(/,/g, " ") : null;
    case "fill":
    case "stroke":
    case "stop-color":
    case "color":
      return isPaint(trimmed) ? trimmed : null;
    case "clip-path":
    case "mask":
      return /^url\(#[A-Za-z_][\w:.-]{0,80}\)$/.test(trimmed) ? trimmed : null;
    case "fill-rule":
    case "clip-rule":
      return trimmed === "nonzero" || trimmed === "evenodd" ? trimmed : null;
    case "stroke-linecap":
      return trimmed === "butt" || trimmed === "round" || trimmed === "square" ? trimmed : null;
    case "stroke-linejoin":
      return trimmed === "miter" || trimmed === "round" || trimmed === "bevel" ? trimmed : null;
    case "text-anchor":
      return trimmed === "start" || trimmed === "middle" || trimmed === "end" ? trimmed : null;
    case "font-weight":
      return /^(?:normal|bold|[1-9]00)$/.test(trimmed) ? trimmed : null;
    case "font-family":
      return /^[A-Za-z0-9 ,.'"_-]{1,80}$/.test(trimmed) ? trimmed : null;
    case "spreadmethod":
      return trimmed === "pad" || trimmed === "reflect" || trimmed === "repeat" ? trimmed : null;
    case "gradientunits":
      return trimmed === "userSpaceOnUse" || trimmed === "objectBoundingBox" ? trimmed : null;
    case "preserveaspectratio":
      return /^[A-Za-z0-9 ]{1,40}$/.test(trimmed) ? trimmed : null;
    case "role":
      return trimmed === "img" ? trimmed : null;
    case "aria-label":
      return /^[\w .,'-]{1,80}$/.test(trimmed) ? trimmed : null;
    default:
      return /^-?\d*\.?\d+(?:px|em|rem|%)?$/.test(trimmed) || trimmed === "auto" ? trimmed : null;
  }
}

function isPaint(value: string): boolean {
  if (value === "none" || value === "currentColor" || value === "inherit") return true;
  if (/^#[0-9A-Fa-f]{3,8}$/.test(value)) return true;
  if (/^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.test(value)) return true;
  if (/^url\(#[A-Za-z_][\w:.-]{0,80}\)$/.test(value)) return true;
  return /^[a-zA-Z]{1,20}$/.test(value);
}

function readTag(source: string, index: number): Tag {
  let cursor = index + 1;
  let closing = false;
  if (source[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  while (cursor < source.length && isSpace(source[cursor])) cursor += 1;
  const nameStart = cursor;
  while (cursor < source.length && isName(source[cursor])) cursor += 1;
  if (cursor === nameStart) throw new Error("SVG has a broken tag");
  const name = source.slice(nameStart, cursor);
  const attrs: Attr[] = [];
  if (closing) {
    while (cursor < source.length && isSpace(source[cursor])) cursor += 1;
    if (source[cursor] !== ">") throw new Error("SVG has a broken tag");
    return { closing, name, attrs, selfClosing: false, next: cursor + 1 };
  }
  for (;;) {
    while (cursor < source.length && isSpace(source[cursor])) cursor += 1;
    if (cursor >= source.length) throw new Error("SVG has a broken tag");
    if (source[cursor] === ">") return { closing, name, attrs, selfClosing: false, next: cursor + 1 };
    if (source[cursor] === "/" && source[cursor + 1] === ">") {
      return { closing, name, attrs, selfClosing: true, next: cursor + 2 };
    }
    const attrStart = cursor;
    while (cursor < source.length && isName(source[cursor])) cursor += 1;
    const attrName = source.slice(attrStart, cursor);
    if (!attrName) throw new Error("SVG has a broken tag");
    while (cursor < source.length && isSpace(source[cursor])) cursor += 1;
    if (source[cursor] !== "=") throw new Error("SVG attributes must be quoted");
    cursor += 1;
    while (cursor < source.length && isSpace(source[cursor])) cursor += 1;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") throw new Error("SVG attributes must be quoted");
    cursor += 1;
    const valueStart = cursor;
    while (cursor < source.length && source[cursor] !== quote) cursor += 1;
    if (cursor >= source.length) throw new Error("SVG has a broken tag");
    attrs.push({ name: attrName, value: source.slice(valueStart, cursor) });
    cursor += 1;
    if (attrs.length > 40) throw new Error("SVG is too complex");
  }
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function isName(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9:_-]/.test(char));
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replaceAll(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}
