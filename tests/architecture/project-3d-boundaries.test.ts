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
      "lib/3d/company",
      "app/(nesto)/projects/[projectId]/3d",
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

  it("guards the Platform page tree at its root layout", () => {
    const source = readFileSync("app/platform-admin/layout.tsx", "utf8");
    expect(source).toContain("requirePlatformContext()");
  });
});
