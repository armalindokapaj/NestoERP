import { describe, expect, it } from "vitest";

import { isMutatingPermission } from "@/config/permissions";
import { permissionsForRole, roleModuleAccess } from "@/config/role-defaults";
import { ROLE_KEYS, type RoleKey } from "@/config/roles";

/**
 * Domain boundaries between the roles (PRD #47 §141-§149, §215, §216).
 *
 * The role matrix test proves each role's configuration is internally
 * consistent. This one proves the configuration keeps each role inside its own
 * domain: that an administrator is not an approver, that infrastructure access
 * is not business access, and that one confidential domain never comes along
 * with another. Changing any of these is a product decision, and should fail a
 * test until someone has made it on purpose.
 */

const held = (role: RoleKey) => permissionsForRole(role) as readonly string[];
const matching = (role: RoleKey, pattern: RegExp) => held(role).filter((permission) => pattern.test(permission));

/** Every decision a role may take on somebody else's submission (§142, §143, §179). */
const APPROVAL = /(\.|_)approve$|\.decide$/;
const EXPECTED_APPROVALS: Record<RoleKey, string[]> = {
  OWNER: ["document.review.decide", "engineering_document.approve", "finance.approval.decide", "finance.budget.approve", "finance.commitment.approve", "finance.expense.approve", "finance.invoice.approve", "hr.attendance.approve", "hr.leave.approve", "hse.approval.decide", "hse.inspection.approve", "hse.permit.approve", "hse.risk.approve", "legal.amendment.approve", "legal.approval.decide", "legal.contract.approve", "procurement.approval.decide", "procurement.order.approve", "procurement.order.finance_approve", "procurement.request.approve", "project.unit.sale.approve", "qaqc.approval.decide", "qaqc.inspection.approve", "qaqc.ncr.approve", "sales.proposal.approve", "submittal.approve", "timesheet.approve"],
  // A Company Admin approves a unit's sale where the Sold rule asks for it (E-05F §42, §56).
  ADMIN: ["document.review.decide", "project.unit.sale.approve"],
  COMPANY_IT: [],
  HR: ["document.review.decide", "hr.attendance.approve", "hr.leave.approve", "timesheet.approve"],
  CEO: ["finance.approval.decide", "finance.budget.approve", "finance.commitment.approve", "finance.expense.approve", "finance.invoice.approve", "legal.amendment.approve", "legal.approval.decide", "legal.contract.approve", "procurement.approval.decide", "procurement.order.approve", "procurement.request.approve", "project.unit.sale.approve", "sales.proposal.approve", "timesheet.approve"],
  PROJECT_MANAGER: ["document.review.decide", "engineering_document.approve", "submittal.approve", "timesheet.approve"],
  ARCHITECT: ["document.review.decide", "engineering_document.approve", "submittal.approve"],
  ARCHITECTURE_MANAGER: ["document.review.decide", "engineering_document.approve", "submittal.approve"],
  ENGINEER: ["document.review.decide", "engineering_document.approve", "submittal.approve"],
  FINANCE: ["document.review.decide", "procurement.order.finance_approve"],
  LEGAL: ["document.review.decide", "legal.amendment.approve", "legal.approval.decide", "legal.contract.approve"],
  SALES: ["document.review.decide"],
  SALES_MANAGER: ["document.review.decide", "project.unit.sale.approve", "sales.proposal.approve"],
  PROCUREMENT: ["document.review.decide", "procurement.approval.decide", "procurement.order.approve", "procurement.request.approve"],
  INVENTORY: ["document.review.decide"],
  QAQC: ["document.review.decide", "qaqc.approval.decide", "qaqc.inspection.approve", "qaqc.ncr.approve", "submittal.approve"],
  HSE: ["document.review.decide", "hse.approval.decide", "hse.inspection.approve", "hse.permit.approve", "hse.risk.approve", "submittal.approve"],
  VIEWER: [],
};

describe("approval authority per role (PRD #47 §141, §142)", () => {
  it.each(ROLE_KEYS)("%s decides exactly what its domain gives it", (role) => {
    expect(matching(role, APPROVAL).sort()).toEqual([...EXPECTED_APPROVALS[role]].sort());
  });
});

describe("domain boundaries (PRD #47 §143-§149)", () => {
  it("does not make the Admin an approver of Finance, Legal, HR or Procurement (§143, §215)", () => {
    expect(matching("ADMIN", /^(finance|legal|hr|procurement)\..*(approve|decide)/)).toEqual([]);
    expect(matching("ADMIN", /^(finance|legal|procurement)\./)).toEqual([]);
  });

  it("gives Company IT no Finance, Legal, Procurement or confidential HR data (§144, §216)", () => {
    expect(matching("COMPANY_IT", /^(finance|legal|procurement|sales)\./)).toEqual([]);
    expect(roleModuleAccess.COMPANY_IT.hr.scope).toBe("SELF");
    expect(held("COMPANY_IT")).not.toContain("hr.employee.view");
    expect(held("COMPANY_IT")).not.toContain("hr.compensation.view");
    expect(held("COMPANY_IT")).not.toContain("hr.document.view");
  });

  it("lets the Viewer change nothing but their own acknowledgements (§145, §214)", () => {
    expect(held("VIEWER").filter(isMutatingPermission)).toEqual([]);
  });

  it("keeps the Project Manager to their own projects (§146)", () => {
    expect(roleModuleAccess.PROJECT_MANAGER.projects.scope).toBe("PROJECT");
    expect(roleModuleAccess.PROJECT_MANAGER.finance.scope).toBe("PROJECT");
  });

  it("keeps the Engineer out of private Finance and HR records (§147)", () => {
    expect(held("ENGINEER")).not.toContain("finance.invoice.view");
    expect(held("ENGINEER")).not.toContain("finance.payment.view");
    expect(held("ENGINEER")).not.toContain("hr.compensation.view");
    expect(roleModuleAccess.ENGINEER.hr.scope).toBe("SELF");
    expect(matching("ENGINEER", /^legal\./)).toEqual([]);
  });

  it("keeps Finance out of HSE and confidential HR records (§148)", () => {
    expect(roleModuleAccess.FINANCE.hse.accessLevel).toBe("NONE");
    expect(roleModuleAccess.FINANCE.hr.scope).toBe("SELF");
    expect(held("FINANCE")).not.toContain("hr.compensation.view");
    expect(matching("FINANCE", /^hr\..*(create|update|approve)/)).toEqual([]);
  });

  it("does not give Legal HR access, or any say over Finance records (§149)", () => {
    expect(roleModuleAccess.LEGAL.hr.accessLevel).toBe("NONE");
    expect(matching("LEGAL", /^finance\./).filter(isMutatingPermission)).toEqual([]);
    expect(matching("LEGAL", /^finance\..*(approve|decide)/)).toEqual([]);
  });

  it("reserves compensation to the roles that own pay (§98)", () => {
    const withCompensation = ROLE_KEYS.filter((role) => held(role).includes("hr.compensation.view"));
    expect(withCompensation.sort()).toEqual(["HR", "OWNER"]);
  });

  it("reserves Owner assignment to the Owner (§229)", () => {
    const assigners = ROLE_KEYS.filter((role) => held(role).includes("team.owner.assign"));
    expect(assigners).toEqual(["OWNER"]);
  });
});
