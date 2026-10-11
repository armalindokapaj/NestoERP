import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/finance/invoices",
}));
// The Sort select draws NESTO's own dropdown, which keeps its options out of
// static markup; a plain <select> in its place shows what it was given.
vi.mock("@/components/ui/form-select", async () => {
  const { createElement } = await import("react");
  return { FormSelect: (props: Record<string, unknown>) => createElement("select", props) };
});

import { DataTable } from "@/components/data/data-table";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { moduleList } from "@/config/modules";
import { recordDefinitions } from "@/lib/core/records/record.registry";
import { messages } from "@/lib/i18n/messages";
import { commonEn } from "@/lib/i18n/modules/common/en";
import { recordTypeName, sectionLabel, sortWords, statusText, supportShellText } from "@/lib/i18n/modules/common/labels";
import { commonSq } from "@/lib/i18n/modules/common/sq";
import { createTranslator, type Translate } from "@/lib/i18n/translator";
import { findRecordSection } from "@/lib/modules/records/registry";
import { SORT_WORDS, sortChoices } from "@/lib/tables/sort";
import { statusLabel } from "@/lib/utils/status";

/**
 * The labels every page shows: module tabs, status words, record nouns, the
 * Support shell and the Sort select's directions.
 *
 * Their English lives in configuration and registries, and the dictionary only
 * mirrors it. A lookup with an English fallback is safe exactly as long as the
 * mirror is word for word, because the e2e suite and every English reader see
 * the dictionary's value, not the configuration's. These checks keep the two
 * equal, and keep the Albanian side from quietly staying English.
 */

const english = createTranslator<"common">("en", commonEn);
const albanian = createTranslator<"common">("sq", commonSq);
/** A reader whose dictionary has none of these groups: every lookup answers its key. */
const unknowing = ((key: string) => key) as Translate<"common">;

function flatten(branch: unknown, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(branch as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") entries.set(path, value);
    else for (const [nested, text] of flatten(value, path)) entries.set(nested, text);
  }
  return entries;
}

const withSections = moduleList.filter((definition) => definition.sections.length > 0);

describe("module tabs", () => {
  it("names every tab of config/modules.ts exactly as the configuration does", () => {
    const configured = Object.fromEntries(
      withSections.map((definition) => [
        definition.key,
        Object.fromEntries(definition.sections.map((section) => [section.key, section.label])),
      ]),
    );
    expect(commonEn.moduleSections).toEqual(configured);
  });

  it("names every self-service tab exactly as the configuration does", () => {
    const configured: Record<string, Record<string, string>> = {};
    for (const definition of withSections) {
      for (const section of definition.sections) {
        if (section.selfLabel) (configured[definition.key] ??= {})[section.key] = section.selfLabel;
      }
    }
    expect(commonEn.moduleSelfSections).toEqual(configured);
  });

  // sectionLabel tells the two names of a tab apart by the label it was resolved to.
  it("never gives a tab the same ordinary and self-service name", () => {
    const same = withSections.flatMap((definition) =>
      definition.sections.filter((section) => section.selfLabel === section.label).map((section) => `${definition.key}.${section.key}`),
    );
    expect(same).toEqual([]);
  });

  it("reads in English as it always did, under either name", () => {
    for (const definition of withSections) {
      for (const section of definition.sections) {
        expect(sectionLabel(english, definition.key, section)).toBe(section.label);
        if (!section.selfLabel) continue;
        expect(sectionLabel(english, definition.key, { ...section, label: section.selfLabel })).toBe(section.selfLabel);
      }
    }
  });

  it("reads in Albanian, and keeps the configured label for a tab the dictionary does not know", () => {
    const leave = { key: "leave", label: "Leave", selfLabel: "My leave" };
    expect(sectionLabel(albanian, "hr", leave)).toBe("Lejet");
    expect(sectionLabel(albanian, "hr", { ...leave, label: "My leave" })).toBe("Lejet e mia");
    expect(sectionLabel(albanian, "inventory", { key: "low-stock", label: "Low stock" })).toBe("Stok i ulët");
    expect(sectionLabel(albanian, "hr", { key: "payroll", label: "Payroll" })).toBe("Payroll");
    expect(sectionLabel(unknowing, "hr", leave)).toBe("Leave");
  });
});

describe("status words", () => {
  // Search, CSV and the e2e suite read statusLabel(); the badge reads the dictionary.
  it("are in English exactly what statusLabel() prints", () => {
    const drifted = Object.entries(commonEn.status)
      .filter(([value, label]) => label !== statusLabel(value))
      .map(([value]) => value);
    expect(drifted).toEqual([]);
    for (const value of Object.keys(commonEn.status)) expect(statusText(english, value)).toBe(statusLabel(value));
  });

  // The shared badge prints whatever status a page hands it, so a stored value
  // with no entry would read in English for an Albanian reader. "Status-like"
  // is the schema's own naming: an enum called …Status, …State, …Priority,
  // …Severity, …Result or …Stage.
  it("cover every status-like value of the Prisma schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const values = [...schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)]
      .filter(([, name]) => /(Status|State|Priority|Severity|Result|Stage)$/.test(name))
      .flatMap(([, , body]) => body.split("\n").map((line) => line.replace(/\/\/.*$/, "").trim().split(/\s+/)[0]))
      .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value));
    expect(values.length).toBeGreaterThan(500);
    expect([...new Set(values)].filter((value) => !(value in commonEn.status))).toEqual([]);
  });

  it("read in Albanian, and an unknown value keeps its English label", () => {
    expect(statusText(albanian, "IN_PROGRESS")).toBe("Në proces");
    expect(statusText(albanian, "PARTIALLY_ORDERED")).toBe("Porositur pjesërisht");
    expect(statusText(albanian, "NOT_YET_INVENTED")).toBe("Not yet invented");
    expect(statusText(unknowing, "IN_PROGRESS")).toBe("In progress");
  });
});

describe("record nouns", () => {
  it("are in English exactly the registry's", () => {
    const registry = Object.fromEntries(recordDefinitions().map((definition) => [definition.type, definition.noun]));
    expect(commonEn.recordTypes).toEqual(registry);
  });

  it("read in Albanian, and an unknown type keeps the noun it was handed", () => {
    expect(recordTypeName(albanian, "invoice", "Invoice")).toBe("Faturë");
    expect(recordTypeName(english, "leave_request", "Leave request")).toBe("Leave request");
    expect(recordTypeName(albanian, "site_diary", "Site diary")).toBe("Site diary");
  });
});

describe("Support shell", () => {
  const section = findRecordSection("support", "requests");
  const shell = flatten(commonEn.supportShell);

  // The lookup is by English text, so a text that drifts stops being translated.
  it("holds the registry's wording, word for word", () => {
    expect(section).toBeDefined();
    if (!section) return;
    const known = new Set(shell.values());
    const listed = [
      section.singular,
      section.plural,
      section.plural.toLowerCase(),
      section.emptyTitle,
      section.emptyDescription,
      ...section.columns.map((column) => column.label),
      ...(section.filters ?? []).map((filter) => filter.label),
    ];
    expect(listed.filter((text) => !known.has(text))).toEqual([]);

    // The detail page's own labels exist only on a loaded record, so they are read from the source.
    const source = readFileSync("lib/modules/records/registry.ts", "utf8");
    const detail = [commonEn.supportShell.columns.requester, ...Object.values(commonEn.supportShell.meta)];
    expect(detail.filter((label) => !source.includes(`label: "${label}"`))).toEqual([]);
  });

  it("names each thing once, so a text finds one key", () => {
    expect(new Set(shell.values()).size).toBe(shell.size);
  });

  it("offers status filter options the status lookup knows", () => {
    const options = (section?.filters ?? []).flatMap((filter) => filter.options);
    expect(options.length).toBeGreaterThan(0);
    expect(options.filter((option) => option.label !== commonEn.status[option.value as keyof typeof commonEn.status])).toEqual([]);
  });

  it("reads in English as the registry wrote it, in Albanian from the dictionary, and passes anything else through", () => {
    for (const text of shell.values()) expect(supportShellText(english, text)).toBe(text);
    expect(supportShellText(albanian, "Support requests")).toBe("Kërkesat për mbështetje");
    expect(supportShellText(albanian, "support requests")).toBe("kërkesa për mbështetje");
    expect(supportShellText(albanian, "Raised by")).toBe("Hapur nga");
    expect(supportShellText(albanian, "Invoices")).toBe("Invoices");
    expect(supportShellText(unknowing, "Reference")).toBe("Reference");
  });
});

describe("sort words", () => {
  it("are in English exactly the Sort select's defaults", () => {
    expect(commonEn.sort).toEqual(SORT_WORDS);
    expect(sortWords(english)).toEqual(SORT_WORDS);
    expect(sortWords(unknowing)).toEqual(SORT_WORDS);
  });

  it("name a column's directions in Albanian", () => {
    const columns = [
      { label: "Afati", sortKey: "due", valueType: "date" as const },
      { label: "Totali", sortKey: "amount", valueType: "money" as const },
      { label: "Statusi", sortKey: "status", valueType: "status" as const },
    ];
    expect(sortChoices(columns, ["due-asc", "amount-desc", "status-asc"], sortWords(albanian))).toEqual([
      { value: "due-asc", label: "Afati: më të hershmet së pari" },
      { value: "amount-desc", label: "Totali: më të lartat së pari" },
      { value: "status-asc", label: "Statusi: në rritje" },
    ]);
  });

  // The table can call no hook, so the select builds its own options. Rendered
  // together, as a page renders them, for each reader.
  it("reach the phone Sort select through the table", () => {
    const page = (locale: "en" | "sq", due: string) =>
      renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          { locale, messages: { ...messages[locale], common: locale === "sq" ? commonSq : commonEn } } as never,
          React.createElement(DataTable, {
            caption: "Invoices",
            columns: [{ key: "due", label: due, valueType: "date", sortKey: "due", render: () => "2026-10-01" }],
            records: [{ id: "r1" }],
            rowKey: (row: { id: string }) => row.id,
            sort: { value: "due-asc", keys: ["due-asc", "due-desc"] },
          } as never),
        ),
      );

    expect(page("en", "Due")).toContain('<option value="due-asc" selected="">Due: earliest first</option>');
    expect(page("en", "Due")).toContain('<option value="due-desc">Due: latest first</option>');
    expect(page("sq", "Afati")).toContain('<option value="due-asc" selected="">Afati: më të hershmet së pari</option>');
    expect(page("sq", "Afati")).toContain('<option value="due-desc">Afati: më të vonshmet së pari</option>');
  });
});

describe("Albanian", () => {
  const GROUPS = ["status", "moduleSections", "moduleSelfSections", "recordTypes", "supportShell", "sort"] as const;
  const pairs = GROUPS.flatMap((group) => {
    const translated = flatten(commonSq[group], group);
    return [...flatten(commonEn[group], group)].map(([path, text]) => ({ path, text, translated: translated.get(path) ?? "" }));
  });

  /**
   * Values that are rightly the same in both languages. Anything else that
   * equals its English is a string nobody translated.
   */
  const SAME_IN_ALBANIAN = [
    // Codes and abbreviations the interface never translates.
    "status.NA",
    "status.NCR",
    "status.QAQC",
    "status.HSE",
    "status.PPE",
    "recordTypes.non_conformance_report",
    "recordTypes.rfi",
    "sort.aToZ",
    "sort.zToA",
    // A release stage, used as a name.
    "status.BETA",
    // Words Albanian spells as English does.
    "status.DRAFT",
    "status.INFO",
    "status.NORMAL",
    "recordTypes.incident",
  ];

  it("fills every label", () => {
    expect(pairs.length).toBeGreaterThan(450);
    expect(pairs.filter((pair) => !pair.translated.trim()).map((pair) => pair.path)).toEqual([]);
  });

  it("leaves in English only codes, names and words the two languages share", () => {
    const same = pairs.filter((pair) => pair.translated === pair.text).map((pair) => pair.path);
    expect(same.sort()).toEqual([...SAME_IN_ALBANIAN].sort());
  });
});
