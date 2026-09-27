import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The form manifest stays complete (AUD-09 §2, FV-01).
 *
 * `docs/forms/form-manifest.md` is the inventory every other AUD-09 check is
 * measured against: each business editor's schema, serialization rules,
 * conditional fields, submit adapter, conflict handling, uploads and tests.
 * An inventory that silently falls behind the code is worse than none, so this
 * test reads the code the way the manifest was built:
 *
 *   every file under components/ and app/ (bar the 3D engine and the
 *   experience editor, which carry no business forms) that renders
 *   `<RecordForm`, `<FormDialog`, or a `<form` with `onSubmit`/`action`
 *   must be named in the manifest — and every file the manifest names must
 *   still exist.
 *
 * Static: no database, no rendering. A new form, a moved file or a deleted
 * dialog fails here until the manifest row is added, moved or removed.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MANIFEST = path.join(ROOT, "docs/forms/form-manifest.md");
const SCANNED = ["components", "app"];
const EXCLUDED = ["components/3d/", "app/(experience-editor)/"];
const SOURCE = /\.(tsx|ts|jsx)$/;

/** The adapters that make a file a form (the same three the manifest was built from). */
const ADAPTERS: Array<[string, RegExp]> = [
  ["RecordForm", /<RecordForm\b/],
  ["FormDialog", /<FormDialog\b/],
  ["form", /<form\b[^>]*?\b(onSubmit|action)=/],
];

function sourceFiles(): string[] {
  return SCANNED.flatMap((dir) =>
    (readdirSync(path.join(ROOT, dir), { recursive: true }) as string[])
      .map((file) => `${dir}/${file.split(path.sep).join("/")}`)
      .filter((file) => SOURCE.test(file) && !EXCLUDED.some((prefix) => file.startsWith(prefix))),
  );
}

function formFiles(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const kinds = ADAPTERS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
    if (kinds.length > 0) found.set(file, kinds);
  }
  return found;
}

function manifestText(): string {
  return readFileSync(MANIFEST, "utf8");
}

/** Every `components/…` or `app/…` source path the manifest names in backticks. */
function listedFiles(text: string): Set<string> {
  const listed = new Set<string>();
  for (const match of text.matchAll(/`((?:components|app)\/[^`\s]+\.(?:tsx|ts|jsx))`/g)) listed.add(match[1]);
  return listed;
}

describe("form manifest (AUD-09 §2, FV-01)", () => {
  it("exists", () => {
    expect(existsSync(MANIFEST)).toBe(true);
  });

  it("names every file that renders a form adapter", () => {
    const listed = listedFiles(manifestText());
    const found = formFiles();
    // The scan itself must find something, or it is broken rather than satisfied.
    expect(found.size).toBeGreaterThan(100);
    const missing = [...found.entries()].filter(([file]) => !listed.has(file)).map(([file, kinds]) => `${file} (${kinds.join(", ")})`);
    expect(missing, "add a manifest row for each of these files").toEqual([]);
  });

  it("names no file that no longer exists", () => {
    const stale = [...listedFiles(manifestText())].filter((file) => !existsSync(path.join(ROOT, file)));
    expect(stale, "remove or move these manifest rows").toEqual([]);
  });

  it("keeps every table row to the manifest's thirteen columns", () => {
    const rows = manifestText()
      .split("\n")
      .filter((line) => line.startsWith("| `"));
    expect(rows.length).toBeGreaterThan(100);
    const malformed = rows
      .map((row) => ({ row, cells: row.replace(/\\\|/g, "").split("|").length - 2 }))
      .filter(({ cells }) => cells !== 13)
      .map(({ row, cells }) => `${cells} cells: ${row.slice(0, 120)}`);
    expect(malformed).toEqual([]);
  });
});
