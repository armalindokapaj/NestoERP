import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { accessLevelLabels, dataScopeLabels } from "@/config/access";
import { MODULE_KEYS, modules } from "@/config/modules";
import { ROLE_KEYS, roles } from "@/config/roles";
import { credentialsSchema, forgotPasswordSchema, resetPasswordSchema } from "@/lib/auth/schema";
import { LOCALES } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * Interface dictionaries.
 *
 * The type system already refuses a dictionary with missing or extra keys. What
 * it cannot see is what is inside the strings: an empty translation, a dropped
 * `{placeholder}`, half a plural pair, or an English source that has drifted
 * from the configuration and the server messages it mirrors.
 */

function flatten(branch: unknown, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(branch as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") entries.set(path, value);
    else for (const [nested, text] of flatten(value, path)) entries.set(nested, text);
  }
  return entries;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const source = flatten(en);

describe("dictionaries", () => {
  for (const locale of LOCALES) {
    const dictionary = flatten(messages[locale]);

    describe(locale, () => {
      it("fills every string the English source fills", () => {
        const blank = [...source]
          .filter(([key, text]) => text !== "" && !dictionary.get(key)?.trim())
          .map(([key]) => key);
        expect(blank).toEqual([]);
      });

      it("keeps every placeholder the English source has", () => {
        const mismatched = [...source]
          .filter(([key, text]) => {
            const translated = dictionary.get(key) ?? "";
            // A note English leaves empty may be filled with no placeholders.
            if (text === "") return placeholders(translated).length > 0;
            return placeholders(translated).join() !== placeholders(text).join();
          })
          .map(([key]) => key);
        expect(mismatched).toEqual([]);
      });

      it("completes every plural pair", () => {
        const incomplete = [...dictionary.keys()]
          .filter((key) => key.endsWith("_one"))
          .filter((key) => !dictionary.has(key.replace(/_one$/, "_other")));
        expect(incomplete).toEqual([]);
      });
    });
  }
});

describe("English source", () => {
  // The e2e suite and every untranslated module page use the configuration's
  // names; the English interface must not start calling things something else.
  it("names modules, roles and access exactly as the configuration does", () => {
    for (const key of MODULE_KEYS) expect(en.modules[key].label).toBe(modules[key].label);
    for (const key of ROLE_KEYS) {
      expect(en.roles[key].label).toBe(roles[key].label);
      expect(en.roles[key].description).toBe(roles[key].description);
    }
    expect(en.access.levels).toEqual(accessLevelLabels);
    expect(en.access.scopes).toEqual(dataScopeLabels);
  });

  // translateAuthError finds server messages by their English wording.
  it("holds every message the auth schemas can return, word for word", () => {
    const issues = [
      credentialsSchema.safeParse({ email: "", password: "" }),
      credentialsSchema.safeParse({ email: "not-an-email", password: "x" }),
      forgotPasswordSchema.safeParse({ email: "" }),
      forgotPasswordSchema.safeParse({ email: "not-an-email" }),
      resetPasswordSchema.safeParse({ token: "t", password: "short", confirmPassword: "" }),
      resetPasswordSchema.safeParse({ token: "t", password: "x".repeat(201), confirmPassword: "y" }),
      resetPasswordSchema.safeParse({ token: "t", password: "long enough 1", confirmPassword: "other" }),
    ].flatMap((result) => result.error?.issues.map((issue) => issue.message) ?? []);

    const known = new Set(Object.values(en.auth.errors));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.filter((message) => !known.has(message))).toEqual([]);
  });

  it("holds every error the auth actions return, word for word", () => {
    const actions = readFileSync("lib/actions/auth.ts", "utf8");
    const returned = [...actions.matchAll(/(?:error:|\?\?)\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
    const conditional = [...actions.matchAll(/\?\s*"([^"]+)"\s*\n?\s*:\s*"([^"]+)"/g)].flatMap((m) => [m[1], m[2]]);

    const known = new Set(Object.values(en.auth.errors));
    const all = [...returned, ...conditional];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((message) => !known.has(message))).toEqual([]);
  });
});

describe("createTranslator", () => {
  it("fills placeholders and picks the language's plural form", () => {
    const english = createTranslator<"settings">("en", en.settings);
    expect(english("roles.modulesCount", { count: 1 })).toBe("1 module");
    expect(english("roles.modulesCount", { count: 3 })).toBe("3 modules");
    expect(english("numbering.updated", { label: "Invoice" })).toBe("Invoice numbering updated.");

    const albanian = createTranslator<"settings">("sq", messages.sq.settings);
    expect(albanian("roles.modulesCount", { count: 1 })).toBe("1 modul");
    expect(albanian("roles.modulesCount", { count: 3 })).toBe("3 module");
  });
});
