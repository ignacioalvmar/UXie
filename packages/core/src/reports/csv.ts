/**
 * CSV for research exports (FR-7.3): UTF-8 with BOM, CRLF line ends, RFC 4180 quoting, and
 * formula-injection escaping. A string cell that starts with `= + - @`, a tab or a carriage return
 * is prefixed with `'` so spreadsheets show it as text. Numbers and booleans are written as they
 * are: they cannot carry a formula (so a rating of -1 stays numeric).
 */

export const CSV_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let s = typeof value === "string" ? value : JSON.stringify(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Header row plus one line per row, in `columns` order; starts with the BOM. */
export function toCsv<C extends string>(
  columns: readonly C[],
  rows: Iterable<Partial<Record<C, unknown>>>,
): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
