import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The `+ Create` trigger summary adds no shell query (NAV-01 QC-01, A08):
 * it is computed from contexts `listWorkspaces` already resolved, by helpers
 * that cannot reach the database or record context.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the Quick Create summary", () => {
  it("is built from pure helpers with no database or record access", () => {
    for (const file of ["lib/modules/quick-create/eligibility.ts", "lib/modules/quick-create/context-key.ts"]) {
      const imports = (read(file).match(/^import .*$/gm) ?? []).join("\n");
      expect(imports, file).not.toMatch(/@\/lib\/database|prisma|record\.registry|workspace-access|quick-create\.service/);
      expect(read(file), file).not.toMatch(/\bprisma\.|fetch\(|resolveGroupContexts\(/);
    }
  });

  it("reuses the contexts listWorkspaces already has", () => {
    const source = read("lib/workspace/workspace.service.ts");
    expect(source).toContain("quickCreate: quickCreateShellSummary(session, quickCreateCandidates(session, contexts))");
    const body = source.slice(source.indexOf("export async function listWorkspaces"), source.indexOf("export type WorkspaceContextDTO"));
    expect(body.match(/resolveGroupContexts\(/g)).toHaveLength(1);
  });

  it("keeps the client from importing the server menu service at runtime", () => {
    for (const file of ["components/layout/quick-create.tsx", "lib/modules/quick-create/menu-cache.ts"]) {
      const imports = read(file).match(/^import .*quick-create\.service.*$/gm) ?? [];
      expect(imports.length, file).toBeGreaterThan(0);
      for (const line of imports) expect(line, file).toMatch(/^import type /);
    }
  });
});
