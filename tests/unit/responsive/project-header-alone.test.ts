import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * A project whose reader sees no section but its Overview draws no tab row
 * (ContextTabs needs two tabs), so its compact header stands alone below lg.
 * The project's ⋯ (favourite, offline, edit, status, archive) must still end
 * that header on the Overview, as it ends the tab row's place when the project
 * has sections; elsewhere it is not drawn there (review 2026-11-10).
 */

let pathname = "/projects/p1";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/navigation/page-menu", () => ({ PageMenuSlot: () => null }));
vi.mock("@/components/projects/portfolio/project-status-badge", () => ({ ProjectStatusBadge: () => React.createElement("span", { "data-testid": "status" }) }));
vi.mock("@/components/navigation/context-tabs", () => ({
  ContextTabs: ({ tabs, trailing }: { tabs: unknown[]; trailing?: React.ReactNode }) => (tabs.length <= 1 ? null : React.createElement("div", { "data-tabs": "" }, trailing)),
}));

const { ProjectNavBar } = await import("@/app/(nesto)/projects/[projectId]/project-nav-bar");

const identity = { name: "Riverside", code: "RV", companyName: "NESTO", status: "ACTIVE" as const };
const menu = React.createElement("button", { "data-testid": "project-menu" }, "⋯");
const overview = { key: "overview" as const, label: "Overview", href: "/projects/p1" };
const units = { key: "units" as const, label: "Units", href: "/projects/p1/units" };

function render(tabs: Array<typeof overview | typeof units>, at: string) {
  pathname = at;
  return renderToStaticMarkup(React.createElement(ProjectNavBar, { projectId: "p1", crumbs: [], tabs, sectionsLabel: "Sections", identity, overviewTrailing: menu }));
}

describe("a project with only its Overview, below lg", () => {
  it("ends the standalone compact header with the project's menu on the Overview", () => {
    const html = render([overview], "/projects/p1");
    expect(html).toContain('data-testid="project-phone-identity"');
    expect(html).toContain('data-testid="project-menu"');
    // Below lg only: from lg the Overview's hero draws the menu.
    expect(html).toMatch(/class="[^"]*\blg:hidden\b[^"]*" data-project-header-alone/);
  });

  it("does not draw it away from the Overview", () => {
    expect(render([overview], "/projects/p1/units/u1")).not.toContain('data-testid="project-menu"');
  });

  it("leaves a project with sections to the tab row, once", () => {
    const html = render([overview, units], "/projects/p1");
    expect(html.match(/data-testid="project-menu"/g)).toHaveLength(1);
    expect(html).not.toContain("data-project-header-alone");
  });
});
