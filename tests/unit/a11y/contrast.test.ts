import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  parseColor,
  readTokenDeclarations,
  resolvePaint,
  resolveToken,
  THRESHOLD,
  type Scheme,
} from "@/lib/a11y/contrast";
import { CONTRAST_PAIRS } from "@/lib/a11y/contrast-pairs";

/**
 * AUD-11 §6, AV-10: every text/background, control-boundary, focus-ring,
 * status and chart pair the shared primitives paint clears its threshold in
 * both schemes, measured from the values styles/tokens.css actually declares.
 *
 * UI-02 §6.5: and again for version 2 of the design system, which is
 * styles/tokens-v2.css laid over tokens.css exactly as the cascade lays it —
 * every `:root[data-ds="2"]` block of the file, not only the first.
 */
const css = (file: string) => readFileSync(join(process.cwd(), "styles", file), "utf8");
const tokens = readTokenDeclarations(css("tokens.css"));
const overrides = readTokenDeclarations(css("tokens-v2.css"), ':root[data-ds="2"]');
const tokensV2 = new Map([...tokens, ...overrides]);
const SCHEMES: Scheme[] = ["light", "dark"];
const VERSIONS = [
  ["version 1", tokens],
  ["version 2", tokensV2],
] as const;

describe("contrast arithmetic", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio(parseColor("#000"), parseColor("#fff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor("#fff"), parseColor("#fff"))).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio(parseColor("#767676"), parseColor("#ffffff"))).toBeCloseTo(4.54, 2);
  });

  it("composites a translucent colour over its ground", () => {
    const halfBlack = parseColor("rgb(0 0 0 / 0.5)");
    expect(halfBlack.a).toBe(0.5);
    expect(contrastRatio(halfBlack, parseColor("#ffffff"))).toBeLessThan(contrastRatio(parseColor("#000"), parseColor("#fff")));
  });

  it("resolves light-dark() pairs and var() references per scheme", () => {
    expect(resolveToken(tokens, "surface", "light")).toEqual(parseColor("#ffffff"));
    expect(resolveToken(tokens, "surface", "dark")).toEqual(parseColor("#12151a"));
    // primary-fg is var(--nesto-white) in light.
    expect(resolveToken(tokens, "primary-fg", "light")).toEqual(parseColor("#ffffff"));
  });
});

describe.each(VERSIONS)("token pairs in %s", (version, declarations) => {
  describe.each(SCHEMES)("the %s scheme", (scheme) => {
    it.each(CONTRAST_PAIRS.map((pair) => [pair.id, pair] as const))("%s", (_id, pair) => {
      const ratio = contrastRatio(resolvePaint(declarations, pair.fg, scheme), resolvePaint(declarations, pair.bg, scheme));
      const threshold = THRESHOLD[pair.kind];
      expect(
        ratio,
        `${pair.id} (${version}, ${scheme}) is ${ratio.toFixed(2)}:1, below ${threshold}:1 — used for ${pair.where}`,
      ).toBeGreaterThanOrEqual(threshold);
    });
  });
});

describe("version 2 states the UI-02 §6.1 table", () => {
  // token → [light, dark], as the specification prints them.
  const TABLE: Record<string, [string, string]> = {
    canvas: ["#f7f7f5", "#0e0e0e"],
    surface: ["#ffffff", "#161616"],
    hover: ["#f0efeb", "#22211f"],
    pressed: ["#e7e4dd", "#2c2923"],
    fg: ["#111111", "#f4f1ea"],
    "fg-muted": ["#625e57", "#b8b3a9"],
    border: ["#e6e3dc", "#34322e"],
    "control-border": ["#817b70", "#827b6e"],
    gold: ["#b89a5e", "#b89a5e"],
    "accent-strong": ["#755b29", "#d2b67b"],
    "accent-soft": ["#f2ede2", "#292318"],
    ring: ["#755b29", "#d2b67b"],
    "success-strong": ["#176443", "#80d7ac"],
    "warning-strong": ["#805600", "#f0c66d"],
    "danger-strong": ["#b42332", "#ff9da5"],
    "info-strong": ["#225ea8", "#96c5ff"],
  };

  it.each(Object.entries(TABLE))("%s", (token, [light, dark]) => {
    expect(resolveToken(tokensV2, token, "light")).toEqual(parseColor(light));
    expect(resolveToken(tokensV2, token, "dark")).toEqual(parseColor(dark));
  });

  it("has two text colours, and a primary action that is black on light and ivory on dark", () => {
    for (const scheme of SCHEMES) {
      expect(resolveToken(tokensV2, "fg-subtle", scheme)).toEqual(resolveToken(tokensV2, "fg-muted", scheme));
    }
    expect(resolveToken(tokensV2, "primary", "light")).toEqual(parseColor("#111111"));
    expect(resolveToken(tokensV2, "primary-fg", "light")).toEqual(parseColor("#ffffff"));
    expect(resolveToken(tokensV2, "primary", "dark")).toEqual(parseColor("#f4f1ea"));
  });

  it("overrides only names version 1 declares, so version 1 has a value for each", () => {
    // tokens.css, or — for the shell's own geometry, such as the gutter — globals.css.
    const shell = readTokenDeclarations(css("globals.css"));
    for (const name of overrides.keys()) expect(tokens.has(name) || shell.has(name), name).toBe(true);
  });
});

describe("the pair list covers what the primitives paint", () => {
  it("names only declared tokens", () => {
    for (const pair of CONTRAST_PAIRS) {
      for (const paint of [pair.fg, pair.bg]) {
        if ("token" in paint) expect(tokens.has(`nesto-${paint.token}`), paint.token).toBe(true);
      }
    }
  });

  it("has unique ids", () => {
    const ids = CONTRAST_PAIRS.map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
