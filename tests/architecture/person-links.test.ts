import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One way to a person (E-08 §7, §112; ADR 0008 decision 3).
 *
 * A name or avatar leads to a profile through `<PersonLink>` and nothing else,
 * so every such link has the same route, the same check and the same look. A
 * module that builds `/people/${…}` or `/team/${…}` itself is refused here.
 * The People pages build their own tabs, and Team's pages link to a
 * membership's own pages; those are their navigation, not links to a person.
 */

const ROOT = process.cwd();
const ALLOWED = [
  "components/people/person-link.tsx",
  "app/(nesto)/people/",
  // Team's pages are about a membership: its list, its tabs and its edit form link to the membership, not a person.
  "app/(nesto)/team/",
  "components/team/",
];
// `/people/${` or `/team/${` inside a string or template: a profile URL built by hand.
const HAND_BUILT = /["'`]\/(people|team)\/\$\{/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) out.push(...files(file));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(file);
  }
  return out;
}

describe("person links (E-08 §7)", () => {
  it("builds no profile URL outside PersonLink in components or pages", () => {
    const offenders: string[] = [];
    for (const root of ["components", "app"]) {
      for (const file of files(path.join(ROOT, root))) {
        const relative = path.relative(ROOT, file);
        if (ALLOWED.some((allowed) => relative.startsWith(allowed))) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (HAND_BUILT.test(line)) offenders.push(`${relative}:${index + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
