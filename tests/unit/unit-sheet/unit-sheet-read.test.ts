import { describe, expect, it } from "vitest";

import { headerKey, mapHeaders, SHEET_COLUMNS, SHEET_HEADERS, columnOfHeader } from "@/lib/modules/unit-sheet/unit-sheet.columns";
import { fetchExport, readGoogleSheet, SheetReadError, titleFromDisposition, type Fetcher } from "@/lib/modules/unit-sheet/unit-sheet.fetch";
import { GOOGLE_SHEETS_ORIGIN, judgeHop, parseSheetLink, sheetExportUrls, sheetFetchOrigin } from "@/lib/modules/unit-sheet/unit-sheet.link";
import { mergeGrid, parseCsv, parseGviz, SheetParseError } from "@/lib/modules/unit-sheet/unit-sheet.parse";
import { numberAsDecimal, readArea, readCode, readCount, readMoney, readOrientation } from "@/lib/modules/unit-sheet/unit-sheet.values";

/**
 * Reading a Google Sheet (2026-11-10): which links are accepted, where the
 * reader may go, what Google's two exports are turned into, and how a cell
 * becomes a value. No network: Google is a function here.
 */

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";

describe("the link", () => {
  it("accepts a Google Sheets link and takes its id and tab", () => {
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123456`)).toEqual({ ok: true, ref: { spreadsheetId: ID, gid: "123456" }, url: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123456` });
    expect(parseSheetLink(`  https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing  `)).toMatchObject({ ok: true, ref: { spreadsheetId: ID, gid: null } });
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7#gid=7&range=A1`)).toMatchObject({ ok: true, ref: { gid: "7" } });
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/u/1/d/${ID}/edit`)).toMatchObject({ ok: true, ref: { spreadsheetId: ID } });
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}`)).toMatchObject({ ok: true });
  });

  it("refuses everything else, and says a published link is the wrong one", () => {
    const refused = [
      "",
      "not a link",
      `http://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com.evil.example/spreadsheets/d/${ID}/edit`,
      `https://evil.example/https://docs.google.com/spreadsheets/d/${ID}`,
      `https://user:pass@docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com:8443/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com/document/d/${ID}/edit`,
      "https://docs.google.com/spreadsheets/d/short/edit",
      `https://drive.google.com/file/d/${ID}/view`,
      `https://docs.google.com/spreadsheets/d/${ID}/../../../etc/passwd`.replace("..", "%2e%2e"),
      `https://docs.google.com/spreadsheets/d/${"x".repeat(3000)}`,
    ];
    for (const link of refused) expect(parseSheetLink(link).ok, link).toBe(false);
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz/pubhtml`)).toEqual({ ok: false, problem: "PUBLISHED_LINK" });
    expect(parseSheetLink(42)).toEqual({ ok: false, problem: "NOT_A_LINK" });
  });

  it("builds the export addresses itself, from the id and tab only", () => {
    expect(sheetExportUrls({ spreadsheetId: ID, gid: "9" })).toEqual({
      csv: `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=9`,
      gviz: `https://docs.google.com/spreadsheets/d/${ID}/gviz/tq?tqx=out:json&headers=1&gid=9`,
    });
    expect(sheetExportUrls({ spreadsheetId: ID, gid: "9&x=1" }).csv).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`);
  });
});

describe("where the reader may go", () => {
  it("follows Google's export hosts only, over https, without ports or credentials", () => {
    expect(judgeHop(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`)).toBe("allowed");
    expect(judgeHop("https://doc-0g-9s-sheets.googleusercontent.com/export/abc")).toBe("allowed");
    for (const target of ["http://doc-0g.googleusercontent.com/x", "https://googleusercontent.com/x", "https://evilgoogleusercontent.com/x", "https://doc.googleusercontent.com.evil.example/x", "https://example.com/x", "https://docs.google.com:444/x", "https://a:b@docs.google.com/x", "https://169.254.169.254/latest", "file:///etc/passwd", "garbage"]) {
      expect(judgeHop(target), target).toBe("refused");
    }
  });

  it("reads Google's sign-in as a sheet that is not shared", () => {
    expect(judgeHop("https://accounts.google.com/ServiceLogin?continue=x")).toBe("sign_in");
    expect(judgeHop("https://www.google.com/accounts/ServiceLogin")).toBe("sign_in");
  });

  it("goes to a fixture server only in development or test — production, staging, a demo or no APP_ENV ignore it", () => {
    const fixture = "http://127.0.0.1:4599";
    expect(sheetFetchOrigin({ APP_ENV: "test", NESTO_SHEET_FETCH_ORIGIN: fixture })).toEqual({ origin: fixture, fixture: true });
    expect(sheetFetchOrigin({ APP_ENV: "development", NESTO_SHEET_FETCH_ORIGIN: fixture })).toEqual({ origin: fixture, fixture: true });
    for (const env of [{ APP_ENV: "production" }, { APP_ENV: "staging" }, { APP_ENV: "demo" }, { APP_ENV: "prod" }, {}, { NODE_ENV: "test" }]) {
      expect(sheetFetchOrigin({ ...env, NESTO_SHEET_FETCH_ORIGIN: fixture }), JSON.stringify(env)).toEqual({ origin: GOOGLE_SHEETS_ORIGIN, fixture: false });
    }
    // Only this machine, and only an origin.
    for (const wanted of ["http://evil.example:4599", "http://10.0.0.5", "http://127.0.0.1:4599/path", "ftp://127.0.0.1"]) {
      expect(sheetFetchOrigin({ APP_ENV: "test", NESTO_SHEET_FETCH_ORIGIN: wanted }).fixture, wanted).toBe(false);
    }
  });

  it("asks Google, not the fixture, when production carries the setting", async () => {
    const asked: string[] = [];
    const fetcher: Fetcher = async (url) => {
      asked.push(url);
      return new Response("Unit\nT-501\n", { status: 200, headers: { "content-type": "text/csv" } });
    };
    await readGoogleSheet({ spreadsheetId: ID, gid: null }, { fetcher, env: { APP_ENV: "production", NESTO_SHEET_FETCH_ORIGIN: "http://127.0.0.1:4599" } });
    expect(asked.every((url) => url.startsWith("https://docs.google.com/spreadsheets/d/"))).toBe(true);
    // And with a fixture origin, a hop to Google itself is not followed either.
    expect(judgeHop("https://docs.google.com/x", "http://127.0.0.1:4599")).toBe("refused");
  });
});

describe("fetching an export", () => {
  const signal = new AbortController().signal;
  const reply = (status: number, body = "", headers: Record<string, string> = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers });

  it("follows a redirect to googleusercontent.com, never sending credentials, and reads the title Google gives the file", async () => {
    const seen: RequestInit[] = [];
    const fetcher: Fetcher = async (url, init) => {
      seen.push(init);
      if (url.startsWith("https://docs.google.com/")) return reply(307, "", { location: "https://doc-08-sheets.googleusercontent.com/export/xyz" });
      return reply(200, "Unit\nT-501", { "content-type": "text/csv", "content-disposition": "attachment; filename=\"units.csv\"; filename*=UTF-8''Riverside%20units%20-%20Sheet1.csv" });
    };
    const fetched = await fetchExport(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`, { fetcher, signal, fixtureOrigin: null });
    expect(fetched.body).toBe("Unit\nT-501");
    expect(titleFromDisposition(fetched.disposition)).toBe("Riverside units - Sheet1");
    expect(seen.every((init) => init.redirect === "manual" && init.credentials === "omit")).toBe(true);
  });

  it("refuses a redirect anywhere else, and stops after five", async () => {
    const away: Fetcher = async () => reply(302, "", { location: "https://evil.example/steal" });
    await expect(fetchExport(`https://docs.google.com/spreadsheets/d/${ID}/export`, { fetcher: away, signal, fixtureOrigin: null })).rejects.toMatchObject({ problem: "UNREADABLE" });
    let hops = 0;
    const loop: Fetcher = async () => {
      hops += 1;
      return reply(302, "", { location: `https://docs.google.com/again/${hops}` });
    };
    await expect(fetchExport("https://docs.google.com/start", { fetcher: loop, signal, fixtureOrigin: null })).rejects.toMatchObject({ problem: "UNREADABLE" });
    expect(hops).toBe(6);
  });

  it("reads Google's sign-in, a 401/403 or an HTML page as not shared, and says how to share it", async () => {
    for (const fetcher of [async () => reply(302, "", { location: "https://accounts.google.com/v3/signin/identifier?continue=x" }), async () => reply(403, "denied"), async () => reply(401), async () => reply(200, "<!DOCTYPE html><html>Sign in</html>", { "content-type": "text/html; charset=utf-8" })] as Fetcher[]) {
      const error = await fetchExport("https://docs.google.com/x", { fetcher, signal, fixtureOrigin: null }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SheetReadError);
      expect((error as SheetReadError).problem).toBe("NOT_SHARED");
      expect((error as SheetReadError).message).toBe("NESTO can't read this sheet. In Google Sheets, open Share → General access → 'Anyone with the link' (Viewer), then try again.");
    }
  });

  it("a missing sheet, a busy Google and an answer past the size cap", async () => {
    await expect(fetchExport("https://docs.google.com/x", { fetcher: async () => reply(404), signal, fixtureOrigin: null })).rejects.toMatchObject({ problem: "NOT_FOUND" });
    await expect(fetchExport("https://docs.google.com/x", { fetcher: async () => reply(503), signal, fixtureOrigin: null })).rejects.toMatchObject({ problem: "UNAVAILABLE" });
    await expect(fetchExport("https://docs.google.com/x", { fetcher: async () => reply(200, "x".repeat(2000), { "content-type": "text/csv" }), signal, fixtureOrigin: null, maxBytes: 1000 })).rejects.toMatchObject({ problem: "TOO_LARGE" });
    await expect(fetchExport("https://docs.google.com/x", { fetcher: async () => reply(200, "x", { "content-type": "text/csv", "content-length": "99999999" }), signal, fixtureOrigin: null })).rejects.toMatchObject({ problem: "TOO_LARGE" });
  });

  it("gives up after the deadline as Google not answering", async () => {
    const hang: Fetcher = (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await expect(readGoogleSheet({ spreadsheetId: ID, gid: null }, { fetcher: hang, env: {}, timeoutMs: 20 })).rejects.toMatchObject({ problem: "UNAVAILABLE" });
  });
});

describe("Google's two exports", () => {
  it("parses CSV as Google writes it: quotes, commas, line breaks, a byte-order mark", () => {
    expect(parseCsv('﻿Unit,Note\r\nT-501,"a, ""quoted"" note"\r\nT-502,"two\nlines"\r\n,\r\n')).toEqual([
      ["Unit", "Note"],
      ["T-501", 'a, "quoted" note'],
      ["T-502", "two\nlines"],
    ]);
    expect(() => parseCsv(`Unit\n${"x\n".repeat(11)}`, { maxRows: 10, maxColumns: 5, maxCellLength: 100 })).toThrow(SheetParseError);
    expect(() => parseCsv("a,b,c\n1,2,3", { maxRows: 10, maxColumns: 2, maxCellLength: 100 })).toThrow(SheetParseError);
  });

  const gviz = (body: object) => `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(body)});`;

  it("parses the Visualization API's answer, and its refusals", () => {
    const read = parseGviz(gviz({ status: "ok", table: { cols: [{ label: "Unit", type: "string" }, { label: "Internal area (m²)", type: "number" }], rows: [{ c: [{ v: "T-501" }, { v: 64.72, f: "64,72" }] }] } }));
    expect(read).toEqual({ ok: true, table: { labels: ["Unit", "Internal area (m²)"], types: ["string", "number"], rows: [[{ v: "T-501" }, { v: 64.72, f: "64,72" }]] } });
    expect(parseGviz(gviz({ status: "error", errors: [{ reason: "access_denied" }] }))).toEqual({ ok: false, reason: "access_denied" });
    expect(parseGviz("<html>")).toEqual({ ok: false, reason: "malformed" });
  });

  it("takes Google's numbers as numbers, and the CSV's text where Google typed a cell null", () => {
    const csv = [["Unit", "Internal area (m²)"], ["T-501", "64,72"], ["502", "n/a"]];
    const table = { labels: ["Unit", "Internal area (m²)"], types: ["string", "number"], rows: [[{ v: "T-501" }, { v: 64.72, f: "64,72" }], [null, null]] };
    const grid = mergeGrid(csv, table);
    expect(grid.typed).toBe(true);
    expect(grid.rows).toEqual([
      [{ kind: "text", text: "T-501" }, { kind: "number", value: 64.72, text: "64,72" }],
      [{ kind: "text", text: "502" }, { kind: "text", text: "n/a" }],
    ]);
  });

  it("uses the CSV alone when the two do not line up", () => {
    const csv = [["Unit", "Bedrooms"], ["T-501", "2"]];
    const shifted = { labels: ["Unit", "Bedrooms"], types: ["string", "number"], rows: [[{ v: "T-999" }, { v: 2 }]] };
    expect(mergeGrid(csv, shifted)).toMatchObject({ typed: false, rows: [[{ kind: "text", text: "T-501" }, { kind: "text", text: "2" }]] });
    expect(mergeGrid(csv, { ...shifted, labels: ["Code", "Bedrooms"] }).typed).toBe(false);
    expect(mergeGrid(csv, null).typed).toBe(false);
  });
});

describe("headers", () => {
  it("knows every column in English and Albanian, with case, spacing, accents and the unit ignored", () => {
    for (const column of SHEET_COLUMNS) for (const header of Object.values(SHEET_HEADERS[column])) expect(columnOfHeader(header), header).toBe(column);
    expect(columnOfHeader("  internal   AREA (m2) ")).toBe("internalArea");
    expect(columnOfHeader("Siperfaqja e brendshme")).toBe("internalArea");
    expect(columnOfHeader("CMIMI PER M2")).toBe("pricePerSqm");
    expect(columnOfHeader("Net area")).toBe("netArea");
    expect(columnOfHeader("Colour")).toBeNull();
    expect(headerKey("Çmimi për m²")).toBe("cmimiperm2");
  });

  it("takes the first of two columns with one name and lists the rest, and an empty header only when its column holds something", () => {
    const map = mapHeaders(["Unit", "", "Bedrooms", "Dhoma gjumi", "", "Comment"], (index) => index === 4);
    expect(map.at).toEqual({ code: 0, bedrooms: 2 });
    expect(map.unknown).toEqual([
      { column: "D", header: "Dhoma gjumi" },
      { column: "E", header: "" },
      { column: "F", header: "Comment" },
    ]);
  });
});

describe("a cell as a value", () => {
  const num = (value: number) => ({ kind: "number" as const, value, text: String(value) });
  const text = (value: string) => ({ kind: "text" as const, text: value });
  const blank = { kind: "blank" as const };

  it("reads numbers whatever the sheet's locale, and never guesses", () => {
    expect(readArea(num(64.72), "internalArea")).toEqual({ ok: true, value: "64.72" });
    expect(readArea(num(0.1 + 0.2), "internalArea")).toEqual({ ok: true, value: "0.30" });
    expect(readArea(text("9,5"), "internalArea")).toEqual({ ok: true, value: "9.50" });
    expect(readArea(text("1 234,50"), "internalArea")).toEqual({ ok: true, value: "1234.50" });
    expect(readArea(text("1,234"), "internalArea").ok).toBe(false);
    expect(readArea(text("1.234,50"), "internalArea").ok).toBe(false);
    expect(readArea(num(12.345), "internalArea").ok).toBe(false);
    expect(readArea(num(-1), "internalArea").ok).toBe(false);
    expect(readArea(num(1e21), "internalArea").ok).toBe(false);
    expect(readArea(blank, "internalArea")).toEqual({ ok: true, value: null });
    expect(numberAsDecimal(Number.NaN)).toBeNull();
    expect(readMoney(num(199999.8), "Total price")).toEqual({ ok: true, value: "199999.80" });
    expect(readMoney(num(0), "Total price").ok).toBe(false);
  });

  it("reads counts from their short lists", () => {
    expect(readCount(num(0), "bedrooms")).toEqual({ ok: true, value: "0" });
    expect(readCount(text("3"), "bathrooms")).toEqual({ ok: true, value: "3" });
    expect(readCount(num(2.5), "bedrooms").ok).toBe(false);
    expect(readCount(num(0), "bathrooms").ok).toBe(false);
    expect(readCount(num(2), "storage").ok).toBe(false);
    expect(readCount(text("yes"), "storage").ok).toBe(false);
  });

  it("reads an orientation by its key or its name in either language", () => {
    expect(readOrientation(text("NE"))).toEqual({ ok: true, value: "NE" });
    expect(readOrientation(text("north-east"))).toEqual({ ok: true, value: "NE" });
    expect(readOrientation(text("Jugperendim"))).toEqual({ ok: true, value: "SW" });
    expect(readOrientation(text("Up")).ok).toBe(false);
  });

  it("reads a code typed as a number as its digits, and refuses one too long", () => {
    expect(readCode(num(501))).toEqual({ ok: true, value: "501" });
    expect(readCode(text("  T-501 "))).toEqual({ ok: true, value: "T-501" });
    expect(readCode(text("x".repeat(81))).ok).toBe(false);
  });
});
