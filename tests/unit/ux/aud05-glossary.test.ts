import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GLOSSARY_ACTIONS, GLOSSARY_AVOID, GLOSSARY_EXCEPTIONS, GLOSSARY_NOUNS } from "@/config/glossary";
import { MODULE_KEYS, modules } from "@/config/modules";
import { quickActions } from "@/config/quick-actions";
import { QUICK_CREATE_ACTIONS, QUICK_CREATE_GROUP_LABELS } from "@/config/quick-create";
import { en } from "@/lib/i18n/messages/en";
import { sq } from "@/lib/i18n/messages/sq";

/**
 * AUD-05 §4, UX-07: the sidebar, module headings, section tabs, Quick Create
 * and the dashboard shortcuts speak the glossary's words.
 */

const singulars = new Set<string>(Object.values(GLOSSARY_NOUNS).map((noun) => noun.singular));
const lowerSingulars = new Set([...singulars].map((noun) => (/^[A-Z]{2,}/.test(noun) ? noun : noun.toLowerCase())));
const avoided = new Set(GLOSSARY_AVOID.map((entry) => entry.wording));
/** The first word of every documented exception ("Add document", "Report a hazard"…). */
const exceptionLabels = new Set(GLOSSARY_EXCEPTIONS.flatMap((entry) => entry.term.split(" / ")).map((term) => term.trim()));

describe("module names (sidebar, heading, breadcrumb)", () => {
  it("are the same in the registry and the English dictionary the sidebar and headings read", () => {
    for (const key of MODULE_KEYS) {
      expect(en.modules[key].label, key).toBe(modules[key].label);
      expect(en.modules[key].description, key).toBe(modules[key].description);
    }
  });

  it("have an Albanian name for every module", () => {
    for (const key of MODULE_KEYS) expect(sq.modules[key].label.trim(), key).not.toBe("");
  });

  it("are unique: no two sidebar destinations share a name", () => {
    const labels = MODULE_KEYS.map((key) => modules[key].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("the module page takes its default heading from the same dictionary as the sidebar", () => {
    const source = readFileSync(join(process.cwd(), "components/modules/module-page.tsx"), "utf8");
    expect(source).toContain('getTranslations("modules")');
    expect(source).toContain("title ?? moduleLabel");
  });
});

describe("section tabs", () => {
  it("never reuse the name of another destination in the shell", () => {
    // The top bar's cross-module pages: "My Work" in Engineering sent people to the wrong place.
    const shellDestinations = new Set(["My Work", "Favorites", "Notifications", "Activity", "Help"]);
    // A module's word used as a scope inside another module's tabs, always under
    // "<Module> sections": Finance's Approvals queue, Timesheets' Team view. Listed,
    // so a new one is a decision, not an accident (docs/ux/glossary.md).
    const scopedTabs = new Set([
      "timesheets/team",
      "timesheets/projects",
      "timesheets/settings",
      "dailyLogs/settings",
      "engineering/settings",
      "finance/approvals",
      "sales/tasks",
      "contracts/approvals",
      "procurement/approvals",
      "qaqc/approvals",
      "hse/approvals",
      "team/people",
      "hr/documents",
    ]);
    for (const key of MODULE_KEYS) {
      const others = new Set(MODULE_KEYS.filter((other) => other !== key).map((other) => modules[other].label));
      for (const section of modules[key].sections) {
        const id = `${key}/${section.key} "${section.label}"`;
        // Support's Help tab is the Help index itself: one name, one content.
        if (!(key === "support" && section.key === "help")) expect(shellDestinations.has(section.label), id).toBe(false);
        if (!scopedTabs.has(`${key}/${section.key}`)) expect(others.has(section.label), id).toBe(false);
      }
    }
  });

  it("are unique inside their module", () => {
    for (const key of MODULE_KEYS) {
      const labels = modules[key].sections.map((section) => section.label);
      expect(new Set(labels).size, key).toBe(labels.length);
    }
  });
});

describe("Quick Create", () => {
  it("names each action with the glossary's noun", () => {
    for (const action of QUICK_CREATE_ACTIONS) expect(singulars.has(action.label), `${action.key} "${action.label}"`).toBe(true);
  });

  it("groups under module names the sidebar uses", () => {
    const moduleLabels = new Set(MODULE_KEYS.map((key) => modules[key].label));
    for (const [group, label] of Object.entries(QUICK_CREATE_GROUP_LABELS)) {
      if (group === "GENERAL") continue;
      expect(moduleLabels.has(label), `${group} "${label}"`).toBe(true);
    }
  });
});

describe("dashboard shortcuts", () => {
  it(`say "${GLOSSARY_ACTIONS.create} <noun>", or a documented exception`, () => {
    for (const action of Object.values(quickActions)) {
      if (exceptionLabels.has(action.label)) continue;
      const [verb, ...rest] = action.label.split(" ");
      expect(verb, action.key).toBe(GLOSSARY_ACTIONS.create);
      expect(lowerSingulars.has(rest.join(" ")), `${action.key} "${action.label}"`).toBe(true);
    }
  });

  it("match the Quick Create action they share a route with", () => {
    for (const action of Object.values(quickActions)) {
      const create = QUICK_CREATE_ACTIONS.find((candidate) => candidate.route === action.href);
      if (!create || exceptionLabels.has(action.label)) continue;
      expect(action.label.toLowerCase(), action.key).toBe(`${GLOSSARY_ACTIONS.create} ${create.label}`.toLowerCase());
    }
  });
});

describe("replaced wordings", () => {
  it("are not used by the sidebar, tabs, Quick Create or shortcuts", () => {
    const labels = [
      ...MODULE_KEYS.map((key) => modules[key].label),
      ...MODULE_KEYS.flatMap((key) => modules[key].sections.flatMap((section) => [section.label, section.selfLabel ?? ""])),
      ...QUICK_CREATE_ACTIONS.map((action) => action.label),
      ...Object.values(quickActions).map((action) => action.label),
    ];
    for (const label of labels) expect(avoided.has(label), label).toBe(false);
  });
});
