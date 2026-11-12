import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readRibbonFolded } from "@/lib/layout/nav-layout";
import { isPlaceRoot, placeOf, projectIdFrom, projectsHref } from "@/lib/navigation/phone";

/**
 * Navigation layouts (docs/ui/UI-04-navigation-layouts.md): one top bar with
 * the Ribbon's five tabs on a desktop, its ribbon open or folded (a cookie);
 * on a phone one layout for everyone — the page's name and search at the top,
 * its sections in a row under them, and the bar of five places at the bottom.
 */
describe("the layout choices", () => {
  it("opens the ribbon unless it was folded", () => {
    expect(readRibbonFolded(undefined)).toBe(false);
    expect(readRibbonFolded("open")).toBe(false);
    expect(readRibbonFolded("folded")).toBe(true);
  });
});

describe("the phone's five places", () => {
  it("marks the place a page belongs to: your day, a project, your inbox, or Menu for everything else", () => {
    expect(placeOf("/my-day")).toBe("home");
    expect(placeOf("/dashboard")).toBe("home");
    expect(placeOf("/projects")).toBe("projects");
    expect(placeOf("/projects/project_a/tasks")).toBe("projects");
    expect(placeOf("/projects/units/sold")).toBe("projects");
    expect(placeOf("/inbox")).toBe("inbox");
    expect(placeOf("/approvals")).toBe("inbox");
    expect(placeOf("/activity")).toBe("inbox");
    expect(placeOf("/menu")).toBe("menu");
    expect(placeOf("/procurement/orders")).toBe("menu");
    expect(placeOf("/inboxes")).toBe("menu");
  });

  it("offers Back everywhere but a place's own first page", () => {
    for (const root of ["/my-day", "/inbox", "/menu", "/projects", "/dashboard", "/projects/project_a"]) expect(isPlaceRoot(root)).toBe(true);
    for (const deeper of ["/projects/project_a/tasks", "/tasks/task_1", "/procurement/orders", "/projects/new"]) expect(isPlaceRoot(deeper)).toBe(false);
  });

  it("opens Projects on the project you were last in, else the list", () => {
    expect(projectsHref("project_a")).toBe("/projects/project_a");
    expect(projectsHref(null)).toBe("/projects");
  });

  it("finds the project Units belongs to in the path, never a page of the module", () => {
    expect(projectIdFrom("/projects/project_a/units")).toBe("project_a");
    expect(projectIdFrom("/projects/project_a")).toBe("project_a");
    expect(projectIdFrom("/projects/new")).toBeNull();
    expect(projectIdFrom("/projects/my-projects")).toBeNull();
    expect(projectIdFrom("/projects/units")).toBeNull();
    expect(projectIdFrom("/projects/units/sold")).toBeNull();
    expect(projectIdFrom("/projects")).toBeNull();
    expect(projectIdFrom("/sales/units")).toBeNull();
  });
});

describe("the shell", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("draws one top bar with the Ribbon in it, the phone's section row and bar of five places, and no Dock or sidebar", () => {
    const shell = read("components/layout/app-shell.tsx");
    expect(shell).toContain("<Topbar");
    expect(shell).toContain("<PhoneSections");
    expect(shell).toContain("<PhoneBar");
    expect(shell).not.toContain("PocketRibbon");
    expect(shell).not.toContain("ActionRibbon");
    expect(shell).not.toContain("Dock");
    expect(shell).not.toMatch(/<Sidebar\b/);
    const topbar = read("components/layout/topbar.tsx");
    for (const part of ["<RibbonProvider", "<RibbonTabs", "<RibbonPanel", "<RibbonUnits", "<ModulesPanel", "<HomeLink", "<PhoneTitle"]) expect(topbar).toContain(part);
  });

  it("gives the bar three columns from lg, the two sides the same width, so the tabs have the same space either side", () => {
    const topbar = read("components/layout/topbar.tsx");
    expect(topbar).toContain("lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    expect(topbar.match(/lg:max-w-\(--nesto-bar-side\)/g)).toHaveLength(2);
    expect(read("styles/globals.css")).toMatch(/--nesto-bar-side: 26rem;/);
  });

  it("leaves a module's sections to the tabs under its title, not the ribbon", () => {
    expect(read("components/layout/ribbon.tsx")).not.toContain("useSectionLevels");
  });

  it("puts the ribbon's state on <html> from the server, for the first paint; the phone has no choice to read", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("data-ribbon={ribbon}");
    expect(layout).not.toContain("data-phone-nav");
    expect(read("styles/globals.css")).toContain(':root:not([data-ribbon="folded"])');
  });

});
