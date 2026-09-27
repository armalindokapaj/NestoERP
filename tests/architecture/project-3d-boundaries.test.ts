import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

function importsIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]!);
}

describe("Project 3D bundle boundaries", () => {
  it("keeps Company viewer code out of Platform authoring and processing modules", () => {
    const roots = [
      "components/3d/company",
      "components/3d/viewer",
      "lib/3d/company",
      "lib/3d/viewer",
      "app/(project-viewer)",
      "app/api/projects/[projectId]/3d",
    ];
    const forbidden = [
      /^@\/components\/3d\/platform(?:\/|$)/,
      /^@\/components\/platform(?:\/|$)/,
      /^@\/lib\/context\/platform-context$/,
      /^@\/lib\/modules\/platform(?:\/|$)/,
      /^@\/lib\/modules\/project-3d\/project-3d\.(?:binding|editor|ingestion|processor|release|service)$/,
      /^@\/lib\/3d\/server(?:\/|$)/,
      /^@gltf-transform\//,
    ];
    const violations = roots.flatMap((root) => sourceFiles(root).flatMap((file) =>
      importsIn(file)
        .filter((dependency) => forbidden.some((pattern) => pattern.test(dependency)))
        .map((dependency) => `${file} -> ${dependency}`),
    ));
    expect(violations).toEqual([]);
  });

  it("keeps the shared renderer browser-safe and independent of NESTO identity", () => {
    const files = [
      ...sourceFiles("lib/3d/runtime"),
      "components/3d/company/ThreeProjectViewer.tsx",
      "components/3d/company/viewerTypes.ts",
    ];
    const forbidden = [
      /^@prisma\/client$/,
      /^@\/lib\/(?:auth|context|database|core\/storage)(?:\/|$)/,
      /^@\/lib\/modules\/platform(?:\/|$)/,
    ];
    const violations = files.flatMap((file) => importsIn(file)
      .filter((dependency) => forbidden.some((pattern) => pattern.test(dependency)))
      .map((dependency) => `${file} -> ${dependency}`));
    expect(violations).toEqual([]);
  });

  it("mounts the Company viewer full screen, outside the application shell, behind the project doors", () => {
    const group = "app/(project-viewer)";
    const route = `${group}/projects/[projectId]/3d`;
    // One page owns /projects/[projectId]/3d, and it is not inside the shell's group.
    expect(sourceFiles(group).filter((file) => file.endsWith("page.tsx"))).toEqual([path.join(route, "page.tsx")]);
    expect(sourceFiles("app/(nesto)/projects/[projectId]").some((file) => file.includes(`${path.sep}3d${path.sep}`))).toBe(false);
    expect(readFileSync(`${group}/layout.tsx`, "utf8")).toContain("requireUserContext()");
    const page = readFileSync(`${route}/page.tsx`, "utf8");
    expect(page).toContain("loadProject(");
    expect(page).toContain("hasActiveProject3DViewer(");
  });

  it("guards the Platform page tree at its root layout", () => {
    const source = readFileSync("app/platform-admin/layout.tsx", "utf8");
    expect(source).toContain("requirePlatformContext()");
  });
});

const EDITOR_GROUP = "app/(experience-editor)";
const EDITOR_FRAME = `${EDITOR_GROUP}/platform-admin/3d/projects/[projectId]`;
const EDITOR_ROUTE = `${EDITOR_FRAME}/editor`;

/** Imports that reach the bundle: `import type` and `export type` are erased and skipped. */
function runtimeImportsIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const statics = [...source.matchAll(/\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g)]
    .filter((match) => !match[1])
    .map((match) => match[2]!);
  const dynamics = [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]!);
  return [...statics, ...dynamics];
}

function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? path.join(path.dirname(from), specifier) : null;
  if (base === null) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try {
      if (/\.(ts|tsx)$/.test(candidate) && readFileSync(candidate)) return candidate;
    } catch {
      // Not this candidate.
    }
  }
  return null;
}

/** Every package and source module a set of entry files can load. */
function reachableFrom(entries: string[]): { modules: Set<string>; packages: Set<string> } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    for (const specifier of runtimeImportsIn(file)) {
      const resolved = resolveModule(file, specifier);
      if (resolved) queue.push(resolved);
      else if (!specifier.startsWith("@/") && !specifier.startsWith(".")) packages.add(specifier);
    }
  }
  return { modules, packages };
}

describe("Experience Editor tab (3D Editor PRD §9-§11, §180-§183, §202-§206)", () => {
  it("guards the editor tab at its own layouts, since the Platform Admin layout does not wrap it", () => {
    expect(readFileSync(`${EDITOR_FRAME}/layout.tsx`, "utf8")).toContain("requirePlatformContext()");
    const access = readFileSync(`${EDITOR_ROUTE}/layout.tsx`, "utf8");
    expect(access).toContain("requirePlatformContext()");
    expect(access).toContain("authorizeProject3DEditor(");
    // The group holds the editor and nothing else.
    expect(sourceFiles(EDITOR_GROUP).filter((file) => file.endsWith("page.tsx"))).toEqual([path.join(EDITOR_ROUTE, "page.tsx")]);
  });

  it("never renders the Platform Admin shell, search or account controls around the editor", () => {
    const forbidden = [
      /^@\/components\/platform(?:\/|$)/,
      /^@\/components\/layout(?:\/|$)/,
      /^@\/components\/auth(?:\/|$)/,
      /app\/platform-admin\/layout/,
    ];
    const { modules } = reachableFrom(sourceFiles(EDITOR_GROUP));
    const violations = [...modules].flatMap((file) => runtimeImportsIn(file)
      .filter((dependency) => forbidden.some((pattern) => pattern.test(dependency)))
      .map((dependency) => `${file} -> ${dependency}`));
    expect(violations).toEqual([]);
  });

  it("keeps one Experience Editor implementation, rendered only by the editor tab", () => {
    const files = [...sourceFiles("app"), ...sourceFiles("components")];
    const importers = files.filter((file) => importsIn(file).includes("@/components/3d/platform/ExperienceEditor"));
    expect(importers).toEqual([path.join(EDITOR_ROUTE, "page.tsx")]);
    const definitions = sourceFiles("components").filter((file) => /export (?:function|const) \w*ExperienceEditor\b/.test(readFileSync(file, "utf8")));
    expect(definitions).toEqual(["components/3d/platform/ExperienceEditor.tsx"]);
  });

  it("keeps the 3D renderer out of every Platform Admin page, including Experience detail", () => {
    const { modules, packages } = reachableFrom(sourceFiles("app/platform-admin"));
    expect([...packages].filter((name) => name === "three" || name.startsWith("three/") || name.startsWith("postprocessing"))).toEqual([]);
    expect([...modules].filter((file) => file.startsWith("lib/3d/runtime/render-engine") || file === "components/3d/company/ThreeProjectViewer.tsx" || file === "components/3d/platform/ExperienceEditor.tsx")).toEqual([]);
  });

  it("does load the renderer from the editor tab, so the check above can fail", () => {
    const { packages } = reachableFrom(sourceFiles(EDITOR_GROUP));
    expect([...packages].some((name) => name === "three" || name.startsWith("three/"))).toBe(true);
  });
});
