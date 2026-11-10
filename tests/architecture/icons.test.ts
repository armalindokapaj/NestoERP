import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One icon module (components/icons; docs/ui/UI-03-vertical-look.md §6).
 *
 * Every icon is drawn in both looks: Lucide in Theme 1, IBM's Carbon glyph in
 * Theme 2. An icon imported straight from "lucide-react" would have no Theme 2
 * glyph and show Theme 1's drawing in Theme 2, so only the icon module and the
 * Nesto drawings it wraps may import it.
 */

const ROOT = process.cwd();
const ALLOWED = ["components/icons/"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) out.push(...files(file));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(file);
  }
  return out;
}

describe("icons", () => {
  it("only the icon module imports lucide-react", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap((dir) => files(path.join(ROOT, dir)))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
      .filter((file) => !ALLOWED.some((allowed) => file.startsWith(allowed)))
      .filter((file) => /from\s+["']lucide-react["']/.test(readFileSync(path.join(ROOT, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("every icon in the module has a Carbon glyph", () => {
    const index = readFileSync(path.join(ROOT, "components/icons/index.ts"), "utf8");
    const icons = [...index.matchAll(/^export const (\w+) = \/\* @__PURE__ \*\/ dual\(Lucide\1, "(.*)", "\1"\);$/gm)];
    expect(icons.length).toBeGreaterThan(250);
    for (const [, name, glyph] of icons) expect(glyph.length, name).toBeGreaterThan(20);
  });
});
