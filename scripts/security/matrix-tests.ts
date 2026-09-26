import { readFileSync } from "node:fs";

import { walk } from "./source";

/**
 * Which test files exercise an entry point (AUD-06 §2, RP-24).
 *
 * The matrix used to say "sweep" for every endpoint; §2 asks for the specific
 * test. This reads every test and spec once and answers, per entry point, the
 * files that name it the way a test that exercises it must:
 *
 *   route handler   imports `app/api/<pattern>/route`, or requests its URL
 *   server action   imports its `lib/actions/<file>` module and names it
 *   page            imports the page module, or an E2E spec visits its path
 *   anything else   names its key (a job key, an event type) in a string
 *
 * Harnesses, fixtures and helpers are not tests of anything by themselves;
 * the discovery sweeps are reported separately, as what they are.
 */

export type TestFile = { file: string; text: string; e2e: boolean };

const IGNORED = [/^tests\/security\/harness\//, /^tests\/support\//, /^tests\/helpers\.ts$/, /^tests\/setup\.ts$/];

let index: TestFile[] | null = null;

export function testFiles(): TestFile[] {
  index ??= walk("tests", (file) => /\.(test|spec)\.tsx?$/.test(file))
    .filter((file) => !IGNORED.some((pattern) => pattern.test(file)))
    .map((file) => ({ file, text: readFileSync(file, "utf8"), e2e: file.startsWith("tests/e2e/") }));
  return index;
}

/** The discovery sweeps: every session route and server action, attacked by class (PRD #47 §153-§158). */
export const ROUTE_SWEEPS = ["tests/security/cross-company-api.test.ts", "tests/security/module-disabled.test.ts", "tests/security/project-isolation.test.ts"];
export const ACTION_SWEEPS = ["tests/security/cross-company-actions.test.ts", "tests/security/module-disabled.test.ts", "tests/security/project-isolation.test.ts"];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A URL pattern (`/api/tasks/[taskId]`) as a regex over test source: any value, template or literal, in a segment. */
function pathRegex(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(segment) || /^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) return "[^\"'`\\s?#]+";
      if (/^\[[^\]]+\]$/.test(segment)) return "(?:\\$\\{[^}]+\\}|[^\"'`\\s?#/]+)";
      return escape(segment);
    })
    .join("/");
  return new RegExp(`["'\`]${body}(?=["'\`?#]|\\$\\{)`);
}

const byFile = (files: TestFile[]) => [...new Set(files.map((test) => test.file))].sort();

export function testsForRoute(pattern: string): string[] {
  const moduleSpecifier = `app/api${pattern.replace(/^\/api/, "")}/route`;
  const url = pathRegex(pattern);
  return byFile(testFiles().filter((test) => test.text.includes(`${moduleSpecifier}"`) || test.text.includes(`${moduleSpecifier}'`) || url.test(test.text)));
}

export function testsForAction(file: string, name: string): string[] {
  const moduleSpecifier = file.replace(/\.ts$/, "");
  const named = new RegExp(`\\b${escape(name)}\\b`);
  return byFile(testFiles().filter((test) => test.text.includes(moduleSpecifier) && named.test(test.text)));
}

/**
 * A page: its module imported (`@/app/(nesto)/finance/page`), or its path
 * visited by an E2E spec. Unit tests naming a path (navigation config and the
 * like) do not render the page, so they do not count.
 */
export function testsForPage(file: string, route: string): string[] {
  const moduleSpecifier = file.replace(/\.tsx$/, "");
  const url = route === "/" ? /(goto|visit)\(\s*["'`]\/["'`]/ : pathRegex(route);
  return byFile(testFiles().filter((test) => test.text.includes(moduleSpecifier) || (test.e2e && url.test(test.text))));
}

/** Anything addressed by a key: a job, a notification event type. */
export function testsForKey(key: string): string[] {
  const quoted = new RegExp(`["'\`]${escape(key)}["'\`]|\\b${escape(key)}\\b(?=[,)\\]}])`);
  return byFile(testFiles().filter((test) => quoted.test(test.text)));
}

/**
 * Search: a test that drives global search (`globalSearch`, `/api/search`) and
 * is about this provider — it names the provider's module or one of its entity
 * types, or it is the module's own test directory.
 */
export function testsForSearchProvider(moduleKey: string, entityTypes: readonly string[]): string[] {
  const kebab = moduleKey.replace(/([A-Z])/g, "-$1").toLowerCase();
  const names = [moduleKey, ...entityTypes].map((name) => new RegExp(`["'\`]${escape(name)}["'\`]`));
  return byFile(
    testFiles().filter(
      (test) => (test.text.includes("lib/core/search/search.service") || test.text.includes("/api/search")) && (names.some((name) => name.test(test.text)) || test.file.includes(`/${kebab}/`)),
    ),
  );
}

/**
 * A service function the entry point calls: a test that imports it from its
 * module and names it exercises the same authorization — the permission,
 * scope and record checks live in the service, and the route or action is a
 * thin door onto it (PRD #48 §108). Reported apart from direct tests.
 */
export function testsForService(file: string, name: string): string[] {
  const moduleSpecifier = file.replace(/\.tsx?$/, "");
  const named = new RegExp(`\\b${escape(name)}\\b`);
  return byFile(testFiles().filter((test) => test.text.includes(`${moduleSpecifier}"`) && named.test(test.text)));
}
