import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_BUNDLE_EXCEPTIONS, clientBundleViolations, formatViolation } from "@/scripts/check-client-bundle";

/**
 * Nothing server-side reaches the browser bundle (AUD-12 DX-04). The gate is
 * `pnpm check:client-bundle`; this holds it from the test runner and proves it
 * would notice a planted leak.
 */

describe("the client bundle boundary", () => {
  it("has no server-only import reachable from a \"use client\" module", () => {
    expect(clientBundleViolations().map(formatViolation)).toEqual([]);
  });

  it("gives every exception a reason", () => {
    for (const exception of CLIENT_BUNDLE_EXCEPTIONS) expect(exception.reason.length, exception.file).toBeGreaterThan(40);
  });
});

describe("the client bundle boundary, fed a planted leak", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nesto-aud12-client-"));
    const write = (name: string, lines: string[]) => writeFileSync(path.join(dir, name), lines.join("\n"));
    write("entry.tsx", [
      '"use client";',
      'import type { Anything } from "@/lib/database/prisma";',
      'import { helper } from "./helper";',
      'import { save } from "./actions";',
      "export const Entry = () => [helper, save];",
    ]);
    write("helper.ts", [
      'import { readFileSync } from "node:fs";',
      'import { PrismaClient, TaskStatus } from "@prisma/client";',
      'import { prisma } from "@/lib/database/prisma";',
      "export const helper = [readFileSync, PrismaClient, TaskStatus, prisma, process.env.AUTH_SECRET, process.env.NEXT_PUBLIC_APP_URL];",
    ]);
    // A server action crosses as a reference: its imports are not bundled.
    write("actions.ts", ['"use server";', 'import { readFileSync } from "node:fs";', "export async function save() { return readFileSync; }"]);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports each leak with the chain that reaches it, and nothing else", () => {
    const entry = path.join(dir, "entry.tsx");
    const helper = path.join(dir, "helper.ts");
    const found = clientBundleViolations([entry]);
    expect(found.map((violation) => `${path.basename(violation.file)}:${violation.line} ${violation.problem}`).sort()).toEqual(
      [
        'helper.ts:1 imports the Node built-in "node:fs" ("node:fs")',
        'helper.ts:2 imports the Prisma client class (PrismaClient) ("@prisma/client")',
        'helper.ts:3 imports the database layer ("@/lib/database/prisma")',
        "helper.ts:4 reads process.env.AUTH_SECRET, which is not NEXT_PUBLIC_ and is undefined (or a leaked secret) in the browser",
      ].sort(),
    );
    for (const violation of found) expect(violation.chain).toEqual([entry, helper]);
  });
});
