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
    { role: "PLATFORM_ADMIN", module: "finance", level: "NONE", scope: "SELF" },
    { role: "PLATFORM_ADMIN", module: "settings", level: "NONE", scope: "SELF" },
    { role: "GROUP_IT", module: "finance", level: "NONE", scope: "SELF" },
    { role: "GROUP_IT", module: "settings", level: "MANAGE", scope: "SYSTEM" },
    // Every business module at the Owner's level (the user, 2026-11: "CEO does everything").
    { role: "CEO", module: "finance", level: "MANAGE", scope: "COMPANY" },
    { role: "CEO", module: "sales", level: "MANAGE", scope: "COMPANY" },
    { role: "CEO", module: "clients", level: "MANAGE", scope: "COMPANY" },
    // The company's settings as the Owner keeps them (the user, 2026-11-10: "CEO can.").
    { role: "CEO", module: "settings", level: "MANAGE", scope: "COMPANY" },
    { role: "CEO", module: "company", level: "MANAGE", scope: "COMPANY" },
    { role: "CEO", module: "organization", level: "VIEW", scope: "COMPANY" },
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
        // Every module with access grants at least one view permission —
        // Timesheets' is `timesheet.view_own`: everyone reads their own (PRD #42 §122).
        expect(
          access.permissions.some((permission) => permission.endsWith(".view") || permission.endsWith(".view_own")),
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

  /*
   * The CEO was an approver and viewer: no invoice, expense, deal or contract
   * of their own (PRD #5 §16). The user changed that on 2026-11-09 ("CEO does
   * everything"): the Owner's rights in every company module, without the
   * Owner's unconditional self-approval or the group's ownership. On
   * 2026-11-10 the company's settings followed ("CEO can."); the audit log and
   * the Owner and Group IT seats did not.
   */
  it("gives the CEO the Owner's rights in every company module, and not the group's", () => {
    const ceo = new Set(permissionsForRole("CEO"));
    const owner = permissionsForRole("OWNER");
    for (const permission of ["finance.invoice.create", "finance.payment.create", "finance.expense.create", "finance.budget.create", "finance.commitment.create", "finance.export", "sales.lead.create", "sales.opportunity.create", "sales.proposal.create", "client.create", "legal.contract.create", "procurement.request.create", "task.create", "document.create", "daily_log.create", "hse.incident.create", "qaqc.inspection.create", "inventory.item.create", "finance.settings.manage", "hr.compensation.view"] as const) {
      expect(ceo.has(permission), permission).toBe(true);
    }
    for (const permission of ["settings.manage", "company.manage", "company.settings.update", "company.finance_settings.manage", "company.modules.manage", "security.policy.manage"] as const) {
      expect(ceo.has(permission), permission).toBe(true);
    }
    // Every difference is the group's, the audit log, the Owner and Group IT seats, or self-approval.
    const ownerOnly = owner.filter((permission) => !ceo.has(permission));
    expect(ownerOnly.filter((permission) => !/^(organization\.|department\.|person_profile\.|candidate\.)/.test(permission)).sort()).toEqual([
      "audit.export",
      "audit.sensitive.view",
      "audit.view",
      "finance.approval.self",
      "legal.approval.self",
      "sales.approval.self",
      "team.group_role.assign",
      "team.owner.assign",
    ]);
    expect([...ceo].filter((permission) => !owner.includes(permission))).toEqual([]);
  });

  it("denies Group IT confidential operational modules (PRD #5 §13, E-06 §75)", () => {
    expect(accessibleModules("GROUP_IT")).not.toContain("finance");
    expect(accessibleModules("GROUP_IT")).not.toContain("procurement");
    expect(accessibleModules("GROUP_IT")).toContain("settings");
  });

  it("gives the Platform Admin no company module beyond the landing page (E-06 §19, §74)", () => {
    expect(accessibleModules("PLATFORM_ADMIN")).toEqual(["dashboard"]);
  });
});
