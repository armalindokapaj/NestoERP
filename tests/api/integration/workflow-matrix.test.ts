import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { recordDefinitions } from "@/lib/core/records/record.registry";
import { approvalProviders } from "@/lib/modules/approvals/approvals.registry";
import { uploadableRecordTypes } from "@/lib/modules/documents/document.parent-access";

/**
 * The cross-module workflow matrix stays complete (AUD-10 §2, CW-01).
 *
 * docs/integration/workflow-matrix.md is the checked-in contract for every
 * existing link: owner, state mapping, transaction boundary, events, dedupe
 * key, tests, status. A registry that grows without it is how an integration
 * ends up unowned. So the registries are read here and the document is held
 * to them, in both directions: every registered approval provider has its
 * row in §1 (and no row names a provider that is gone), every registered
 * record type is in the §9 link-target index (and the index names none that
 * is not registered), and every index row agrees with the registries about
 * the provider, the documents and the discussion it claims.
 */

const MATRIX = readFileSync(path.join(process.cwd(), "docs/integration/workflow-matrix.md"), "utf8");

/** The rows of the first table after the heading that starts with `heading`. */
function tableAfter(heading: string): string[][] {
  const lines = MATRIX.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  expect(start, `matrix section "${heading}"`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) break;
    if (!line.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // without the header
}

const code = (cell: string) => /^`([a-z_]+)`/.exec(cell)?.[1] ?? null;

const STATUSES = [/^implemented/, /^untested/, /^broken/, /^being fixed in AUD-10 \(agents? [0-9, ]+/, /^not supported/, /^not a Center provider$/];

describe("the workflow matrix (CW-01)", () => {
  const providerRows = tableAfter("## 1. Approval providers");
  const indexRows = tableAfter("## 9. Link-target index");

  it("has a §1 row for every registered approval provider, and none for a provider that is gone", () => {
    const registered = approvalProviders.all().map((provider) => provider.key).sort();
    const documented = providerRows.map((row) => code(row[0])).filter((key): key is string => Boolean(key)).sort();
    expect(registered.length).toBe(11);
    expect(documented).toEqual(registered);
  });

  it("names each provider's source records in its row", () => {
    for (const provider of approvalProviders.all()) {
      const row = providerRows.find((cells) => code(cells[0]) === provider.key)!;
      // The row's source column names at least one table or service of each record type's module.
      expect(row[1].length, `${provider.key} source`).toBeGreaterThan(0);
      expect(row[2].length, `${provider.key} target`).toBeGreaterThan(0);
    }
  });

  it("indexes every registered record type in §9, and only registered ones", () => {
    const registered = recordDefinitions().map((definition) => definition.type).sort();
    const indexed = indexRows.map((row) => code(row[0])).filter((type): type is string => Boolean(type)).sort();
    expect(new Set(indexed).size).toBe(indexed.length);
    expect(indexed).toEqual(registered);
  });

  it("agrees with the registries about who targets each record type", () => {
    const uploadable = new Set<string>(uploadableRecordTypes());
    const providersOf = new Map<string, string[]>();
    for (const provider of approvalProviders.all()) {
      for (const type of provider.recordTypes) providersOf.set(type, [...(providersOf.get(type) ?? []), provider.key]);
    }
    for (const definition of recordDefinitions()) {
      const row = indexRows.find((cells) => code(cells[0]) === definition.type)!;
      const [, moduleKey, approval, docs, discussion] = row;
      expect(moduleKey, `${definition.type} module`).toBe(definition.moduleKey);

      const expectedProviders = (providersOf.get(definition.type) ?? []).sort();
      const documentedProviders = approval === "—" ? [] : approval.split(",").map((key) => key.trim()).sort();
      expect(documentedProviders, `${definition.type} approval providers`).toEqual(expectedProviders);

      if (uploadable.has(definition.type)) expect(docs, `${definition.type} documents`).toBe("yes");
      else expect(docs, `${definition.type} documents`).not.toBe("yes");

      if (definition.collaboration) expect(discussion, `${definition.type} discussion`).not.toBe("no");
      else expect(discussion, `${definition.type} discussion`).toBe("no");
    }
  });

  it("classifies every row with a status from the vocabulary", () => {
    const sections = ["## 1. Approval providers", "### Approval-like decisions", "## 2. Meeting action", "## 3. Tasks raised", "## 4. Canonical record links", "## 5. Documents", "## 6. Comments", "## 7. Notifications"];
    for (const section of sections) {
      const rows = tableAfter(section);
      expect(rows.length, section).toBeGreaterThan(0);
      for (const row of rows) {
        const status = row[row.length - 1];
        expect(STATUSES.some((pattern) => pattern.test(status)), `${section}: "${status}"`).toBe(true);
      }
    }
  });
});
