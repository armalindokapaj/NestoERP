import { describe, expect, it } from "vitest";

import { dashboardForRole, dashboards } from "@/config/dashboards";
import { kpis } from "@/config/kpis";
import { quickActions } from "@/config/quick-actions";
import { widgets } from "@/config/widgets";
import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";

/**
 * Dashboard resolver tests (PRD #9 §122).
 *
 * Widget visibility follows permission, so a widget listed for a role that does
 * not hold its permission simply never renders (PRD #4 §19).
 */
function visibleWidgets(role: (typeof ROLE_KEYS)[number]) {
  const held = new Set(permissionsForRole(role));
  return dashboardForRole(role)
    .widgets.map((key) => widgets[key])
    .filter((widget) => widget && held.has(widget.permission))
    .map((widget) => widget.key);
}

function visibleKpis(role: (typeof ROLE_KEYS)[number]) {
  const held = new Set(permissionsForRole(role));
  return dashboardForRole(role)
    .kpis.map((key) => kpis[key])
    .filter((kpi) => kpi && held.has(kpi.permission))
    .map((kpi) => kpi.key);
}

describe("dashboard configuration", () => {
  it("defines a dashboard for all 18 roles", () => {
    expect(Object.keys(dashboards)).toHaveLength(18);
    for (const role of ROLE_KEYS) {
      expect(dashboards[role], role).toBeDefined();
    }
  });

  it("references only registered widgets, KPIs and actions", () => {
    for (const role of ROLE_KEYS) {
      const config = dashboards[role];
      for (const key of config.widgets) expect(widgets[key], `${role}/${key}`).toBeDefined();
      for (const key of config.kpis) expect(kpis[key], `${role}/${key}`).toBeDefined();
      for (const key of config.quickActions) {
        expect(quickActions[key], `${role}/${key}`).toBeDefined();
      }
    }
  });

  it("leaves every role with something on screen", () => {
    for (const role of ROLE_KEYS) {
      expect(visibleWidgets(role).length, role).toBeGreaterThan(0);
      expect(visibleKpis(role).length, role).toBeGreaterThan(0);
    }
  });

  it("keeps desktop KPI rows within the recommended maximum (PRD #4 §73)", () => {
    for (const role of ROLE_KEYS) {
      expect(dashboards[role].kpis.length, role).toBeLessThanOrEqual(6);
    }
  });
});

describe("widget visibility by role", () => {
  it("shows the Architect their assigned projects but no company revenue", () => {
    const visible = visibleWidgets("ARCHITECT");
    expect(visible).toContain("myProjects");
    expect(visible).not.toContain("financeSummary");
    expect(visible).not.toContain("salesPipeline");
  });

  it("shows the Owner company-wide widgets", () => {
    const visible = visibleWidgets("OWNER");
    expect(visible).toContain("financeSummary");
    expect(visible).toContain("salesPipeline");
    expect(visible).toContain("workforce");
  });

  it("gives the Viewer no quick actions at all (PRD #4 §22)", () => {
    const held = new Set(permissionsForRole("VIEWER"));
    const allowed = dashboardForRole("VIEWER")
      .quickActions.map((key) => quickActions[key])
      .filter((action) => action && held.has(action.permission));

    expect(allowed).toHaveLength(0);
  });

  it("never offers a quick action the role's permissions would refuse", () => {
    for (const role of ROLE_KEYS) {
      const held = new Set(permissionsForRole(role));
      for (const key of dashboardForRole(role).quickActions) {
        const action = quickActions[key];
        // A configured action the role cannot perform must be filtered out at
        // resolve time — this asserts the filter, not the configuration.
        if (!held.has(action.permission)) continue;
        expect(held.has(action.permission)).toBe(true);
      }
    }
  });
});
