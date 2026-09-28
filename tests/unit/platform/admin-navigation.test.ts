import { describe, expect, it } from "vitest";

import { activeDestination, activeTab, adminDestinations, visibleTo } from "@/components/platform/admin-navigation";
import { PLATFORM_PERMISSIONS } from "@/config/platform";
import { workspaceRoutePolicy } from "@/config/workspace-routes";

describe("Platform Admin navigation (Admin IA §5, §12, §23)", () => {
  it("has the eight flat destinations, utilities last", () => {
    expect(adminDestinations.map((item) => item.label)).toEqual(["Dashboard", "Organizations", "Projects", "Modules", "Users", "3D / Rozaris", "Audit Log", "System"]);
    expect(adminDestinations.filter((item) => item.utility).map((item) => item.key)).toEqual(["audit", "system"]);
  });

  it("marks exactly one destination by hierarchy, not equality", () => {
    expect(activeDestination("/admin")?.key).toBe("dashboard");
    expect(activeDestination("/admin/projects")?.key).toBe("projects");
    expect(activeDestination("/admin/projects/abc123")?.key).toBe("projects");
    expect(activeDestination("/admin/3d/projects/abc123/models")?.key).toBe("3d");
    expect(activeDestination("/admin/organizations/xyz/departments")?.key).toBe("organizations");
    expect(activeDestination("/admin/users/sessions/")?.key).toBe("users");
    expect(activeDestination("/admin/account")).toBeUndefined();
    expect(activeDestination("/dashboard")).toBeUndefined();
  });

  it("shows section tabs on the tab pages only, never on a detail page", () => {
    expect(activeTab("/admin/users/roles")?.tab.label).toBe("Roles");
    expect(activeTab("/admin/audit")?.tab.label).toBe("All events");
    expect(activeTab("/admin/organizations/some-id")).toBeUndefined();
    expect(activeTab("/admin/3d/projects/p1")).toBeUndefined();
  });

  it("every tab stays inside its destination, and permissions filter what is shown", () => {
    for (const destination of adminDestinations) for (const tab of destination.tabs ?? []) expect(activeDestination(tab.href)?.key).toBe(destination.key);
    expect(visibleTo(adminDestinations, PLATFORM_PERMISSIONS)).toHaveLength(8);
    expect(visibleTo(adminDestinations, ["platform.dashboard.view"]).map((item) => item.key)).toEqual(["dashboard"]);
  });

  it("keeps /admin a platform-only route", () => {
    expect(workspaceRoutePolicy("/admin").routeType).toBe("PLATFORM_ONLY");
    expect(workspaceRoutePolicy("/admin/projects/x").routeType).toBe("PLATFORM_ONLY");
  });
});
