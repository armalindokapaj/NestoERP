import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A form says what its submit is (AUD-03 §3). The unsaved-work prompt offers
 * "Save and continue" only for an ordinary save or a create, and names it by
 * the kind; reading that off the first English word of the submit label broke
 * in every other language. Every RecordForm and every form-kit FormDialog
 * states its `saveKind`, so no label is ever guessed from. A form that wraps
 * a RecordForm takes the kind from its caller and passes it on.
 */

const ROOT = process.cwd();

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) out.push(...files(file));
    else if (/\.tsx$/.test(entry)) out.push(file);
  }
  return out;
}

/** The attributes of every `<name ...>` opening tag in a source, braces and strings balanced. */
function openingTags(source: string, name: string): { line: number; tag: string }[] {
  const tags: { line: number; tag: string }[] = [];
  const open = new RegExp(`<${name}\\b`, "g");
  for (let match = open.exec(source); match; match = open.exec(source)) {
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '"') end = source.indexOf('"', end + 1);
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && source[end - 1] !== "=") break;
    }
    tags.push({ line: source.slice(0, match.index).split("\n").length, tag: source.slice(match.index, end) });
  }
  return tags;
}

const product = ["app", "components"]
  .flatMap((root) => files(path.join(ROOT, root)))
  .map((file) => ({ file: path.relative(ROOT, file), source: readFileSync(file, "utf8") }));

describe("form save kind (AUD-03 §3)", () => {
  it("every RecordForm and form-kit FormDialog passes a saveKind", () => {
    const offenders: string[] = [];
    for (const { file, source } of product) {
      const names = ["RecordForm"];
      if (/import\s*\{[^}]*\bFormDialog\b[^}]*\}\s*from\s*"[^"]*form-kit"/.test(source)) names.push("FormDialog");
      for (const name of names) {
        for (const { line, tag } of openingTags(source, name)) {
          if (!/\bsaveKind=/.test(tag)) offenders.push(`${file}:${line} <${name}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the call sites it guards", () => {
    const count = product.reduce((sum, { source }) => sum + openingTags(source, "RecordForm").length, 0);
    expect(count).toBeGreaterThan(30);
  });
});
