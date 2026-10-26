// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Daniel Solano and BitPadel contributors

/** Matches the cap on GET /api/slots. A full page means the window may be incomplete. */
export const SLOT_PAGE_LIMIT = 500;

const SAT_CODES = new Set(["SAT", "SATS"]);

const SPORT_WORDS = [
  ["pickleball", "Pickleball"],
  ["badminton", "Badminton"],
  ["padel", "Padel"],
  ["tennis", "Tennis"],
  ["squash", "Squash"],
];

const WEEKDAY_LABELS = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
];

export function weekdayHeaders() {
  return WEEKDAY_LABELS.map(([shortLabel, longLabel]) => ({ shortLabel, longLabel }));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function partsInZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

function partNumber(parts, name) {
  const raw = parts[name];
  if (raw === undefined) throw new Error(`missing ${name} in zoned time`);
  return Number(raw);
}

function offsetMs(date, timeZone) {
  const parts = partsInZone(date, timeZone);
  let hour = partNumber(parts, "hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    partNumber(parts, "year"),
    partNumber(parts, "month") - 1,
    partNumber(parts, "day"),
    hour,
    partNumber(parts, "minute"),
    partNumber(parts, "second"),
  );
  return asUtc - date.getTime();
}

/** Civil date and clock time in an IANA timezone, as a UTC instant. */
export function zonedLocalToUtc(ymd, hm, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!dateMatch || !timeMatch) throw new Error("invalid local date or time");
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error("invalid local date or time");
  }
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const firstOffset = offsetMs(guess, timeZone);
  let utc = new Date(guess.getTime() - firstOffset);
  const secondOffset = offsetMs(utc, timeZone);
  if (secondOffset !== firstOffset) utc = new Date(guess.getTime() - secondOffset);
  return utc;
}

export function civilDate(date, timeZone) {
  const parts = partsInZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCivilDays(ymd, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error("invalid local date");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export function monthOf(ymd) {
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) };
}

export function shiftMonth(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Inclusive local midnight through the next local midnight, as UTC instants. */
export function dayBoundsIso(ymd, timeZone) {
  return {
    from: zonedLocalToUtc(ymd, "00:00", timeZone).toISOString(),
    to: zonedLocalToUtc(addCivilDays(ymd, 1), "00:00", timeZone).toISOString(),
  };
}

export function monthBoundsIso(year, month, timeZone) {
  const weeks = monthMatrix(year, month);
  const first = weeks[0]?.[0]?.ymd;
  const lastWeek = weeks[weeks.length - 1];
  const last = lastWeek?.[lastWeek.length - 1]?.ymd;
  if (!first || !last) throw new Error("empty month");
  return {
    from: zonedLocalToUtc(first, "00:00", timeZone).toISOString(),
    to: zonedLocalToUtc(addCivilDays(last, 1), "00:00", timeZone).toISOString(),
  };
}

export function upcomingDays(todayYmd, count) {
  const days = [];
  for (let index = 0; index < count; index += 1) days.push(addCivilDays(todayYmd, index));
  return days;
}

/** Sunday-first month grid, including days from the neighboring months. */
export function monthMatrix(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  const firstYmd = `${year}-${pad(month)}-01`;
  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ ymd: addCivilDays(firstYmd, index - firstWeekday), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ ymd: `${year}-${pad(month)}-${pad(day)}`, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const previous = cells[cells.length - 1]?.ymd;
    if (!previous) break;
    cells.push({ ymd: addCivilDays(previous, 1), inMonth: false });
  }
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export function monthTitle(year, month) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(date);
}

export function chipLabel(ymd, todayYmd) {
  if (ymd === todayYmd) return "Today";
  if (ymd === addCivilDays(todayYmd, 1)) return "Tomorrow";
  const noon = new Date(`${ymd}T12:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(noon);
  return `${weekday} ${Number(ymd.slice(8, 10))}`;
}

export function dayAriaLabel(ymd, openCount) {
  const date = new Date(`${ymd}T12:00:00.000Z`);
  const long = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  if (openCount === 1) return `${long}, 1 open time`;
  if (openCount > 1) return `${long}, ${openCount} open times`;
  return `${long}, no open times`;
}

export function formatClock(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(instant));
}

export function formatDayHeading(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(instant));
}

export function formatYmdHeading(ymd, timeZone) {
  return formatDayHeading(dayBoundsIso(ymd, timeZone).from, timeZone);
}

function clockParts(instant, timeZone) {
  const formatted = formatClock(instant, timeZone);
  const match = /^(.*)\s(AM|PM)$/.exec(formatted);
  if (!match || !match[1] || !match[2]) return { time: formatted, period: "" };
  return { time: match[1], period: match[2] };
}

export function formatTimeRange(startsAt, endsAt, timeZone) {
  const start = clockParts(startsAt, timeZone);
  const end = clockParts(endsAt, timeZone);
  if (start.period && start.period === end.period) return `${start.time}–${end.time} ${end.period}`;
  return `${formatClock(startsAt, timeZone)} – ${formatClock(endsAt, timeZone)}`;
}

export function durationMinutesOf(slot) {
  const minutes = Math.round((Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000);
  return Number.isFinite(minutes) ? minutes : 0;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const hourLabel = hours === 1 ? "1 hour" : `${hours} hours`;
    return `${hourLabel} ${rest} min`;
  }
  return `${minutes} min`;
}

export function formatPrice(amountMinor, currency, decimals) {
  const code = String(currency || "").trim().toUpperCase();
  const places = Number.isInteger(decimals) && decimals >= 0 ? decimals : 0;
  if (SAT_CODES.has(code)) {
    const sats = places === 0 ? amountMinor : amountMinor / 10 ** places;
    const formatted = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: places,
      minimumFractionDigits: 0,
    }).format(sats);
    return `${formatted} sats`;
  }
  const major = amountMinor / 10 ** places;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(major);
  } catch {
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(major);
    return `${formatted} ${code}`;
  }
}

export function priceLabel(slot, decimals) {
  const guest = slot.guestPriceMinor ?? slot.priceMinor;
  const member = slot.memberPriceMinor ?? guest;
  const guestText = formatPrice(guest, slot.currency, decimals);
  if (guest === member) return guestText;
  return `Guest ${guestText} · Member ${formatPrice(member, slot.currency, decimals)}`;
}

export function sportOf(name) {
  const lower = String(name || "").toLowerCase();
  for (const [needle, label] of SPORT_WORDS) {
    if (lower.includes(needle)) return label;
  }
  return "";
}

export function sportChoices(courts) {
  const found = new Set();
  for (const court of courts) {
    const sport = sportOf(court.name);
    if (sport) found.add(sport);
  }
  return [...found].sort();
}

export function visualState(slot, nowMs) {
  if (Date.parse(slot.startsAt) <= nowMs) return "past";
  if (slot.blocked) return "unavailable";
  switch (slot.status) {
    case "open":
      return "open";
    case "held":
      return "held";
    case "booked":
      return "booked";
    case "cancelled":
      return "unavailable";
    default: {
      const unknown = slot.status;
      throw new Error(`Unknown slot status: ${String(unknown)}`);
    }
  }
}

export function stateLabel(state) {
  switch (state) {
    case "open":
      return "Open";
    case "held":
      return "Held";
    case "booked":
      return "Booked";
    case "unavailable":
      return "Unavailable";
    case "past":
      return "Ended";
    case "empty":
      return "Not offered";
    case "continued":
      return "Continues";
    default: {
      const unknown = state;
      throw new Error(`Unknown schedule state: ${String(unknown)}`);
    }
  }
}

export function openDayCounts(slots, timeZone, nowMs) {
  const counts = new Map();
  for (const slot of slots) {
    if (visualState(slot, nowMs) !== "open") continue;
    const ymd = civilDate(new Date(slot.startsAt), timeZone);
    counts.set(ymd, (counts.get(ymd) ?? 0) + 1);
  }
  return counts;
}

export function durationChoices(slots) {
  const found = new Set();
  for (const slot of slots) {
    const minutes = durationMinutesOf(slot);
    if (minutes > 0) found.add(minutes);
  }
  return [...found].sort((left, right) => left - right);
}

export function buildSchedule(input) {
  const durationMinutes = input.durationMinutes || 0;
  const sport = input.sport || "";
  const courtId = input.courtId || "";
  let courts = input.courts.filter((court) => {
    if (courtId && court.id !== courtId) return false;
    if (sport && sportOf(court.name) !== sport) return false;
    return true;
  });
  const allowed = new Set(courts.map((court) => court.id));
  const visible = input.slots.filter((slot) => {
    if (!allowed.has(slot.courtId)) return false;
    if (durationMinutes && durationMinutesOf(slot) !== durationMinutes) return false;
    return true;
  });
  const used = new Set(visible.map((slot) => slot.courtId));
  courts = courts.filter((court) => used.has(court.id));
  const starts = [...new Set(visible.map((slot) => slot.startsAt))].sort();
  const rows = starts.map((startsAt) => ({
    startsAt,
    cells: courts.map((court) => cellFor(visible, court, startsAt, input.nowMs)),
  }));
  return { courts, rows };
}

function cellFor(slots, court, startsAt, nowMs) {
  const exact = slots.find((slot) => slot.courtId === court.id && slot.startsAt === startsAt) ?? null;
  if (exact) return { court, slot: exact, state: visualState(exact, nowMs) };
  const startMs = Date.parse(startsAt);
  const covering = slots.find((slot) => {
    return slot.courtId === court.id && Date.parse(slot.startsAt) < startMs && Date.parse(slot.endsAt) > startMs;
  });
  if (covering) return { court, slot: covering, state: "continued" };
  return { court, slot: null, state: "empty" };
}

export function shouldSplitSlotPage(count, spanMs) {
  return count >= SLOT_PAGE_LIMIT && spanMs > 60 * 60 * 1000;
}

export function rangeMidpoint(fromIso, toIso) {
  const start = Date.parse(fromIso);
  const end = Date.parse(toIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return new Date(start + Math.floor((end - start) / 2)).toISOString();
}
