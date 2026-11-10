import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SectionStore } from "@/components/navigation/section-store";
import { readDesktopNav, readPhoneNav, DESKTOP_NAV_CHOICES, PHONE_NAV_CHOICES } from "@/lib/layout/nav-layout";
import { phoneTabs, projectIdFrom } from "@/lib/navigation/phone";
import type { NavigationGroup } from "@/config/navigation";

/**
 * Navigation layouts (docs/ui/UI-04-navigation-layouts.md): the Ribbon or the
 * Dock on a desktop, the Pocket Ribbon or the Action Ribbon on a phone, each chosen in
 * Settings › Appearance and read from a cookie.
 */
describe("the layout choices", () => {
  it("defaults to the Ribbon on a desktop and the Pocket Ribbon on a phone", () => {
    expect(readDesktopNav(undefined)).toBe("ribbon");
    expect(readPhoneNav(undefined)).toBe("pocket");
    expect(DESKTOP_NAV_CHOICES[0]).toBe("ribbon");
    expect(PHONE_NAV_CHOICES[0]).toBe("pocket");
  });

  it("reads each choice, and anything else as the default", () => {
    expect(readDesktopNav("dock")).toBe("dock");
    expect(readDesktopNav("sidebar")).toBe("ribbon");
    expect(readPhoneNav("action")).toBe("action");
    // The retired phone layouts fall back to the default.
    expect(readPhoneNav("thumb")).toBe("pocket");
    expect(readPhoneNav("tabs")).toBe("pocket");
  });
});

describe("the phone Ribbon", () => {
  const item = (key: string) => ({ key, module: key, href: `/${key}`, icon: "NestoOverview" }) as unknown as NavigationGroup["items"][number];

  it("has a tab per group with modules, and Company always, which holds the account", () => {
    const groups: NavigationGroup[] = [
      { group: "primary", label: null, items: [item("dashboard")] },
      { group: "work", label: "Work", items: [] },
      { group: "department", label: "Department", items: [item("finance")] },
    ];
    expect(phoneTabs(groups).map((group) => group.group)).toEqual(["primary", "department", "company"]);
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
  it("is marked in the section store, so the Ribbon can carry it", () => {
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

  it("draws the chosen layouts and no sidebar", () => {
    const shell = read("components/layout/app-shell.tsx");
    expect(shell).toContain("<Ribbon");
    expect(shell).toContain("<DesktopDock");
    expect(shell).toContain("<PocketRibbon");
    expect(shell).toContain("<ActionRibbon");
    expect(shell).not.toMatch(/<Sidebar\b/);
  });

  it("puts both choices on <html> from the server, for the first paint", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("data-desktop-nav={desktopNav}");
    expect(layout).toContain("data-phone-nav={phoneNav}");
  });

  it("hands the module row to the Ribbon only from the module tabs", () => {
    expect(read("components/modules/module-tabs.tsx")).toMatch(/<ContextTabsFrame[^>]*\bmoduleRow\b/);
    expect(read("styles/globals.css")).toContain(':root[data-desktop-nav="ribbon"] [data-module-row]');
  });
});
