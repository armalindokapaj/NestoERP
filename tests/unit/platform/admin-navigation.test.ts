import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_AREAS, ADMIN_HOME, ADMIN_MENU, ADMIN_PAGES, ADMIN_TABS, adminPageFor, adminPagesFor, adminPlaceOf, adminUp } from "@/components/platform/admin-navigation";
import { PLATFORM_PERMISSIONS } from "@/config/platform";
import { workspaceRoutePolicy } from "@/config/workspace-routes";
import { adminEn as en } from "@/lib/i18n/modules/admin/en";
import { adminSq as sq } from "@/lib/i18n/modules/admin/sq";

/** The Admin Console's navigation (docs/ui/UI-09-admin-console.md): six areas by task, the company app's layout. */
describe("Admin Console navigation", () => {
  it("has Home and five Ribbon tabs, every page once, each in an area that exists", () => {
    expect(ADMIN_AREAS).toEqual(["home", "customers", "people", "product", "operations", "security"]);
    expect(ADMIN_TABS).toEqual(ADMIN_AREAS.slice(1));
    expect(new Set(ADMIN_PAGES.map((page) => page.href)).size).toBe(ADMIN_PAGES.length);
    expect(new Set(ADMIN_PAGES.map((page) => page.key)).size).toBe(ADMIN_PAGES.length);
  });

  it("points every page at a page that exists", () => {
    for (const page of ADMIN_PAGES) {
      const file = path.join(process.cwd(), "app", page.href, "page.tsx");
      expect(existsSync(file), page.href).toBe(true);
    }
    expect(existsSync(path.join(process.cwd(), "app", ADMIN_MENU, "page.tsx"))).toBe(true);
  });

  it("names every page, area and set in English and Albanian", () => {
    for (const messages of [en, sq]) {
      const nav = (messages as { nav: { area: Record<string, string>; set: Record<string, string>; page: Record<string, string> } }).nav;
      for (const area of ADMIN_AREAS) expect(nav.area[area], area).toBeTruthy();
      for (const page of ADMIN_PAGES) {
        expect(nav.page[page.key], page.key).toBeTruthy();
        expect(nav.set[page.set], page.set).toBeTruthy();
      }
    }
  });

  it("finds the page a path is under by hierarchy; Overview is the root alone", () => {
    expect(adminPageFor("/admin")?.key).toBe("overview");
    expect(adminPageFor("/admin/organizations/xyz/departments")?.key).toBe("organizations");
    expect(adminPageFor("/admin/modules/plans")?.key).toBe("plans");
    expect(adminPageFor("/admin/modules/company-1")?.key).toBe("entitlements");
    expect(adminPageFor("/admin/3d/projects/p1/models")?.key).toBe("experiences");
    expect(adminPageFor("/admin/system")?.key).toBe("settings");
    expect(adminPageFor("/admin/system/health/")?.key).toBe("health");
    expect(adminPageFor("/admin/account")).toBeNull();
  });

  it("offers only the pages a person holds the permission for", () => {
    expect(adminPagesFor(PLATFORM_PERMISSIONS)).toHaveLength(ADMIN_PAGES.length);
    expect(adminPagesFor(["platform.dashboard.view"]).map((page) => page.area)).toEqual(["home", "home", "home"]);
  });

  it("puts a path in the phone bar's places, and sends Back up a level", () => {
    expect(adminPlaceOf(ADMIN_HOME)).toBe("home");
    expect(adminPlaceOf("/admin/projects/p1")).toBe("customers");
    expect(adminPlaceOf("/admin/users/sessions")).toBe("people");
    expect(adminPlaceOf("/admin/audit")).toBe("menu");
    expect(adminPlaceOf(ADMIN_MENU)).toBe("menu");

    expect(adminUp(ADMIN_HOME)).toBeNull();
    expect(adminUp("/admin/organizations")).toBeNull();
    expect(adminUp(ADMIN_MENU)).toBeNull();
    expect(adminUp("/admin/organizations/xyz")).toBe("/admin/organizations");
    expect(adminUp("/admin/account")).toBe(ADMIN_MENU);
  });

  it("keeps /admin a platform-only route", () => {
    expect(workspaceRoutePolicy("/admin").routeType).toBe("PLATFORM_ONLY");
    expect(workspaceRoutePolicy("/admin/projects/x").routeType).toBe("PLATFORM_ONLY");
  });
});
