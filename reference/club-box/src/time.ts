type PartMap = Record<string, string>;

function partsInZone(date: Date, timeZone: string): PartMap {
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
  const map: PartMap = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

function partNumber(parts: PartMap, name: string): number {
  const raw = parts[name];
  if (raw === undefined) throw new Error(`missing ${name} in zoned time`);
  return Number(raw);
}

/** Offset such that local = utc + offset, in milliseconds, at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
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

/**
 * Convert a civil date and clock time in an IANA timezone to a UTC Date.
 * `ymd` is `YYYY-MM-DD`. `hm` is `HH:MM`.
 */
export function zonedLocalToUtc(ymd: string, hm: string, timeZone: string): Date {
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

/** Minutes since local midnight in the club timezone. */
export function minutesOfDay(date: Date, timeZone: string): number {
  const parts = partsInZone(date, timeZone);
  let hour = partNumber(parts, "hour");
  if (hour === 24) hour = 0;
  return hour * 60 + partNumber(parts, "minute");
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Start of the local calendar day and the next local midnight, as UTC instants. */
export function localDayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = partsInZone(now, timeZone);
  const year = parts.year ?? "1970";
  const month = parts.month ?? "01";
  const day = parts.day ?? "01";
  const ymd = `${year}-${month}-${day}`;
  const start = zonedLocalToUtc(ymd, "00:00", timeZone);
  const end = zonedLocalToUtc(nextCivilDate(ymd), "00:00", timeZone);
  return { start, end };
}

function nextCivilDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error("invalid local date");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
