import {
  EXPORT_COLUMNS,
  exportFilename,
  toCsv,
  type ExportFilters,
  type ExportFormat,
} from "@uxie/core";
import type { ReviewRepo } from "./repos/review";

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
  rowCount: number;
}

/**
 * FR-7.3 export shared by the admin route and `pnpm uxie export`: rows from `export_rows`
 * (test conversations, deleted and — for research — non-consenting students excluded), CSV with
 * BOM and formula escaping or JSON, and an `export_log` row for every export.
 */
export async function buildExport(
  repo: ReviewRepo,
  input: {
    filters: ExportFilters;
    format: ExportFormat;
    researchOnly: boolean;
    instructorId: string | null;
    channel: "web" | "cli";
    now?: Date;
  },
): Promise<ExportFile> {
  const now = input.now ?? new Date();
  const rows = await repo.exportRows(input.filters, input.researchOnly);
  const body =
    input.format === "csv"
      ? toCsv(EXPORT_COLUMNS, rows)
      : `${JSON.stringify(
          {
            exportedAt: now.toISOString(),
            researchOnly: input.researchOnly,
            filters: input.filters,
            columns: EXPORT_COLUMNS,
            rows,
          },
          null,
          2,
        )}\n`;
  await repo.logExport({
    instructorId: input.instructorId,
    channel: input.channel,
    format: input.format,
    filters: input.filters,
    researchOnly: input.researchOnly,
    rowCount: rows.length,
  });
  return {
    filename: exportFilename(input.format, input.researchOnly, now),
    contentType:
      input.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    body,
    rowCount: rows.length,
  };
}
