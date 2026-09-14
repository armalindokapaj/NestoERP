import { describe, expect, it } from "vitest";

import { featuredFaq } from "@/config/marketing";
import { moduleList } from "@/config/modules";
import { ROLE_KEYS, roles } from "@/config/roles";
import { LOCALES } from "@/lib/i18n/config";
import { siteCopy } from "@/lib/i18n/site";
import { siteEn } from "@/lib/i18n/site/en";

/**
 * The public site's copy.
 *
 * Its type already refuses a language with a missing key. What a type cannot
 * see is a list that is one paragraph short, a string left blank, a dropped
 * `{placeholder}`, or a module tab added to the product that nobody translated.
 */

/** Every string, by path — list entries by position, config labels skipped. */
function strings(branch: unknown, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(branch as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (path === "configLabels") continue;
    if (typeof value === "string") entries.set(path, value);
    else for (const [nested, text] of strings(value, path)) entries.set(nested, text);
  }
  return entries;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const source = strings(siteEn);

describe("site copy", () => {
  for (const locale of LOCALES) {
    const copy = siteCopy[locale];
    const translated = strings(copy);

    describe(locale, () => {
      it("says everything the English source says, list for list", () => {
        expect([...translated.keys()].sort()).toEqual([...source.keys()].sort());
        const blank = [...translated].filter(([, text]) => !text.trim()).map(([key]) => key);
        expect(blank).toEqual([]);
      });

      it("keeps every placeholder the English source has", () => {
        const mismatched = [...source]
          .filter(
            ([key, text]) =>
              placeholders(translated.get(key) ?? "").join() !== placeholders(text).join(),
          )
          .map(([key]) => key);
        expect(mismatched).toEqual([]);
      });

      it("has every question the landing page features", () => {
        for (const [group, index] of featuredFaq) {
          expect(copy.faq.groups[group].items[index]?.question).toBeTruthy();
        }
      });

      // English reads config/modules.ts and config/roles.ts as written.
      if (locale === "en") return;

      it("names every module tab and role department in the configuration", () => {
        const sections = new Set(moduleList.flatMap((m) => m.sections.map((s) => s.label)));
        const departments = new Set(ROLE_KEYS.map((key) => roles[key].department));

        expect([...sections].filter((label) => !copy.configLabels.sections[label]?.trim())).toEqual(
          [],
        );
        expect(
          [...departments].filter((name) => !copy.configLabels.departments[name]?.trim()),
        ).toEqual([]);
      });
    });
  }

  it("leaves English reading the configuration directly", () => {
    expect(siteEn.configLabels).toEqual({ sections: {}, departments: {} });
  });
});
