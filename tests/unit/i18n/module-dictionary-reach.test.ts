import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A per-module dictionary reaches the browser only beneath a layout that loads
 * it (ModuleMessages); a Client Component reading one anywhere else shows its
 * message keys ("actions.complete"). The swipe-to-complete on a task card reads
 * the tasks dictionary, so every page that turns it on (`canComplete`) must sit
 * beneath a layout that loads "tasks" (review 2026-11-10: a project's Tasks tab
 * did not).
 */

const ROOT = process.cwd();
const APP = join(ROOT, "app");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

/** Whether a layout between this page and the app root loads the namespace. */
function loadedAbove(page: string, namespace: string): boolean {
  for (let dir = dirname(page); dir.startsWith(APP); dir = dirname(dir)) {
    try {
      const layout = readFileSync(join(dir, "layout.tsx"), "utf8");
      const loaded = [...layout.matchAll(/ModuleMessages namespaces=\{\[([^\]]*)\]\}/g)].some((match) => match[1]!.includes(`"${namespace}"`));
      if (loaded) return true;
    } catch {
      // No layout at this level.
    }
    if (dir === APP) break;
  }
  return false;
}

describe("the tasks dictionary", () => {
  it("is loaded above every page whose task cards can be swiped to Complete", () => {
    const swiping = pages(APP).filter((page) => {
      const source = readFileSync(page, "utf8");
      return source.includes("TaskSwipeComplete") || (source.includes("<TaskTable") && source.includes("canComplete"));
    });
    expect(swiping.map((page) => relative(ROOT, page))).toContain("app/(nesto)/projects/[projectId]/tasks/page.tsx");
    const missing = swiping.filter((page) => !loadedAbove(page, "tasks")).map((page) => relative(ROOT, page));
    expect(missing).toEqual([]);
  });
});
