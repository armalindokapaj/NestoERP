import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PAGE_SCROLL_REGION, PAGE_SURFACES, PAGE_TEMPLATES, pageContract, pageRuler, pageTemplate } from "@/lib/ui/page-contract";

import { buildRouteRegister, pageFiles, readRouteRegister, registerDrift, registerTotals, urlPattern } from "../../../scripts/ui/route-register";

/**
 * Route coverage and ruler eligibility (UI-02 §5, §8.1, §26.3; UI02-01,
 * UI02-16): every page has an entry in docs/ui/UI-02-route-register.json, the
 * entry says what the contract rules say (lib/ui/page-contract.ts), and a page
 * that mounts the section registry states the template and the ruler policy
 * its route was given.
 *
 * A failure here after adding or moving a page means the register is behind:
 *   tsx scripts/ui/route-register.ts --write
 */

const built = buildRouteRegister();
const stored = readRouteRegister();

describe("the route register", () => {
  it("has exactly one entry for every page under app", () => {
    const files = pageFiles();
    expect(files.length).toBeGreaterThan(500);
    expect(stored.map((route) => route.file).sort()).toEqual([...files].sort());
    expect(new Set(stored.map((route) => route.pattern)).size).toBe(stored.length);
    for (const route of stored) expect(route.pattern, route.file).toBe(urlPattern(route.file));
  });

  it("says what the tree and the contract rules say: surface, shell, module, template, scroll region, ruler, states", () => {
    // What a restyle moves without anybody deciding anything — what a page is built from, its leftovers and its
    // version-2 status — is rewritten by the script and not held here.
    expect(registerDrift(built, stored, { counted: false })).toEqual([]);
  });

  it("totals what it lists", () => {
    const document = JSON.parse(readFileSync(join(process.cwd(), "docs", "ui", "UI-02-route-register.json"), "utf8")) as { totals: ReturnType<typeof registerTotals> };
    const totals = registerTotals(stored);
    expect(document.totals.routes).toBe(totals.routes);
    expect(document.totals.byTemplate).toEqual(totals.byTemplate);
    expect(document.totals.bySurface).toEqual(totals.bySurface);
    expect(document.totals.byShell).toEqual(totals.byShell);
    expect(document.totals.rulerEligible).toBe(totals.rulerEligible);
    expect(document.totals.rulerWired).toBe(totals.rulerWired);
  });

  it("classifies every route with a template and a surface of the specification", () => {
    for (const route of stored) {
      expect(PAGE_TEMPLATES, route.pattern).toContain(route.template);
      expect(PAGE_SURFACES, route.pattern).toContain(route.surface);
      expect(["migrated", "token-only", "needs-work", "not-applicable"], route.pattern).toContain(route.v2Status);
      expect(route.v2Reason, route.pattern).not.toBe("");
    }
  });
});

describe("the page contract", () => {
  it("gives every route one, and the register carries it", () => {
    for (const route of stored) {
      const contract = pageContract({ pattern: route.pattern, file: route.file, redirectOnly: route.v2Status === "not-applicable" });
      expect({ pattern: route.pattern, template: route.template, rulerPolicy: route.rulerPolicy, scrollRegion: route.scrollRegion }).toEqual({
        pattern: route.pattern,
        template: contract.template,
        rulerPolicy: contract.rulerPolicy,
        scrollRegion: contract.scrollRegionId,
      });
    }
  });

  it("lets the ruler onto finite overviews, record details and reports only (§8.1)", () => {
    const eligible = stored.filter((route) => route.rulerPolicy === "eligible");
    expect(eligible.length).toBeGreaterThan(0);
    for (const route of eligible) {
      // The component catalog is the ruler's own specimen page.
      if (route.pattern !== "/dev/ui") expect(["overview", "record", "report"], route.pattern).toContain(route.template);
      // A ruler needs the region it controls: only a page inside a shell has one.
      expect(route.scrollRegion, route.pattern).toBe(PAGE_SCROLL_REGION);
      expect(route.rulerReason, route.pattern).not.toBe("");
    }
    for (const template of ["directory", "explorer", "review", "form", "calendar", "board", "timeline", "viewer", "admin-canvas", "settings", "system"] as const) {
      expect(pageRuler({ pattern: "/anything", file: "app/(nesto)/anything/page.tsx", redirectOnly: false }, template)[0], template).toBe("never");
    }
    expect(pageRuler({ pattern: "/finance/reports/print", file: "app/(nesto)/finance/reports/print/page.tsx", redirectOnly: false })[0]).toBe("never");
    expect(pageRuler({ pattern: "/dashboard", file: "app/(nesto)/dashboard/page.tsx", redirectOnly: true })[0]).toBe("never");
  });

  it("reads a path the way the pages are built", () => {
    const at = (pattern: string, file = `app/(nesto)${pattern}/page.tsx`) => pageTemplate({ pattern, file, redirectOnly: false });
    expect(at("/finance/invoices")).toBe("directory");
    expect(at("/finance/invoices/[invoiceId]")).toBe("record");
    expect(at("/finance/invoices/[invoiceId]/edit")).toBe("form");
    expect(at("/finance/invoices/new")).toBe("form");
    expect(at("/finance/reports")).toBe("report");
    expect(at("/settings/company")).toBe("settings");
    expect(at("/finance")).toBe("overview");
    expect(at("/projects/[projectId]/planning")).toBe("timeline");
    expect(at("/login", "app/(public)/login/page.tsx")).toBe("system");
  });

  it("a page that mounts the section registry states its route's template and ruler policy", () => {
    const wired = built.filter((route) => route.rulerWired);
    expect(wired.map((route) => route.pattern)).toEqual(expect.arrayContaining(["/dashboard", "/projects/[projectId]", "/admin"]));
    for (const route of wired) {
      const source = readFileSync(join(process.cwd(), route.file), "utf8");
      const tag = /<PageSections\b([^>]*)>/.exec(source)?.[1] ?? "";
      const template = /template="([^"]+)"/.exec(tag)?.[1];
      // The component's default is "eligible".
      const policy = /rulerPolicy="([^"]+)"/.exec(tag)?.[1] ?? "eligible";
      expect({ pattern: route.pattern, template, policy }).toEqual({ pattern: route.pattern, template: route.template, policy: route.rulerPolicy });
    }
  });
});
