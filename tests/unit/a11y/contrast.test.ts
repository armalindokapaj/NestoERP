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
 */
const tokens = readTokenDeclarations(readFileSync(join(process.cwd(), "styles/tokens.css"), "utf8"));
const SCHEMES: Scheme[] = ["light", "dark"];

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
    expect(resolveToken(tokens, "surface", "dark")).toEqual(parseColor("#131315"));
    // primary-fg is var(--nesto-white) in light.
    expect(resolveToken(tokens, "primary-fg", "light")).toEqual(parseColor("#ffffff"));
  });
});

describe.each(SCHEMES)("token pairs in the %s scheme", (scheme) => {
  it.each(CONTRAST_PAIRS.map((pair) => [pair.id, pair] as const))("%s", (_id, pair) => {
    const ratio = contrastRatio(resolvePaint(tokens, pair.fg, scheme), resolvePaint(tokens, pair.bg, scheme));
    const threshold = THRESHOLD[pair.kind];
    expect(
      ratio,
      `${pair.id} (${scheme}) is ${ratio.toFixed(2)}:1, below ${threshold}:1 — used for ${pair.where}`,
    ).toBeGreaterThanOrEqual(threshold);
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
