import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createEditorText, fillEditorText } from "@/lib/3d/platform/editor-text";
import { threeDEditorEn } from "@/lib/i18n/modules/threeD/config-en";
import { threeDEditorSq } from "@/lib/i18n/modules/threeD/config-sq";

/**
 * The Experience Editor's dictionary is keyed by the English text, so English
 * reads exactly what the code says and the Albanian map has to name every text
 * the editor's controls and sentences can show.
 */

const sq: Record<string, string> = threeDEditorSq;
const keys: readonly string[] = threeDEditorEn.texts;
const holes = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();

/** Words the editor reads from a stored value (a material, a water type, a unit status) through the same function. */
const VALUE_WORDS = [
  "concrete", "plaster", "stone", "wood", "aluminium", "steel", "chrome", "ceramic",
  "none", "linear", "reinhard", "cineon", "aces", "agx", "neutral",
  "Sea", "Lake", "Pool", "Decorative", "Practical", "Uniform", "Logarithmic", "Performance", "Standard", "Premium",
  "available", "reserved", "sold", "point", "spot", "Neutral", "Black & White", "Night",
];

/** Names and technical tokens that read the same in both languages. */
const SAME_IN_BOTH = new Set(["Rayleigh", "Penumbra", "Premium", "Reinhard", "Cineon", "ACES", "AgX"]);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.startsWith("editor-text") ? [readFileSync(path, "utf8")] : [];
  });
}

const code = [...sources("components/3d/platform"), ...sources("app/(experience-editor)")].join("\n");

describe("editor dictionary", () => {
  it("has an Albanian text for every English text, and nothing else", () => {
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(sq).sort()).toEqual([...keys].sort());
  });

  it("fills every text, keeps every {0} hole, and differs from the English unless it is a name", () => {
    const blank = keys.filter((key) => !sq[key]?.trim());
    const holeless = keys.filter((key) => holes(sq[key] ?? "").join() !== holes(key).join());
    const english = keys.filter((key) => sq[key] === key && !SAME_IN_BOTH.has(key));
    expect({ blank, holeless, english }).toEqual({ blank: [], holeless: [], english: [] });
  });

  it("keeps the closing mark of the English text", () => {
    const marks = keys.filter((key) => /[.?…:]$/.test(key) && !/[.?…:]$/.test(sq[key]));
    expect(marks).toEqual([]);
  });

  it("answers English texts as written, filling their holes", () => {
    const t = createEditorText({});
    expect(t("Save")).toBe("Save");
    expect(t("Units ({0})", 12)).toBe("Units (12)");
    expect(t("{0} draws · {1} triangles · DPR {2}", 3, "1,200", "1.00")).toBe("3 draws · 1,200 triangles · DPR 1.00");
    expect(t("A text nobody translated {0}", "x")).toBe("A text nobody translated x");
  });

  it("answers Albanian from the map and an unknown text as written", () => {
    const t = createEditorText(threeDEditorSq);
    expect(t("Save")).toBe("Ruaj");
    expect(t("Units ({0})", 12)).toBe("Njësitë (12)");
    expect(t("Not in the dictionary")).toBe("Not in the dictionary");
    expect(t("toString")).toBe("toString");
    expect(fillEditorText("{1} then {0}", ["a", "b"])).toBe("b then a");
  });

  it("names every text the controls and the editor's own sentences show", () => {
    const used = new Set<string>();
    const add = (text: string | undefined) => { if (text) used.add(text.replace(/\\"/g, '"')); };
    // a text handed to the editor's text function
    for (const match of code.matchAll(/editor(?:Nodes)?ServerText\(\s*"((?:[^"\\]|\\.)*)"/g)) add(match[1]);
    // the labels the code keeps in lists (tools, preset groups) and reads through the text function
    for (const match of code.matchAll(/label: "([^"]+)"/g)) add(match[1]);
    // the values a Choice or a status draws as words
    for (const value of VALUE_WORDS) add(value);
    const missing = [...used].filter((text) => !keys.includes(text));
    // technical tokens and a LUT's own name read the same in both languages
    expect(missing.filter((text) => !/^(Bourbon 64|Chemical 168|Clayton 33|Cubicle 99|Remy 24|Presetpro Cinematic|WebGPU|FOV|X-Ray)$/.test(text))).toEqual([]);
  });
});
