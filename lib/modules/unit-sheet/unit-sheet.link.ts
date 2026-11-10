/**
 * A Google Sheet's link, and the only addresses NESTO fetches for it
 * (2026-11-10). Pure: no network here.
 *
 * The server fetches something a person pasted, so the pasted text is never
 * fetched. Only `https://docs.google.com/spreadsheets/d/<id>/…` is accepted;
 * the spreadsheet's id and tab (`gid`) are taken from it and the export URLs
 * are built from those two alone. Redirects are followed by hand, and only to
 * Google's own hosts that serve these exports — docs.google.com and
 * *.googleusercontent.com. A redirect to Google's sign-in means the sheet is
 * not shared with "Anyone with the link".
 *
 * Tests and local development may point the reader at a fixture server on
 * this machine (`NESTO_SHEET_FETCH_ORIGIN`), and only when APP_ENV says
 * development or test. Anywhere else — production, staging, a demo, APP_ENV
 * unset or misspelled — the setting is ignored and Google is asked.
 */

export type SheetRef = { spreadsheetId: string; gid: string | null };

export type LinkProblem = "NOT_A_LINK" | "NOT_GOOGLE_SHEETS" | "PUBLISHED_LINK";
export type ParsedLink = { ok: true; ref: SheetRef; url: string } | { ok: false; problem: LinkProblem };

export const SHEET_LINK_MAX = 2_048;
export const GOOGLE_SHEETS_ORIGIN = "https://docs.google.com";

/** A spreadsheet's path; `/u/1/` is the path Google gives a person signed in to a second account. */
const SHEET_PATH = /^\/spreadsheets\/(?:u\/\d{1,2}\/)?d\/([A-Za-z0-9_-]{20,128})(?:\/.*)?$/;
const PUBLISHED_PATH = /^\/spreadsheets\/(?:u\/\d{1,2}\/)?d\/e\//;
const GID = /^\d{1,12}$/;

/** The tab a link names: `#gid=123` (what the address bar shows) or `?gid=123`. */
function gidOf(url: URL): string | null {
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("gid");
  if (fromHash !== null && GID.test(fromHash)) return fromHash;
  const fromQuery = url.searchParams.get("gid");
  if (fromQuery !== null && GID.test(fromQuery)) return fromQuery;
  return null;
}

/** Reads a pasted link. The text is never fetched; only the id and tab taken from it are. */
export function parseSheetLink(text: unknown): ParsedLink {
  if (typeof text !== "string") return { ok: false, problem: "NOT_A_LINK" };
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SHEET_LINK_MAX) return { ok: false, problem: "NOT_A_LINK" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, problem: "NOT_A_LINK" };
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port !== "" || url.username !== "" || url.password !== "") {
    return { ok: false, problem: "NOT_GOOGLE_SHEETS" };
  }
  if (PUBLISHED_PATH.test(url.pathname)) return { ok: false, problem: "PUBLISHED_LINK" };
  const match = SHEET_PATH.exec(url.pathname);
  if (!match) return { ok: false, problem: "NOT_GOOGLE_SHEETS" };
  return { ok: true, ref: { spreadsheetId: match[1]!, gid: gidOf(url) }, url: trimmed };
}

/** The tab's two exports: the CSV of what it shows, and the Visualization API's typed values (numbers as numbers). */
export function sheetExportUrls(ref: SheetRef, origin: string = GOOGLE_SHEETS_ORIGIN): { csv: string; gviz: string } {
  const id = encodeURIComponent(ref.spreadsheetId);
  const gid = ref.gid && GID.test(ref.gid) ? `&gid=${ref.gid}` : "";
  return {
    csv: `${origin}/spreadsheets/d/${id}/export?format=csv${gid}`,
    gviz: `${origin}/spreadsheets/d/${id}/gviz/tq?tqx=out:json&headers=1${gid}`,
  };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Where the reader sends its requests: Google, or — only when APP_ENV is
 * exactly development or test — a fixture server on this machine. Read from
 * the environment given, so a test can show production ignoring it.
 */
export function sheetFetchOrigin(env: Record<string, string | undefined> = process.env): { origin: string; fixture: boolean } {
  const app = env.APP_ENV?.trim().toLowerCase();
  const wanted = env.NESTO_SHEET_FETCH_ORIGIN?.trim();
  if (wanted && (app === "development" || app === "test")) {
    try {
      const url = new URL(wanted);
      if ((url.protocol === "http:" || url.protocol === "https:") && LOOPBACK.has(url.hostname) && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password) {
        return { origin: url.origin, fixture: true };
      }
    } catch {
      // Not an address: ignored, as anywhere else.
    }
  }
  return { origin: GOOGLE_SHEETS_ORIGIN, fixture: false };
}

export type HopVerdict = "allowed" | "sign_in" | "refused";

/**
 * Whether a redirect may be followed. Google's export answers from
 * docs.google.com and hands the file over from a *.googleusercontent.com
 * host; its sign-in page means the sheet is private. Anything else — another
 * host, plain http, a port, credentials in the address — is refused. With a
 * fixture origin, that origin is the only one followed.
 */
export function judgeHop(target: string, fixtureOrigin: string | null = null): HopVerdict {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "refused";
  }
  const host = url.hostname.toLowerCase();
  if (host === "accounts.google.com" || ((host === "www.google.com" || host === "google.com") && url.pathname.startsWith("/accounts"))) return "sign_in";
  if (url.username || url.password) return "refused";
  if (fixtureOrigin !== null) return url.origin === fixtureOrigin ? "allowed" : "refused";
  if (url.protocol !== "https:" || url.port !== "") return "refused";
  if (host === "docs.google.com" || (host.endsWith(".googleusercontent.com") && host.length > ".googleusercontent.com".length)) return "allowed";
  return "refused";
}
