import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isListId } from "@/lib/tables/columns";

/**
 * DT-01: the list capability manifest covers every list the code names
 * (AUD-08 §2). Every `listId="…"` literal in `components/**` and `app/**`
 * must have a row in docs/tables/list-manifest.md, and every row there must
 * have the twelve manifest columns. The 3D editor (components/3d,
 * app/(experience-editor)) belongs to another session and is not scanned.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MANIFEST = path.join(ROOT, "docs/tables/list-manifest.md");
const EXCLUDED = [path.join(ROOT, "components/3d"), path.join(ROOT, "app/(experience-editor)")];

const COLUMNS = [
  "List ID",
  "Route",
  "Query owner (file)",
  "Scopes & sections",
  "Search fields",
  "Filters (semantics)",
  "Sort keys (default; nulls; tie-breaker)",
  "Page limit",
  "Columns (mandatory / default-hidden)",
  "Row & bulk actions",
  "Export (modes; schema; limits)",
  "Tests",
] as const;

function sourceFiles(dir: string): string[] {
  if (EXCLUDED.includes(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (EXCLUDED.includes(full)) continue;
    const stats = statSync(full);
    if (stats.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full);
  }
  return files;
}

/** `listId="x"` and `listId={"x"}` / `listId={'x'}` / ``listId={`x`}``. */
const LIST_ID_LITERAL = /\blistId=(?:"([^"]*)"|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/g;

function listIdsInCode(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of [...sourceFiles(path.join(ROOT, "components")), ...sourceFiles(path.join(ROOT, "app"))]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(LIST_ID_LITERAL)) {
      const id = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
      const where = path.relative(ROOT, file);
      found.set(id, [...(found.get(id) ?? []), where]);
    }
  }
  return found;
}

/** Splits a markdown table row on unescaped pipes. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function manifestTable(): { header: string[] | null; rows: { line: number; cells: string[] }[] } {
  const lines = readFileSync(MANIFEST, "utf8").split("\n");
  const headerIndex = lines.findIndex((line) => line.trim().startsWith("| List ID |"));
  if (headerIndex < 0) return { header: null, rows: [] };
  const rows: { line: number; cells: string[] }[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line.startsWith("|")) {
      if (line === "" || line.startsWith("<!--")) continue;
      break;
    }
    if (/^\|\s*:?-{3,}/.test(line)) continue;
    rows.push({ line: index + 1, cells: cells(line) });
  }
  return { header: cells(lines[headerIndex]!), rows };
}

const listIdOfCell = (cell: string) => cell.replace(/`/g, "").trim();

describe("DT-01: the list manifest", () => {
  const table = manifestTable();

  it("has the twelve manifest columns, in order", () => {
    expect(table.header).toEqual([...COLUMNS]);
  });

  it("gives every row exactly twelve cells, a well-formed List ID and no blank cell", () => {
    const problems: string[] = [];
    for (const row of table.rows) {
      if (row.cells.length !== COLUMNS.length) problems.push(`line ${row.line}: ${row.cells.length} cells`);
      const id = listIdOfCell(row.cells[0] ?? "");
      if (!isListId(id)) problems.push(`line ${row.line}: List ID "${id}" is not <module>.<list>`);
      row.cells.forEach((cell, index) => {
        if (cell === "") problems.push(`line ${row.line}: "${COLUMNS[index] ?? index}" is empty (write "not supported" or "—")`);
      });
    }
    expect(problems).toEqual([]);
  });

  it("lists each List ID once", () => {
    const seen = new Map<string, number>();
    for (const row of table.rows) {
      const id = listIdOfCell(row.cells[0] ?? "");
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    expect([...seen].filter(([, count]) => count > 1).map(([id]) => id)).toEqual([]);
  });

  it("has a row for every listId the code uses", () => {
    const documented = new Set(table.rows.map((row) => listIdOfCell(row.cells[0] ?? "")));
    const missing = [...listIdsInCode()]
      .filter(([id]) => !documented.has(id))
      .map(([id, files]) => `${id || "(empty)"} — ${files.join(", ")}`);
    expect(missing).toEqual([]);
  });

  it("uses only well-formed list ids in code", () => {
    const malformed = [...listIdsInCode()].filter(([id]) => !isListId(id)).map(([id, files]) => `${id} — ${files.join(", ")}`);
    expect(malformed).toEqual([]);
  });

  it("has rows at all (the module fragments are merged)", () => {
    expect(table.rows.length).toBeGreaterThan(0);
  });
});
