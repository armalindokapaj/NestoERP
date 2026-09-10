import { describe, expect, it } from "vitest";

import { accessAtLeast, type AccessLevel } from "@/config/access";
import { MODULE_KEYS } from "@/config/modules";
import { isMutatingPermission, PERMISSIONS } from "@/config/permissions";
import { accessibleModules, permissionsForRole, roleModuleAccess } from "@/config/role-defaults";
import { ROLE_KEYS, roles, type RoleKey } from "@/config/roles";

/**
 * Permission resolver tests (PRD #9 §120).
 *
 * The matrix in config/role-defaults.ts is the single source of truth, so these
 * assertions are the closest thing NESTO has to a contract with PRD #5 §10.
 */
describe("role × module access matrix", () => {
  it("defines every module for every role", () => {
    for (const role of ROLE_KEYS) {
      for (const moduleKey of MODULE_KEYS) {
        expect(roleModuleAccess[role][moduleKey], `${role}/${moduleKey}`).toBeDefined();
      }
    }
  });

  it("grants every role its own dashboard", () => {
    for (const role of ROLE_KEYS) {
      expect(permissionsForRole(role)).toContain("dashboard.view");
    }
  });

  it("only ever grants permissions from the registry", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLE_KEYS) {
      for (const permission of permissionsForRole(role)) {
        expect(known.has(permission), `${role} holds unknown ${permission}`).toBe(true);
      }
    }
  });

  it("never grants a permission for a module the role cannot open", () => {
    for (const role of ROLE_KEYS) {
      for (const moduleKey of MODULE_KEYS) {
        const access = roleModuleAccess[role][moduleKey];
        if (access.accessLevel === "NONE") {
          expect(access.permissions, `${role}/${moduleKey}`).toHaveLength(0);
        }
      }
    }
  });

  /* PRD #9 §120 — the worked examples from the PRD itself. */
  const expectations: { role: RoleKey; module: (typeof MODULE_KEYS)[number]; level: AccessLevel; scope: string }[] = [
    { role: "OWNER", module: "projects", level: "MANAGE", scope: "COMPANY" },
    { role: "PROJECT_MANAGER", module: "finance", level: "VIEW", scope: "PROJECT" },
    { role: "PROJECT_MANAGER", module: "projects", level: "MANAGE", scope: "PROJECT" },
    { role: "ARCHITECT", module: "sales", level: "NONE", scope: "SELF" },
    { role: "ARCHITECT", module: "projects", level: "CONTRIBUTE", scope: "ASSIGNED" },
    { role: "VIEWER", module: "projects", level: "VIEW", scope: "ASSIGNED" },
    { role: "FINANCE", module: "finance", level: "MANAGE", scope: "COMPANY" },
    { role: "ENGINEER", module: "projects", level: "CONTRIBUTE", scope: "ASSIGNED" },
    { role: "ADMIN", module: "finance", level: "NONE", scope: "SELF" },
    { role: "COMPANY_IT", module: "finance", level: "NONE", scope: "SELF" },
    { role: "COMPANY_IT", module: "settings", level: "MANAGE", scope: "SYSTEM" },
    { role: "CEO", module: "finance", level: "APPROVE", scope: "COMPANY" },
    { role: "QAQC", module: "qaqc", level: "MANAGE", scope: "COMPANY" },
    { role: "HSE", module: "hse", level: "MANAGE", scope: "COMPANY" },
  ];

  for (const expectation of expectations) {
    it(`${expectation.role} + ${expectation.module} → ${expectation.level} / ${expectation.scope}`, () => {
      const access = roleModuleAccess[expectation.role][expectation.module];
      expect(access.accessLevel).toBe(expectation.level);
      if (expectation.level !== "NONE") expect(access.scope).toBe(expectation.scope);
    });
  }
});

describe("read-only enforcement", () => {
  it("gives the Viewer no mutating permission at all", () => {
    for (const permission of permissionsForRole("VIEWER")) {
      expect(isMutatingPermission(permission), `Viewer holds ${permission}`).toBe(false);
    }
  });

  it("never raises a read-only role above VIEW", () => {
    const readOnly = ROLE_KEYS.filter((role) => roles[role].readOnly);
    expect(readOnly.length).toBeGreaterThan(0);

    for (const role of readOnly) {
      for (const moduleKey of MODULE_KEYS) {
        const level = roleModuleAccess[role][moduleKey].accessLevel;
        expect(["NONE", "VIEW"], `${role}/${moduleKey}`).toContain(level);
      }
    }
  });
});

describe("permission ladders", () => {
  it("makes higher access levels cumulative for reading", () => {
    for (const role of ROLE_KEYS) {
      for (const moduleKey of MODULE_KEYS) {
        const access = roleModuleAccess[role][moduleKey];
        if (!accessAtLeast(access.accessLevel, "VIEW")) continue;
        // Every module with access grants at least one view permission.
        expect(
          access.permissions.some((permission) => permission.endsWith(".view")),
          `${role}/${moduleKey} has access but no view permission`,
        ).toBe(true);
      }
    }
  });
});

describe("restricted sub-permissions", () => {
  it("keeps the Architect out of operational finance (PRD #5 §18)", () => {
    const permissions = permissionsForRole("ARCHITECT");
    expect(permissions).toContain("finance.project_budget.view");
    expect(permissions).not.toContain("finance.invoice.view");
    expect(permissions).not.toContain("finance.company_summary.view");
  });

  it("keeps the Project Manager out of company cash position (PRD #5 §17)", () => {
    const permissions = permissionsForRole("PROJECT_MANAGER");
    expect(permissions).toContain("finance.project_budget.view");
    expect(permissions).not.toContain("finance.payment.view");
    expect(permissions).not.toContain("finance.company_summary.view");
  });

  it("gives the CEO the executive summary without bookkeeping (PRD #5 §16)", () => {
    const permissions = permissionsForRole("CEO");
    expect(permissions).toContain("finance.company_summary.view");
    expect(permissions).toContain("finance.invoice.approve");
    expect(permissions).not.toContain("finance.invoice.create");
  });

  it("denies the Admin confidential operational modules (PRD #5 §13)", () => {
    expect(accessibleModules("ADMIN")).not.toContain("finance");
    expect(accessibleModules("ADMIN")).not.toContain("procurement");
    expect(accessibleModules("ADMIN")).toContain("settings");
  });
});
