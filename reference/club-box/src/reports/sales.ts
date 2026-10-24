import type Database from "better-sqlite3";
import { AppError } from "../errors.js";

export type SalesRow = {
  source: "lightning" | "playtomic";
  id: string;
  status: string;
  amount: string;
  currency: string;
  occurredAt: string;
  detail: string;
};

export function salesRows(db: Database.Database, fromIso: string, toIso: string): SalesRow[] {
  const lightning = db
    .prepare(
      `SELECT b.id, b.amount_minor, b.currency, b.confirmed_at, c.name AS court_name
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       JOIN courts c ON c.id = s.court_id
       WHERE b.confirmed_at >= ? AND b.confirmed_at <= ?
       ORDER BY b.confirmed_at ASC`,
    )
    .all(fromIso, toIso) as Array<{
    id: string;
    amount_minor: number;
    currency: string;
    confirmed_at: string;
    court_name: string;
  }>;
  const imported = db
    .prepare(
      `SELECT club_payment_id, status, total_text, product_sku,
              COALESCE(NULLIF(payment_date, ''), NULLIF(service_date, ''), synced_at) AS occurred_at
       FROM playtomic_payments
       WHERE COALESCE(NULLIF(payment_date, ''), NULLIF(service_date, ''), synced_at) >= ?
         AND COALESCE(NULLIF(payment_date, ''), NULLIF(service_date, ''), synced_at) <= ?
       ORDER BY occurred_at ASC`,
    )
    .all(fromIso, toIso) as Array<{
    club_payment_id: string;
    status: string | null;
    total_text: string | null;
    product_sku: string | null;
    occurred_at: string;
  }>;
  const rows: SalesRow[] = lightning.map((row) => ({
    source: "lightning",
    id: row.id,
    status: "booked",
    amount: String(row.amount_minor),
    currency: row.currency,
    occurredAt: row.confirmed_at,
    detail: row.court_name,
  }));
  for (const row of imported) {
    rows.push({
      source: "playtomic",
      id: row.club_payment_id,
      status: row.status ?? "",
      amount: row.total_text ?? "",
      currency: "",
      occurredAt: row.occurred_at,
      detail: row.product_sku ?? "",
    });
  }
  rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return rows;
}

export function salesCsv(rows: SalesRow[]): string {
  const lines = ["source,id,status,amount,currency,occurred_at,detail"];
  for (const row of rows) {
    lines.push(
      [row.source, row.id, row.status, row.amount, row.currency, row.occurredAt, row.detail].map(csvCell).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseReportRange(fromRaw: string | null, toRaw: string | null): { fromIso: string; toIso: string } {
  if (!fromRaw || !toRaw) throw new AppError(400, "from and to are required");
  const fromIso = bound(fromRaw, "from", false);
  const toIso = bound(toRaw, "to", true);
  if (fromIso > toIso) throw new AppError(400, "from must be before to");
  return { fromIso, toIso };
}

function bound(raw: string, name: string, end: boolean): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return end ? `${raw}T23:59:59.999Z` : `${raw}T00:00:00.000Z`;
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw new AppError(400, `${name} must be YYYY-MM-DD or an ISO time`);
  return new Date(parsed).toISOString();
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
