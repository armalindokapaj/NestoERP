import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { logger } from "@/lib/core/observability/logger";
import { toCsv, type CsvKind, type CsvValue } from "@/lib/utils/csv";

/**
 * The one exporter behind every CSV download (AUD-08 §7, DT-14..DT-18, DT-22).
 *
 * A module says *what* a file holds — its standard columns, how to read every
 * matching row, its limits — and this decides *how* it leaves:
 *
 *   read (the list's own query, every match, at most `maxRows + 1` rows, under
 *   a deadline) → refuse past a limit → serialise with typed cells → measure
 *   the encoded bytes → refuse past a limit → answer one complete file.
 *
 * Nothing is ever cut short. Past the row cap, the byte cap or the deadline
 * the whole request is refused with a JSON error in the ordinary envelope and a
 * sentence telling the person to narrow their filters — never a partial file,
 * never an error body served as `.csv` (DT-17). The read finishes, and the file
 * is built in memory, before a single byte is sent, so no database work waits
 * on a slow download (AUD-08 §7 "do not hold a transaction open").
 *
 * The count is the rows. A file's row count is the number of rows the one read
 * returned, never a second `count()` that a concurrent write could have moved
 * (DT-16); a list service's own total is only used to refuse early.
 *
 * Standard columns (AUD-08 §7): a documented schema per export, independent of
 * which columns the screen shows, carrying the record's stable id, its business
 * number, status labels, and the Company / Project ids and currency that keep
 * two companies' identical numbers apart. Columns the reader may not see are
 * absent, not blank — each module's DTO has already redacted them.
 *
 * Encoding: UTF-8 with a byte-order mark, so Excel opens Albanian letters
 * correctly; the mark is added to the response body only (a module's `csv`
 * string is the text itself). Line breaks are CRLF unless an export has always
 * used LF. Amounts and quantities are decimal strings written bare in a column
 * declared numeric, with the currency in its own column; date-only values are
 * `YYYY-MM-DD`; timestamps are ISO 8601 in UTC (`…Z`).
 */

/* -------------------------------------------------------------------------- */
/* Contract                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How a column's values are written. `decimal` and `integer` are the only
 * numeric kinds; everything else is text and goes through formula guarding.
 */
export type ExportValueKind = "text" | "code" | "status" | "integer" | "decimal" | "date" | "datetime" | "boolean";

export type ExportColumn<R> = {
  header: string;
  kind: ExportValueKind;
  value: (row: R) => string | number | boolean | null | undefined;
};

export type ExportLimits = {
  /** Most rows one synchronous file may hold. */
  maxRows: number;
  /** Most bytes of encoded output (BOM included). */
  maxBytes: number;
  /** How long the read may take before the request is refused. */
  maxDurationMs: number;
};

/** The defaults for a previously unbounded synchronous export (AUD-08 §7). */
export const DEFAULT_EXPORT_LIMITS: ExportLimits = {
  maxRows: 10_000,
  maxBytes: 10 * 1024 * 1024,
  maxDurationMs: 30_000,
};

export type CsvLayout = {
  lineBreak: "\r\n" | "\n";
  /** Quote every cell (files that always did keep doing so). */
  quoteAll?: boolean;
  /** End the last row with a line break too (the finance registers always have). */
  trailingLineBreak?: boolean;
};

export const DEFAULT_LAYOUT: CsvLayout = { lineBreak: "\r\n" };

/**
 * What one read returns: every matching row it found (at most the cap + 1),
 * and the list's own count of its query when it has one. `refined` says the
 * service narrowed its rows after reading them (a derived filter), so fewer
 * rows than the count is expected rather than a sign of a cut-short read.
 */
export type ExportRead<R> = { rows: R[]; total?: number; refined?: boolean };

export type PreparedExport<R = unknown> = {
  filename: string;
  /** The CSV text, without the byte-order mark. */
  csv: string;
  rows: R[];
  rowCount: number;
  /** Encoded size of the response body, BOM included. */
  byteLength: number;
  evaluatedAt: Date;
};

const BOM = "﻿";
const BOM_BYTES = 3;

/* -------------------------------------------------------------------------- */
/* Refusals                                                                    */
/* -------------------------------------------------------------------------- */

/** Past the row cap: the finance registers' sentence and code (AUD-01 §8), for every export. */
export function exportTooManyRows(limit: number): AccessError {
  return new AccessError(
    "VALIDATION_ERROR",
    `Too many records to export. Narrow your filters to ${limit.toLocaleString("en-US")} records or fewer.`,
    { code: "EXPORT_LIMIT_EXCEEDED", limit, reason: "rows" },
  );
}

export function exportTooLarge(maxBytes: number): AccessError {
  const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return new AccessError(
    "VALIDATION_ERROR",
    `This export would be larger than ${mb} MB. Narrow your filters and export again.`,
    { code: "EXPORT_LIMIT_EXCEEDED", limit: maxBytes, reason: "bytes" },
  );
}

/**
 * The read handed back fewer rows than its own count said match, and fewer
 * than were asked for: a service that capped the page, or rows removed between
 * its count and its read. Either way the file would be short, so none is sent.
 */
export function exportIncomplete(): AccessError {
  return new AccessError(
    "TEMPORARILY_UNAVAILABLE",
    "The records changed while this export was being prepared. Export again.",
    { code: "EXPORT_INCOMPLETE" },
  );
}

export function exportTimedOut(maxDurationMs: number): AccessError {
  return new AccessError(
    "TEMPORARILY_UNAVAILABLE",
    "This export took too long to prepare. Narrow your filters and export again.",
    { code: "EXPORT_TIMEOUT", limit: maxDurationMs },
  );
}

/* -------------------------------------------------------------------------- */
/* Cells                                                                       */
/* -------------------------------------------------------------------------- */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** A business date: `YYYY-MM-DD`, whether the DTO carried the day or its UTC-midnight instant. */
export function exportDate(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (DATE_ONLY.test(value)) return value;
  if (ISO_INSTANT.test(value)) return new Date(value).toISOString().slice(0, 10);
  return value;
}

/** A moment: ISO 8601 in UTC, the zone always written. */
export function exportDateTime(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : ISO_INSTANT.test(value) ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return typeof value === "string" ? value : null;
  return date.toISOString();
}

function cellValue(kind: ExportValueKind, raw: string | number | boolean | null | undefined): CsvValue {
  if (raw === null || raw === undefined) return null;
  switch (kind) {
    case "boolean":
      return raw ? "Yes" : "No";
    case "date":
      return typeof raw === "string" ? exportDate(raw) : String(raw);
    case "datetime":
      return typeof raw === "string" ? exportDateTime(raw) : String(raw);
    case "integer":
    case "decimal":
      return typeof raw === "boolean" ? String(raw) : raw;
    default:
      return String(raw);
  }
}

function csvKind(kind: ExportValueKind): CsvKind {
  return kind === "decimal" || kind === "integer" ? "number" : "text";
}

/** The file's text for these rows, with every cell typed by its column. */
export function serializeRows<R>(columns: ReadonlyArray<ExportColumn<R>>, rows: readonly R[], layout: CsvLayout = DEFAULT_LAYOUT): string {
  const text = toCsv(
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => cellValue(column.kind, column.value(row)))),
    { lineBreak: layout.lineBreak, quoteAll: layout.quoteAll, kinds: columns.map((column) => csvKind(column.kind)) },
  );
  return layout.trailingLineBreak ? `${text}${layout.lineBreak}` : text;
}

/* -------------------------------------------------------------------------- */
/* Preparing a file                                                            */
/* -------------------------------------------------------------------------- */

/** Resolves the read, or refuses once the deadline passes (the read is abandoned, nothing is sent). */
async function withinDeadline<T>(work: Promise<T>, maxDurationMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(exportTimedOut(maxDurationMs)), maxDurationMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function resolveLimits(limits?: Partial<ExportLimits>): ExportLimits {
  return { ...DEFAULT_EXPORT_LIMITS, ...limits };
}

export type ExportDefinition<R> = {
  /** The list's manifest id, e.g. `sales.leads`. Low-cardinality; used in logs. */
  id: string;
  filename: string;
  columns: ReadonlyArray<ExportColumn<R>>;
  limits?: Partial<ExportLimits>;
  layout?: CsvLayout;
  evaluatedAt?: Date;
  /**
   * Every row the list's own query matches, in the list's order, asking for no
   * more than `take` (the cap + 1, so one extra row proves the cap was passed).
   */
  read: (take: number) => Promise<ExportRead<R>>;
};

/**
 * Reads, checks and serialises one export. Throws a controlled refusal past any
 * limit; otherwise the file is complete.
 */
export async function prepareExport<R>(definition: ExportDefinition<R>): Promise<PreparedExport<R>> {
  const limits = resolveLimits(definition.limits);
  const evaluatedAt = definition.evaluatedAt ?? new Date();
  const started = Date.now();

  const take = limits.maxRows + 1;
  const { rows, total, refined } = await withinDeadline(definition.read(take), limits.maxDurationMs);
  if (rows.length > limits.maxRows || (total ?? 0) > limits.maxRows) throw exportTooManyRows(limits.maxRows);
  if (total !== undefined && !refined && rows.length < Math.min(total, take)) throw exportIncomplete();

  const csv = serializeRows(definition.columns, rows, definition.layout ?? DEFAULT_LAYOUT);
  const byteLength = Buffer.byteLength(csv, "utf8") + BOM_BYTES;
  if (byteLength > limits.maxBytes) throw exportTooLarge(limits.maxBytes);

  logger.info("export.prepared", { export: definition.id, rows: rows.length, bytes: byteLength, durationMs: Date.now() - started });
  return { filename: safeFilename(definition.filename), csv, rows, rowCount: rows.length, byteLength, evaluatedAt };
}

/**
 * An already-read, already-serialised file (the finance registers, whose read
 * and snapshot are AUD-01's) through the same byte check and response.
 */
export function preparedFromText<R>(input: { filename: string; csv: string; rows: R[]; evaluatedAt: Date; limits?: Partial<ExportLimits> }): PreparedExport<R> {
  const limits = resolveLimits(input.limits);
  if (input.rows.length > limits.maxRows) throw exportTooManyRows(limits.maxRows);
  const csv = input.csv.startsWith(BOM) ? input.csv.slice(1) : input.csv;
  const byteLength = Buffer.byteLength(csv, "utf8") + BOM_BYTES;
  if (byteLength > limits.maxBytes) throw exportTooLarge(limits.maxBytes);
  return { filename: safeFilename(input.filename), csv, rows: input.rows, rowCount: input.rows.length, byteLength, evaluatedAt: input.evaluatedAt };
}

/* -------------------------------------------------------------------------- */
/* Answering                                                                   */
/* -------------------------------------------------------------------------- */

/** `a-b_c.csv`: letters, digits, dot, dash and underscore only, and always `.csv`. */
export function safeFilename(name: string): string {
  const base = name
    .replace(/\.csv$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return `${base || "nesto-export"}.csv`;
}

/**
 * The download: CSV bytes with a BOM, a safe attachment name, and never a
 * shared cache — an export answers one reader's scope at one moment.
 */
export function exportResponse(prepared: PreparedExport): Response {
  const body = new TextEncoder().encode(`${BOM}${prepared.csv}`);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // `safeFilename` leaves nothing that needs quoting or a `filename*`.
      "Content-Disposition": `attachment; filename="${prepared.filename}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Row-Count": String(prepared.rowCount),
      "X-Export-Evaluated-At": prepared.evaluatedAt.toISOString(),
      "X-Export-Scope": "all-matching; standard-columns",
    },
  });
}

/**
 * Who took a copy of company data, and which one (PRD #28 §130). The rows and
 * the filters are not recorded — the evidence is that an export happened, not
 * a second copy of what left. Written after the file is ready, so a refused
 * export records nothing.
 */
export async function recordExport(context: UserContext, input: { id: string; module: string; filename: string }): Promise<void> {
  await recordUserAction(context, {
    actionKey: AuditAction.REPORT_EXPORTED_CSV,
    entity: { type: "export", id: input.id, label: input.filename },
    metadata: { module: input.module },
  });
}
