import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRouteInventory, NESTO_ROOT } from "../../../scripts/navigation/route-inventory";

/**
 * Loading coverage (NAV-01 LOAD-01..LOAD-04): every authenticated page has a
 * loading ancestor, each module named by the PRD has its own shape, and the
 * skeletons themselves fetch nothing.
 */

const rows = buildRouteInventory();

const MODULE_VARIANTS: Record<string, string> = {
  projects: "GalleryPageSkeleton",
  finance: "OverviewPageSkeleton",
  sales: "OverviewPageSkeleton",
  procurement: "OverviewPageSkeleton",
  inventory: "OverviewPageSkeleton",
  hr: "OverviewPageSkeleton",
  hse: "OverviewPageSkeleton",
  qaqc: "OverviewPageSkeleton",
  clients: "ListPageSkeleton",
  contracts: "ListPageSkeleton",
  documents: "ListPageSkeleton",
  tasks: "ListPageSkeleton",
  meetings: "ListPageSkeleton",
  contractors: "ListPageSkeleton",
  workforce: "ListPageSkeleton",
  people: "ListPageSkeleton",
  team: "ListPageSkeleton",
  calendar: "SchedulePageSkeleton",
  timesheets: "SchedulePageSkeleton",
  "daily-logs": "SchedulePageSkeleton",
  engineering: "SettingsPageSkeleton",
  organization: "SettingsPageSkeleton",
  company: "SettingsPageSkeleton",
  settings: "SettingsPageSkeleton",
  support: "SettingsPageSkeleton",
  approvals: "FeedPageSkeleton",
  activity: "FeedPageSkeleton",
  "my-work": "FeedPageSkeleton",
  search: "FeedPageSkeleton",
  dashboard: "DashboardSkeleton",
};

const DETAILS: Record<string, string> = {
  "/projects/[projectId]": "ProjectWorkspaceSkeleton",
  "/projects/[projectId]/units": "ListPageSkeleton",
  "/projects/[projectId]/units/[unitId]": "DetailPageSkeleton",
  // /projects/[projectId]/3d left the shell for app/(project-viewer): a full-screen viewer with its own splash.
  "/clients/[clientId]": "DetailPageSkeleton",
  "/tasks/[taskId]": "DetailPageSkeleton",
  "/finance/invoices/[invoiceId]": "DetailPageSkeleton",
  "/finance/invoices/new": "FormPageSkeleton",
  "/contracts/[contractId]": "DetailPageSkeleton",
  "/hr/employees/[employeeId]": "DetailPageSkeleton",
  "/people/[personId]": "DetailPageSkeleton",
};

describe("route loading coverage (LOAD-04, L04)", () => {
  it("finds the authenticated pages", () => {
    expect(rows.length).toBeGreaterThanOrEqual(400);
  });

  it("gives every authenticated page a loading ancestor", () => {
    expect(rows.filter((row) => !row.loading).map((row) => row.route)).toEqual([]);
  });

  it("has the authenticated fallback beside the shell's layout (LOAD-01)", () => {
    expect(existsSync(join(NESTO_ROOT, "loading.tsx"))).toBe(true);
    expect(existsSync(join(NESTO_ROOT, "error.tsx"))).toBe(true);
  });

  it("gives each module root its own shape (LOAD-02)", () => {
    for (const [module, variant] of Object.entries(MODULE_VARIANTS)) {
      const source = readFileSync(join(NESTO_ROOT, module, "loading.tsx"), "utf8");
      expect(source, module).toContain(`import { ${variant} } from "@/components/layout/page-skeletons"`);
    }
  });

  it("gives the required record journeys a detail or form shape (LOAD-03)", () => {
    for (const [route, variant] of Object.entries(DETAILS)) {
      expect(rows.find((row) => row.route === route)?.variant, route).toBe(variant);
    }
  });
});

describe("the skeletons (§5.2, LOAD-03)", () => {
  const source = readFileSync(join(process.cwd(), "components/layout/page-skeletons.tsx"), "utf8");

  it("are server components that read no data", () => {
    expect(source).not.toMatch(/^"use client"/);
    expect(source).not.toMatch(/prisma|fetch\(|@\/lib\/modules|@\/lib\/context|@\/lib\/database/);
  });

  it("never import the 3D renderer or Platform Admin code", () => {
    expect(source).not.toMatch(/three|@react-three|components\/3d|platform/i);
  });

  it("announce once, outside the hidden, busy shapes", () => {
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-hidden="true" aria-busy="true"');
  });
});

describe("pre-stream status contracts (§2.1)", () => {
  it("match their record routes and never a static sibling page", async () => {
    const { matchPreStreamRoute, PRE_STREAM_ROUTES, STATIC_SIBLINGS } = await import("../../../app/(nesto)/pre-stream-routes");
    const { readdirSync, statSync } = await import("node:fs");
    for (const route of PRE_STREAM_ROUTES) {
      const sample = route.replace(/\[[^\]]+\]/g, "x1");
      expect(matchPreStreamRoute(sample)?.route, route).toBe(route);
      // Every static directory beside the route's last, dynamic segment is a page of its own.
      const parts = route.split("/").filter(Boolean);
      parts.forEach((part, index) => {
        if (!part.startsWith("[") || index !== parts.length - 1) return;
        const parent = join(NESTO_ROOT, ...parts.slice(0, index));
        for (const name of readdirSync(parent)) {
          if (name.startsWith("[") || name.startsWith("(") || !statSync(join(parent, name)).isDirectory()) continue;
          const sibling = `/${[...parts.slice(0, index), name].join("/")}`;
          expect(STATIC_SIBLINGS.has(sibling), `${sibling} must be listed in STATIC_SIBLINGS`).toBe(true);
          expect(matchPreStreamRoute(sibling)).toBeNull();
        }
      });
    }
  });

  it("are listed in the inventory, and only these", () => {
    expect(rows.filter((row) => row.statusContract).map((row) => row.route).sort()).toEqual(
      ["/clients/[clientId]", "/documents/[documentId]", "/hr/employees/[employeeId]", "/hr/employees/[employeeId]/compensation", "/people/[personId]", "/projects/[projectId]/units/[unitId]", "/projects/types", "/qaqc/inspections/[inspectionId]", "/support/[section]/[recordId]", "/tasks/[taskId]"],
    );
  });
});
