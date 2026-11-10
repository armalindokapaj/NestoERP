import { judgeHop, sheetExportUrls, sheetFetchOrigin, type SheetRef } from "./unit-sheet.link";
import { mergeGrid, parseCsv, parseGviz, SheetParseError, type SheetGrid } from "./unit-sheet.parse";

/**
 * Reading a Google Sheet shared as "Anyone with the link can view"
 * (2026-11-10). Server only.
 *
 * Two GET requests to Google's own export endpoints, built from the
 * spreadsheet's id and tab (unit-sheet.link.ts), in parallel, with no cookie
 * and no credential: the CSV of the tab, and the Visualization API's JSON of
 * it for typed numbers (unit-sheet.parse.ts). Redirects are followed by hand
 * and only to Google's export hosts. Ten seconds for both, five megabytes for
 * each answer, five thousand rows. A sheet that is not shared publicly sends
 * NESTO to Google's sign-in, or answers 401/403, or an HTML page: all of it
 * reads as "not shared", with the words to fix it.
 */

export const SHEET_FETCH_TIMEOUT_MS = 10_000;
export const SHEET_MAX_BYTES = 5 * 1024 * 1024;
const MAX_HOPS = 5;

export type SheetReadProblem = "NOT_SHARED" | "NOT_FOUND" | "UNAVAILABLE" | "TOO_LARGE" | "UNREADABLE";

export const SHEET_READ_MESSAGES: Record<SheetReadProblem, string> = {
  NOT_SHARED: "NESTO can't read this sheet. In Google Sheets, open Share → General access → 'Anyone with the link' (Viewer), then try again.",
  NOT_FOUND: "NESTO can't find this sheet. Check the link, and that its tab still exists.",
  UNAVAILABLE: "Google did not answer in time. Try again in a moment.",
  TOO_LARGE: "This sheet is too large. NESTO reads up to 5,000 rows, 60 columns and 5 MB.",
  UNREADABLE: "NESTO could not read this sheet. Check the link and try again.",
};

export class SheetReadError extends Error {
  constructor(readonly problem: SheetReadProblem) {
    super(SHEET_READ_MESSAGES[problem]);
  }
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

type Fetched = { body: string; contentType: string; disposition: string | null };

/** The body, refused past `max` bytes whatever the server claims its length is. */
async function readCapped(response: Response, max: number): Promise<string> {
  const claimed = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(claimed) && claimed > max) {
    await response.body?.cancel().catch(() => undefined);
    throw new SheetReadError("TOO_LARGE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new SheetReadError("TOO_LARGE");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

/** One export, its redirects followed by hand and judged hop by hop (`judgeHop`). */
export async function fetchExport(url: string, options: { fetcher: Fetcher; signal: AbortSignal; fixtureOrigin: string | null; maxBytes?: number }): Promise<Fetched> {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const verdict = judgeHop(current, options.fixtureOrigin);
    if (verdict === "sign_in") throw new SheetReadError("NOT_SHARED");
    if (verdict === "refused") throw new SheetReadError("UNREADABLE");
    const response = await options.fetcher(current, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { accept: "text/csv, application/json, text/plain;q=0.9, */*;q=0.1" },
      signal: options.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new SheetReadError("UNREADABLE");
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new SheetReadError("UNREADABLE");
      }
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new SheetReadError("NOT_SHARED");
    if (response.status === 404 || response.status === 400) throw new SheetReadError("NOT_FOUND");
    if (response.status === 429 || response.status >= 500) throw new SheetReadError("UNAVAILABLE");
    if (!response.ok) throw new SheetReadError("UNREADABLE");
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const body = await readCapped(response, options.maxBytes ?? SHEET_MAX_BYTES);
    // A sign-in or "request access" page rather than the data.
    if (contentType.includes("text/html") || /^\s*<!doctype html|^\s*<html/i.test(body.slice(0, 200))) throw new SheetReadError("NOT_SHARED");
    return { body, contentType, disposition: response.headers.get("content-disposition") };
  }
  throw new SheetReadError("UNREADABLE");
}

/**
 * The title Google gives the file it exports — "Riverside units - Sheet1.csv"
 * — from the answer's Content-Disposition, without the extension. Null when
 * there is none.
 */
export function titleFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  let name: string | null = null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (extended) {
    try {
      name = decodeURIComponent(extended[1]!.trim());
    } catch {
      name = null;
    }
  }
  if (name === null) {
    const plain = /filename\s*=\s*"([^"]*)"/i.exec(disposition) ?? /filename\s*=\s*([^;]+)/i.exec(disposition);
    name = plain ? plain[1]!.trim() : null;
  }
  if (!name) return null;
  const cleaned = name
    .replace(/\.csv$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return cleaned || null;
}

export type SheetRead = { grid: SheetGrid; title: string | null };

/**
 * Reads a tab: the CSV, and the typed values when Google gives them. The CSV
 * decides whether the sheet can be read at all; the typed values are a bonus
 * that is dropped when they cannot be read or do not line up.
 */
export async function readGoogleSheet(ref: SheetRef, deps: { fetcher?: Fetcher; env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<SheetRead> {
  const { origin, fixture } = sheetFetchOrigin(deps.env ?? process.env);
  const urls = sheetExportUrls(ref, origin);
  const fetcher = deps.fetcher ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SHEET_FETCH_TIMEOUT_MS);
  const options = { fetcher, signal: controller.signal, fixtureOrigin: fixture ? origin : null };
  try {
    const [csv, gviz] = await Promise.all([fetchExport(urls.csv, options), fetchExport(urls.gviz, options).catch((error: unknown) => error)]);
    let rows: string[][];
    try {
      rows = parseCsv(csv.body);
    } catch (error) {
      if (error instanceof SheetParseError) throw new SheetReadError(error.reason === "MALFORMED" ? "UNREADABLE" : "TOO_LARGE");
      throw error;
    }
    const typed = gviz instanceof Error || gviz === null || typeof gviz !== "object" ? null : parseGviz((gviz as Fetched).body);
    let grid: SheetGrid;
    try {
      grid = mergeGrid(rows, typed?.ok ? typed.table : null);
    } catch (error) {
      if (error instanceof SheetParseError) throw new SheetReadError("TOO_LARGE");
      throw error;
    }
    return { grid, title: titleFromDisposition(csv.disposition) };
  } catch (error) {
    if (error instanceof SheetReadError) throw error;
    // Aborted by the deadline, or the network failed on the way.
    throw new SheetReadError("UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
