import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SectionStore } from "@/components/navigation/section-store";
import { readDesktopNav, readPhoneNav, DESKTOP_NAV_CHOICES, PHONE_NAV_CHOICES } from "@/lib/layout/nav-layout";

/**
 * Navigation layouts (docs/ui/UI-04-navigation-layouts.md): the Ribbon or the
 * Dock on a desktop, the Thumb bar or Bottom tabs on a phone, each chosen in
 * Settings › Appearance and read from a cookie.
 */
describe("the layout choices", () => {
  it("defaults to the Ribbon on a desktop and the Thumb bar on a phone", () => {
    expect(readDesktopNav(undefined)).toBe("ribbon");
    expect(readPhoneNav(undefined)).toBe("thumb");
    expect(DESKTOP_NAV_CHOICES[0]).toBe("ribbon");
    expect(PHONE_NAV_CHOICES[0]).toBe("thumb");
  });

  it("reads each choice, and anything else as the default", () => {
    expect(readDesktopNav("dock")).toBe("dock");
    expect(readDesktopNav("sidebar")).toBe("ribbon");
    expect(readPhoneNav("tabs")).toBe("tabs");
    expect(readPhoneNav("drawer")).toBe("thumb");
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
    expect(shell).toContain("<MobileTabsNav");
    expect(shell).toContain("<MobileBottomNav");
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
