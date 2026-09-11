/**
 * Seed validation (PRD #9 §117, §118).
 *
 * A partially valid test environment must never pass silently — every missing
 * record fails the run with a non-zero exit, so CI stops before the test suite
 * produces meaningless results.
 */
import type { PrismaClient } from "@prisma/client";

import { MODULE_KEYS } from "../../config/modules";
import { ROLE_KEYS } from "../../config/roles";
import { COMPANY_A, COMPANY_A_USERS, COMPANY_B, DEPARTMENTS, PROJECT_IDS } from "./constants";

type Check = { label: string; actual: number; expected: number; comparison: "eq" | "gte" };

export async function validateSeed(prisma: PrismaClient): Promise<void> {
  const problems: string[] = [];

  const checks: Check[] = [
    { label: "roles", actual: await prisma.role.count(), expected: ROLE_KEYS.length, comparison: "eq" },
    { label: "modules", actual: await prisma.module.count(), expected: MODULE_KEYS.length, comparison: "eq" },
    { label: "active demo companies", actual: await prisma.company.count({ where: { status: "ACTIVE" } }), expected: 2, comparison: "gte" },
    { label: "Company A role users", actual: await prisma.companyMember.count({ where: { companyId: COMPANY_A, status: "ACTIVE", user: { email: { endsWith: "@nesto.test" } } } }), expected: COMPANY_A_USERS.length, comparison: "gte" },
    { label: "Company A departments", actual: await prisma.department.count({ where: { companyId: COMPANY_A } }), expected: DEPARTMENTS.length, comparison: "eq" },
    { label: "Company A clients", actual: await prisma.client.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "Company A contacts", actual: await prisma.contact.count({ where: { companyId: COMPANY_A } }), expected: 18, comparison: "gte" },
    { label: "Company A projects", actual: await prisma.project.count({ where: { companyId: COMPANY_A } }), expected: 7, comparison: "gte" },
    { label: "Company A tasks", actual: await prisma.task.count({ where: { companyId: COMPANY_A } }), expected: 36, comparison: "gte" },
    { label: "Company A documents", actual: await prisma.document.count({ where: { companyId: COMPANY_A } }), expected: 24, comparison: "gte" },
    { label: "Company A activities", actual: await prisma.activity.count({ where: { companyId: COMPANY_A } }), expected: 40, comparison: "gte" },
    { label: "invoices", actual: await prisma.invoice.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "partially paid current invoices", actual: await prisma.invoice.count({ where: { id: "invoice_015", status: "SENT" } }), expected: 1, comparison: "eq" },
    // Every finance state the module renders (PRD #15 §328–§338).
    { label: "invoice line items", actual: await prisma.invoiceLineItem.count(), expected: 14, comparison: "gte" },
    { label: "overdue invoices", actual: await prisma.invoice.count({ where: { companyId: COMPANY_A, status: "SENT", dueDate: { lt: new Date() } } }), expected: 4, comparison: "gte" },
    { label: "expenses", actual: await prisma.expense.count({ where: { companyId: COMPANY_A } }), expected: 18, comparison: "gte" },
    { label: "approved expenses", actual: await prisma.expense.count({ where: { companyId: COMPANY_A, status: "APPROVED" } }), expected: 10, comparison: "gte" },
    { label: "payments", actual: await prisma.payment.count({ where: { companyId: COMPANY_A } }), expected: 8, comparison: "gte" },
    { label: "voided payments", actual: await prisma.payment.count({ where: { companyId: COMPANY_A, status: "VOIDED" } }), expected: 1, comparison: "gte" },
    { label: "current project budgets", actual: await prisma.projectBudget.count({ where: { companyId: COMPANY_A, isCurrent: true } }), expected: 4, comparison: "gte" },
    { label: "budget line items", actual: await prisma.projectBudgetLineItem.count(), expected: 20, comparison: "gte" },
    { label: "commitments", actual: await prisma.commitment.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "open commitments", actual: await prisma.commitment.count({ where: { companyId: COMPANY_A, status: "APPROVED" } }), expected: 5, comparison: "gte" },
    { label: "pending finance approvals", actual: await prisma.financeApproval.count({ where: { companyId: COMPANY_A, status: "PENDING" } }), expected: 5, comparison: "gte" },
    { label: "decided finance approvals", actual: await prisma.financeApproval.count({ where: { companyId: COMPANY_A, status: { not: "PENDING" } } }), expected: 5, comparison: "gte" },
    { label: "finance settings", actual: await prisma.financeSettings.count(), expected: 2, comparison: "gte" },
    // Every HR state the module renders (PRD #16 §327–§334).
    { label: "employment records", actual: await prisma.employeeProfile.count({ where: { companyId: COMPANY_A } }), expected: 16, comparison: "gte" },
    { label: "planned employment", actual: await prisma.employeeProfile.count({ where: { companyId: COMPANY_A, employmentStatus: "PLANNED" } }), expected: 1, comparison: "gte" },
    { label: "employment on leave", actual: await prisma.employeeProfile.count({ where: { companyId: COMPANY_A, employmentStatus: "ON_LEAVE" } }), expected: 1, comparison: "gte" },
    { label: "suspended employment", actual: await prisma.employeeProfile.count({ where: { companyId: COMPANY_A, employmentStatus: "SUSPENDED" } }), expected: 1, comparison: "gte" },
    { label: "ended employment", actual: await prisma.employeeProfile.count({ where: { companyId: COMPANY_A, employmentStatus: "ENDED" } }), expected: 1, comparison: "gte" },
    { label: "compensation records", actual: await prisma.compensation.count({ where: { companyId: COMPANY_A } }), expected: 9, comparison: "gte" },
    { label: "historical compensation", actual: await prisma.compensation.count({ where: { companyId: COMPANY_A, effectiveTo: { not: null } } }), expected: 2, comparison: "gte" },
    { label: "leave requests", actual: await prisma.leaveRequest.count({ where: { companyId: COMPANY_A } }), expected: 20, comparison: "gte" },
    { label: "pending leave", actual: await prisma.leaveRequest.count({ where: { companyId: COMPANY_A, status: "PENDING" } }), expected: 3, comparison: "gte" },
    { label: "rejected leave", actual: await prisma.leaveRequest.count({ where: { companyId: COMPANY_A, status: "REJECTED" } }), expected: 2, comparison: "gte" },
    { label: "cancelled leave", actual: await prisma.leaveRequest.count({ where: { companyId: COMPANY_A, status: "CANCELLED" } }), expected: 2, comparison: "gte" },
    { label: "leave balances", actual: await prisma.leaveBalance.count({ where: { companyId: COMPANY_A } }), expected: 20, comparison: "gte" },
    { label: "attendance records", actual: await prisma.attendanceRecord.count({ where: { companyId: COMPANY_A } }), expected: 40, comparison: "gte" },
    { label: "system attendance from leave", actual: await prisma.attendanceRecord.count({ where: { companyId: COMPANY_A, sourceEntityType: "leave_request" } }), expected: 10, comparison: "gte" },
    { label: "attendance exceptions", actual: await prisma.attendanceRecord.count({ where: { companyId: COMPANY_A, status: "ABSENT" } }), expected: 1, comparison: "gte" },
    { label: "opportunities", actual: await prisma.opportunity.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "contracts", actual: await prisma.contract.count({ where: { companyId: COMPANY_A } }), expected: 10, comparison: "gte" },
    { label: "purchase requests", actual: await prisma.purchaseRequest.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "purchase orders", actual: await prisma.purchaseOrder.count({ where: { companyId: COMPANY_A } }), expected: 8, comparison: "gte" },
    { label: "inventory items", actual: await prisma.inventoryItem.count({ where: { companyId: COMPANY_A } }), expected: 20, comparison: "gte" },
    { label: "inventory movements", actual: await prisma.inventoryMovement.count({ where: { companyId: COMPANY_A } }), expected: 20, comparison: "gte" },
    { label: "quality records", actual: await prisma.qualityRecord.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "HSE records", actual: await prisma.hseRecord.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "support requests", actual: await prisma.supportRequest.count({ where: { companyId: COMPANY_A } }), expected: 3, comparison: "gte" },
    { label: "Company B projects", actual: await prisma.project.count({ where: { companyId: COMPANY_B } }), expected: 2, comparison: "gte" },
    { label: "Company B clients", actual: await prisma.client.count({ where: { companyId: COMPANY_B } }), expected: 3, comparison: "gte" },
    { label: "Company B tasks", actual: await prisma.task.count({ where: { companyId: COMPANY_B } }), expected: 6, comparison: "gte" },
    { label: "Company B documents", actual: await prisma.document.count({ where: { companyId: COMPANY_B } }), expected: 4, comparison: "gte" },
    { label: "Company B disabled modules", actual: await prisma.companyModule.count({ where: { companyId: COMPANY_B, enabled: false } }), expected: 1, comparison: "gte" },
    // Every membership and invitation state the Team module renders
    // (PRD #14 §304–§306).
    { label: "Company A invited members", actual: await prisma.companyMember.count({ where: { companyId: COMPANY_A, status: "INVITED" } }), expected: 1, comparison: "gte" },
    { label: "Company A inactive members", actual: await prisma.companyMember.count({ where: { companyId: COMPANY_A, status: "INACTIVE" } }), expected: 1, comparison: "gte" },
    { label: "Company A suspended members", actual: await prisma.companyMember.count({ where: { companyId: COMPANY_A, status: "SUSPENDED" } }), expected: 1, comparison: "gte" },
    { label: "Company A pending invitations", actual: await prisma.companyInvite.count({ where: { companyId: COMPANY_A, status: "PENDING", expiresAt: { gt: new Date() } } }), expected: 2, comparison: "gte" },
    { label: "Company A expired invitations", actual: await prisma.companyInvite.count({ where: { companyId: COMPANY_A, status: "PENDING", expiresAt: { lt: new Date() } } }), expected: 1, comparison: "gte" },
    { label: "Company A cancelled invitations", actual: await prisma.companyInvite.count({ where: { companyId: COMPANY_A, status: "CANCELLED" } }), expected: 1, comparison: "gte" },
    { label: "Company A accepted invitations", actual: await prisma.companyInvite.count({ where: { companyId: COMPANY_A, status: "ACCEPTED" } }), expected: 1, comparison: "gte" },
    { label: "Company A departments with a manager", actual: await prisma.department.count({ where: { companyId: COMPANY_A, managerMemberId: { not: null } } }), expected: 5, comparison: "gte" },
  ];

  for (const check of checks) {
    const ok = check.comparison === "eq" ? check.actual === check.expected : check.actual >= check.expected;
    if (!ok) {
      problems.push(
        `${check.label}: expected ${check.comparison === "eq" ? "" : "at least "}${check.expected}, found ${check.actual}`,
      );
    }
  }

  // The project membership matrix is what makes scope testable, so it is
  // asserted cell by cell rather than merely counted (PRD #9 §45).
  const expectedMembership: Record<string, string[]> = {
    "pm@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.b],
    "architect@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.c],
    "engineer@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.d],
    "qaqc@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.b, PROJECT_IDS.d],
    "hse@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.b, PROJECT_IDS.d],
    "viewer@nesto.test": [PROJECT_IDS.a],
  };

  for (const [email, projects] of Object.entries(expectedMembership)) {
    const rows = await prisma.projectMember.findMany({
      where: {
        companyId: COMPANY_A,
        status: "ACTIVE",
        member: { user: { email } },
      },
      select: { projectId: true },
    });

    const actual = rows.map((row) => row.projectId).sort();
    const expected = [...projects].sort();

    if (actual.join(",") !== expected.join(",")) {
      problems.push(
        `project membership for ${email}: expected [${expected.join(", ")}], found [${actual.join(", ")}]`,
      );
    }
  }

  // Cross-company relations must never exist in normal demo data
  // (PRD #9 §115).
  const crossCompanyProjects = await prisma.project.count({
    where: { client: { isNot: null }, NOT: { client: { is: { companyId: { equals: COMPANY_A } } } }, companyId: COMPANY_A },
  });
  if (crossCompanyProjects > 0) {
    problems.push(`${crossCompanyProjects} Company A project(s) reference a client from another company`);
  }

  if (problems.length > 0) {
    throw new Error(`Seed validation failed:\n  - ${problems.join("\n  - ")}`);
  }
}
