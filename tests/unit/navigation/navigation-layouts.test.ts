import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SectionStore } from "@/components/navigation/section-store";
import { readPhoneNav, readRibbonFolded, PHONE_NAV_CHOICES } from "@/lib/layout/nav-layout";
import { phoneTabs, projectIdFrom } from "@/lib/navigation/phone";
import type { NavigationGroup } from "@/config/navigation";

/**
 * Navigation layouts (docs/ui/UI-04-navigation-layouts.md): one top bar with
 * the Ribbon's four tabs on a desktop, its ribbon open or folded; the Pocket
 * Ribbon or the Action Ribbon on a phone, chosen in Settings › Appearance.
 * Both read from cookies.
 */
describe("the layout choices", () => {
  it("opens the ribbon unless it was folded", () => {
    expect(readRibbonFolded(undefined)).toBe(false);
    expect(readRibbonFolded("open")).toBe(false);
    expect(readRibbonFolded("folded")).toBe(true);
  });

  it("defaults to the Pocket Ribbon on a phone, and reads anything else as the default", () => {
    expect(readPhoneNav(undefined)).toBe("pocket");
    expect(PHONE_NAV_CHOICES[0]).toBe("pocket");
    expect(readPhoneNav("action")).toBe("action");
    // The retired phone layouts fall back to the default.
    expect(readPhoneNav("thumb")).toBe("pocket");
    expect(readPhoneNav("tabs")).toBe("pocket");
  });
});

describe("the phone Ribbon", () => {
  const item = (key: string) => ({ key, module: key, href: `/${key}`, icon: "NestoOverview" }) as unknown as NavigationGroup["items"][number];

  it("has the Ribbon's tabs this person has modules in, never Home or Company", () => {
    const groups: NavigationGroup[] = [
      { group: "primary", items: [item("dashboard")] },
      { group: "work", items: [item("projects")] },
      { group: "sales", items: [] },
      { group: "finance", items: [item("finance")] },
      { group: "company", items: [item("settings")] },
    ];
    expect(phoneTabs(groups).map((group) => group.group)).toEqual(["work", "finance"]);
  });

  it("finds the project Units belongs to in the path, never a page of the module", () => {
    expect(projectIdFrom("/projects/project_a/units")).toBe("project_a");
    expect(projectIdFrom("/projects/project_a")).toBe("project_a");
    expect(projectIdFrom("/projects/new")).toBeNull();
    expect(projectIdFrom("/projects/my-projects")).toBeNull();
    expect(projectIdFrom("/projects")).toBeNull();
    expect(projectIdFrom("/sales/units")).toBeNull();
  });
});

describe("the module's section row", () => {
  it("is marked in the section store, so the Ribbon can carry it too", () => {
    const store = new SectionStore();
    const items = [
      { key: "overview", label: "Overview", href: "/finance", active: true },
      { key: "invoices", label: "Invoices", href: "/finance/invoices", active: false },
    ];
    store.set("module", { label: "Finance sections", items, module: true });
    store.set("record", { label: "Invoice", items });
    const [moduleLevel, recordLevel] = store.getSnapshot();
    expect(moduleLevel?.module).toBe(true);
    expect(recordLevel?.module).toBeUndefined();
  });
});

describe("the shell", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("draws one top bar with the Ribbon in it, the phone layouts, and no Dock or sidebar", () => {
    const shell = read("components/layout/app-shell.tsx");
    expect(shell).toContain("<Topbar");
    expect(shell).toContain("<PocketRibbon");
    expect(shell).toContain("<ActionRibbon");
    expect(shell).not.toContain("Dock");
    expect(shell).not.toMatch(/<Sidebar\b/);
    const topbar = read("components/layout/topbar.tsx");
    expect(topbar).toContain("<Ribbon");
    expect(topbar).toContain("<ModulesPanel");
    expect(topbar).toContain("<HomeLink");
  });

  it("puts the ribbon's state and the phone choice on <html> from the server, for the first paint", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("data-ribbon={ribbon}");
    expect(layout).toContain("data-phone-nav={phoneNav}");
    expect(read("styles/globals.css")).toContain(':root:not([data-ribbon="folded"])');
  });

  it("keeps the module's section row under the title, marked for the Ribbon", () => {
    expect(read("components/modules/module-tabs.tsx")).toMatch(/<ContextTabsFrame[^>]*\bmoduleRow\b/);
    expect(read("styles/globals.css")).not.toContain("[data-module-row] {");
  });
});
