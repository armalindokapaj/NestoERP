/**
 * Seed validation (PRD #9 §117, §118; E-06 §131-§135).
 *
 * A partially valid test environment must never pass silently — every missing
 * record fails the run with a non-zero exit, so CI stops before the test suite
 * produces meaningless results.
 *
 * The demo is exact where the product says it is (one visible group, five
 * companies, one project each) and "at least" where it only has to be rich.
 */
import type { PrismaClient } from "@prisma/client";

import { GROUP_DEPARTMENTS } from "../../config/group-departments";
import { MODULE_KEYS } from "../../config/modules";
import { ROLE_KEYS } from "../../config/roles";
import { findEmploymentFindings } from "../../lib/modules/hr/employment/employment.integrity";
import {
  COMPANY_A,
  DEMO_COMPANY_IDS,
  DEMO_GROUP,
  DEMO_PROJECTS,
  FIXTURE_GROUP,
  FIXTURE_TENANT,
  FIXTURE_WORKS,
  PROJECT_IDS,
} from "./constants";
import { COMPANY_USERS, GROUP_USERS, PLATFORM_USERS, POSITIONS } from "./demo/users";

type Check = { label: string; actual: number; expected: number; comparison: "eq" | "gte" };

export async function validateSeed(prisma: PrismaClient): Promise<void> {
  const problems: string[] = [];

  // Every employment agrees with its history, and every login with its employment (E-03 §181, §215).
  for (const finding of await findEmploymentFindings(prisma)) {
    if (finding.level === "error") problems.push(`employment: ${finding.code} — ${finding.message}`);
  }

  const checks: Check[] = [
    { label: "roles", actual: await prisma.role.count(), expected: ROLE_KEYS.length, comparison: "eq" },
    { label: "modules", actual: await prisma.module.count(), expected: MODULE_KEYS.length, comparison: "eq" },
    /* E-06 §131-§133: the visible demo is exact. */
    { label: "visible parent groups", actual: await prisma.parentGroup.count({ where: { isTestFixture: false } }), expected: 1, comparison: "eq" },
    { label: "active companies in the demo group", actual: await prisma.company.count({ where: { parentGroupId: DEMO_GROUP.id, status: "ACTIVE" } }), expected: 5, comparison: "eq" },
    { label: "companies in the demo group", actual: await prisma.company.count({ where: { parentGroupId: DEMO_GROUP.id } }), expected: 5, comparison: "eq" },
    { label: "visible projects", actual: await prisma.project.count({ where: { company: { parentGroupId: DEMO_GROUP.id }, archivedAt: null } }), expected: 5, comparison: "eq" },
    { label: "test fixture groups", actual: await prisma.parentGroup.count({ where: { id: FIXTURE_GROUP.id, isTestFixture: true } }), expected: 1, comparison: "eq" },
    { label: "demo group departments", actual: await prisma.groupDepartment.count({ where: { parentGroupId: DEMO_GROUP.id } }), expected: GROUP_DEPARTMENTS.length, comparison: "eq" },
    { label: "demo company departments", actual: await prisma.department.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: GROUP_DEPARTMENTS.length * DEMO_COMPANY_IDS.length, comparison: "eq" },
    { label: "demo company departments not linked to a group department", actual: await prisma.department.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, groupDepartmentId: null } }), expected: 0, comparison: "eq" },
    { label: "demo users with a company membership", actual: await prisma.user.count({ where: { id: { in: [...GROUP_USERS, ...COMPANY_USERS].map((user) => user.id) }, memberships: { some: { status: "ACTIVE" } } } }), expected: GROUP_USERS.length + COMPANY_USERS.length, comparison: "eq" },
    { label: "Company A clients", actual: await prisma.client.count({ where: { companyId: COMPANY_A } }), expected: 4, comparison: "gte" },
    { label: "demo clients", actual: await prisma.client.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 12, comparison: "gte" },
    { label: "demo contacts", actual: await prisma.contact.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 18, comparison: "gte" },
    // Riverside Residences: three blocks, 96 apartments among 126 units (E-05B §3).
    { label: "Company A unit types", actual: await prisma.projectUnitType.count({ where: { companyId: COMPANY_A } }), expected: 10, comparison: "gte" },
    { label: "Riverside buildings", actual: await prisma.projectBuilding.count({ where: { projectId: PROJECT_IDS.a } }), expected: 3, comparison: "eq" },
    { label: "Riverside apartments", actual: await prisma.projectUnit.count({ where: { projectId: PROJECT_IDS.a, unitType: { code: "APARTMENT" } } }), expected: 96, comparison: "eq" },
    { label: "fixture tenant units", actual: await prisma.projectUnit.count({ where: { companyId: FIXTURE_TENANT } }), expected: 3, comparison: "gte" },
    { label: "demo tasks", actual: await prisma.task.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 36, comparison: "gte" },
    { label: "demo documents", actual: await prisma.document.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 24, comparison: "gte" },
    { label: "demo activities", actual: await prisma.activity.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 40, comparison: "gte" },
    { label: "invoices", actual: await prisma.invoice.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 12, comparison: "gte" },
    { label: "partially paid current invoices", actual: await prisma.invoice.count({ where: { id: "invoice_015", status: "SENT" } }), expected: 1, comparison: "eq" },
    // Every finance state the module renders (PRD #15 §328–§338).
    { label: "invoice line items", actual: await prisma.invoiceLineItem.count(), expected: 14, comparison: "gte" },
    { label: "overdue invoices", actual: await prisma.invoice.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "SENT", dueDate: { lt: new Date() } } }), expected: 4, comparison: "gte" },
    { label: "expenses", actual: await prisma.expense.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 18, comparison: "gte" },
    { label: "approved expenses", actual: await prisma.expense.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "APPROVED" } }), expected: 10, comparison: "gte" },
    { label: "payments", actual: await prisma.payment.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 8, comparison: "gte" },
    { label: "voided payments", actual: await prisma.payment.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "VOIDED" } }), expected: 1, comparison: "gte" },
    { label: "current project budgets", actual: await prisma.projectBudget.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, isCurrent: true } }), expected: 4, comparison: "gte" },
    { label: "budget line items", actual: await prisma.projectBudgetLineItem.count(), expected: 20, comparison: "gte" },
    { label: "commitments", actual: await prisma.commitment.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 12, comparison: "gte" },
    { label: "open commitments", actual: await prisma.commitment.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "APPROVED" } }), expected: 5, comparison: "gte" },
    { label: "pending finance approvals", actual: await prisma.financeApproval.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "PENDING" } }), expected: 5, comparison: "gte" },
    { label: "decided finance approvals", actual: await prisma.financeApproval.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: { not: "PENDING" } } }), expected: 5, comparison: "gte" },
    { label: "finance settings", actual: await prisma.financeSettings.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 5, comparison: "eq" },
    // Every login working in the group is a person of it, and has an employing company (E-01 §7, §219).
    { label: "demo logins without a person", actual: await prisma.user.count({ where: { personProfileId: null, memberships: { some: { status: "ACTIVE", companyId: { in: DEMO_COMPANY_IDS } } } } }), expected: 0, comparison: "eq" },
    { label: "demo logins without an employment", actual: await prisma.user.count({ where: { memberships: { some: { status: "ACTIVE", companyId: { in: DEMO_COMPANY_IDS } } }, personProfile: { is: { employments: { none: {} } } } } }), expected: 0, comparison: "eq" },
    { label: "demo companies with registration and tax numbers", actual: await prisma.company.count({ where: { id: { in: DEMO_COMPANY_IDS }, registrationNumber: { not: null }, taxNumber: { not: null } } }), expected: 5, comparison: "eq" },
    { label: "work profiles filled in", actual: await prisma.personProfile.count({ where: { professionalBio: { not: null } } }), expected: 6, comparison: "gte" },
    // Every HR state the module renders (PRD #16 §327–§334).
    { label: "employment records", actual: await prisma.employeeProfile.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 16, comparison: "gte" },
    { label: "planned employment", actual: await prisma.employeeProfile.count({ where: { companyId: COMPANY_A, employmentStatus: "PLANNED" } }), expected: 1, comparison: "gte" },
    { label: "employment on leave", actual: await prisma.employeeProfile.count({ where: { companyId: COMPANY_A, employmentStatus: "ON_LEAVE" } }), expected: 1, comparison: "gte" },
    { label: "suspended employment", actual: await prisma.employeeProfile.count({ where: { companyId: FIXTURE_WORKS, employmentStatus: "SUSPENDED" } }), expected: 1, comparison: "gte" },
    { label: "ended employment", actual: await prisma.employeeProfile.count({ where: { companyId: FIXTURE_WORKS, employmentStatus: "ENDED" } }), expected: 1, comparison: "gte" },
    { label: "companies with employment records", actual: (await prisma.employeeProfile.groupBy({ by: ["companyId"], where: { companyId: { in: DEMO_COMPANY_IDS } } })).length, expected: 5, comparison: "eq" },
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
    { label: "leads", actual: await prisma.lead.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 20, comparison: "gte" },
    { label: "opportunities", actual: await prisma.opportunity.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 25, comparison: "gte" },
    { label: "proposals", actual: await prisma.proposal.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 12, comparison: "gte" },
    { label: "sales approvals", actual: await prisma.salesApproval.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 5, comparison: "gte" },
    { label: "contracts", actual: await prisma.contract.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 20, comparison: "gte" },
    { label: "active contracts", actual: await prisma.contract.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "ACTIVE" } }), expected: 9, comparison: "gte" },
    { label: "contract parties", actual: await prisma.contractParty.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 30, comparison: "gte" },
    { label: "contract obligations", actual: await prisma.contractObligation.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 24, comparison: "gte" },
    { label: "overdue obligations", actual: await prisma.contractObligation.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "OPEN", dueDate: { lt: new Date() } } }), expected: 4, comparison: "gte" },
    { label: "contract amendments", actual: await prisma.contractAmendment.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 8, comparison: "gte" },
    { label: "active amendments", actual: await prisma.contractAmendment.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "ACTIVE" } }), expected: 2, comparison: "gte" },
    { label: "contract approvals", actual: await prisma.contractApproval.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 10, comparison: "gte" },
    { label: "pending contract approvals", actual: await prisma.contractApproval.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: "PENDING" } }), expected: 3, comparison: "gte" },
    { label: "suppliers", actual: await prisma.supplier.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "purchase requests", actual: await prisma.purchaseRequest.count({ where: { companyId: COMPANY_A } }), expected: 20, comparison: "gte" },
    { label: "request items", actual: await prisma.purchaseRequestItem.count(), expected: 24, comparison: "gte" },
    { label: "RFQs", actual: await prisma.rFQ.count({ where: { companyId: COMPANY_A } }), expected: 10, comparison: "gte" },
    { label: "supplier quotes", actual: await prisma.supplierQuote.count({ where: { companyId: COMPANY_A } }), expected: 24, comparison: "gte" },
    { label: "purchase orders", actual: await prisma.purchaseOrder.count({ where: { companyId: COMPANY_A } }), expected: 16, comparison: "gte" },
    { label: "goods receipts", actual: await prisma.goodsReceipt.count({ where: { companyId: COMPANY_A } }), expected: 18, comparison: "gte" },
    { label: "procurement approvals", actual: await prisma.procurementApproval.count({ where: { companyId: COMPANY_A } }), expected: 11, comparison: "gte" },
    { label: "fixture tenant suppliers", actual: await prisma.supplier.count({ where: { companyId: FIXTURE_TENANT } }), expected: 1, comparison: "gte" },
    { label: "inventory items", actual: await prisma.inventoryItem.count({ where: { companyId: COMPANY_A } }), expected: 18, comparison: "gte" },
    { label: "warehouses", actual: await prisma.warehouse.count({ where: { companyId: COMPANY_A } }), expected: 5, comparison: "gte" },
    { label: "inventory locations", actual: await prisma.inventoryLocation.count({ where: { companyId: COMPANY_A } }), expected: 8, comparison: "gte" },
    { label: "stock movements", actual: await prisma.stockMovement.count({ where: { companyId: COMPANY_A } }), expected: 40, comparison: "gte" },
    { label: "stock balances", actual: await prisma.inventoryBalance.count({ where: { companyId: COMPANY_A } }), expected: 18, comparison: "gte" },
    { label: "stock reservations", actual: await prisma.stockReservation.count({ where: { companyId: COMPANY_A } }), expected: 5, comparison: "gte" },
    { label: "fixture tenant warehouses", actual: await prisma.warehouse.count({ where: { companyId: FIXTURE_TENANT } }), expected: 1, comparison: "gte" },
    { label: "inspection templates", actual: await prisma.inspectionTemplate.count({ where: { companyId: COMPANY_A } }), expected: 4, comparison: "gte" },
    { label: "inspection requests", actual: await prisma.inspectionRequest.count({ where: { companyId: COMPANY_A } }), expected: 6, comparison: "gte" },
    { label: "quality inspections", actual: await prisma.qualityInspection.count({ where: { companyId: COMPANY_A } }), expected: 9, comparison: "gte" },
    { label: "checklist items", actual: await prisma.inspectionChecklistItem.count(), expected: 40, comparison: "gte" },
    { label: "quality defects", actual: await prisma.qualityDefect.count({ where: { companyId: COMPANY_A } }), expected: 5, comparison: "gte" },
    { label: "non-conformance reports", actual: await prisma.nonConformanceReport.count({ where: { companyId: COMPANY_A } }), expected: 4, comparison: "gte" },
    { label: "corrective actions", actual: await prisma.correctiveAction.count({ where: { companyId: COMPANY_A } }), expected: 6, comparison: "gte" },
    // HSE (PRD #22 §374).
    { label: "HSE checklists", actual: await prisma.hseInspectionTemplate.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "HSE inspections", actual: await prisma.hseInspection.count({ where: { companyId: COMPANY_A } }), expected: 30, comparison: "gte" },
    { label: "HSE checklist items", actual: await prisma.hseInspectionChecklistItem.count(), expected: 100, comparison: "gte" },
    { label: "hazards", actual: await prisma.hseHazard.count({ where: { companyId: COMPANY_A } }), expected: 35, comparison: "gte" },
    { label: "critical hazards", actual: await prisma.hseHazard.count({ where: { companyId: COMPANY_A, riskLevel: "CRITICAL" } }), expected: 1, comparison: "gte" },
    { label: "incidents", actual: await prisma.hseIncident.count({ where: { companyId: COMPANY_A, incidentType: { not: "NEAR_MISS" } } }), expected: 18, comparison: "gte" },
    { label: "near misses", actual: await prisma.hseIncident.count({ where: { companyId: COMPANY_A, incidentType: "NEAR_MISS" } }), expected: 12, comparison: "gte" },
    { label: "risk assessments", actual: await prisma.hseRiskAssessment.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "risk assessment lines", actual: await prisma.hseRiskAssessmentItem.count(), expected: 25, comparison: "gte" },
    { label: "HSE actions", actual: await prisma.hseAction.count({ where: { companyId: COMPANY_A } }), expected: 35, comparison: "gte" },
    { label: "toolbox talks", actual: await prisma.toolboxTalk.count({ where: { companyId: COMPANY_A } }), expected: 14, comparison: "gte" },
    { label: "toolbox participants", actual: await prisma.toolboxTalkParticipant.count(), expected: 50, comparison: "gte" },
    { label: "work permits", actual: await prisma.hseWorkPermit.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "PPE checks", actual: await prisma.ppeCheck.count({ where: { companyId: COMPANY_A } }), expected: 20, comparison: "gte" },
    { label: "environmental observations", actual: await prisma.environmentalObservation.count({ where: { companyId: COMPANY_A } }), expected: 14, comparison: "gte" },
    { label: "stop-work records", actual: await prisma.stopWorkRecord.count({ where: { companyId: COMPANY_A } }), expected: 5, comparison: "gte" },
    { label: "HSE approvals", actual: await prisma.hseApproval.count({ where: { companyId: COMPANY_A } }), expected: 12, comparison: "gte" },
    { label: "HSE documents", actual: await prisma.document.count({ where: { companyId: COMPANY_A, module: "hse" } }), expected: 25, comparison: "gte" },
    { label: "support requests", actual: await prisma.supportRequest.count({ where: { companyId: COMPANY_A } }), expected: 3, comparison: "gte" },
    { label: "fixture tenant contracts", actual: await prisma.contract.count({ where: { companyId: FIXTURE_TENANT } }), expected: 1, comparison: "gte" },
    { label: "fixture tenant projects", actual: await prisma.project.count({ where: { companyId: FIXTURE_TENANT } }), expected: 2, comparison: "gte" },
    { label: "fixture tenant clients", actual: await prisma.client.count({ where: { companyId: FIXTURE_TENANT } }), expected: 3, comparison: "gte" },
    { label: "fixture tenant tasks", actual: await prisma.task.count({ where: { companyId: FIXTURE_TENANT } }), expected: 6, comparison: "gte" },
    { label: "fixture tenant documents", actual: await prisma.document.count({ where: { companyId: FIXTURE_TENANT } }), expected: 4, comparison: "gte" },
    { label: "fixture tenant disabled modules", actual: await prisma.companyModule.count({ where: { companyId: FIXTURE_TENANT, enabled: false } }), expected: 1, comparison: "gte" },
    // E-06 §46: every module on in every demo company.
    { label: "disabled modules in demo companies", actual: await prisma.companyModule.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, enabled: false } }), expected: 0, comparison: "eq" },
    // Every membership and invitation state the Team module renders
    // (PRD #14 §304–§306), in the fixtures rather than the demo (E-06 §45).
    { label: "fixture invited members", actual: await prisma.companyMember.count({ where: { companyId: FIXTURE_WORKS, status: "INVITED" } }), expected: 1, comparison: "gte" },
    { label: "fixture inactive members", actual: await prisma.companyMember.count({ where: { companyId: FIXTURE_WORKS, status: "INACTIVE" } }), expected: 1, comparison: "gte" },
    { label: "fixture suspended members", actual: await prisma.companyMember.count({ where: { companyId: FIXTURE_WORKS, status: "SUSPENDED" } }), expected: 1, comparison: "gte" },
    { label: "fixture pending invitations", actual: await prisma.companyInvite.count({ where: { companyId: FIXTURE_WORKS, status: "PENDING", expiresAt: { gt: new Date() } } }), expected: 2, comparison: "gte" },
    { label: "fixture expired invitations", actual: await prisma.companyInvite.count({ where: { companyId: FIXTURE_WORKS, status: "PENDING", expiresAt: { lt: new Date() } } }), expected: 1, comparison: "gte" },
    { label: "fixture cancelled invitations", actual: await prisma.companyInvite.count({ where: { companyId: FIXTURE_WORKS, status: "CANCELLED" } }), expected: 1, comparison: "gte" },
    { label: "fixture accepted invitations", actual: await prisma.companyInvite.count({ where: { companyId: FIXTURE_WORKS, status: "ACCEPTED" } }), expected: 1, comparison: "gte" },
    { label: "invitations in demo companies", actual: await prisma.companyInvite.count({ where: { companyId: { in: DEMO_COMPANY_IDS } } }), expected: 0, comparison: "eq" },
    { label: "non-active demo memberships", actual: await prisma.companyMember.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, status: { not: "ACTIVE" } } }), expected: 0, comparison: "eq" },
    // PRD #46 §308-§313: contractors on the demo project, a revised drawing, open RFIs and a submittal in review.
    { label: "Company A active contractors", actual: await prisma.contractorProfile.count({ where: { companyId: COMPANY_A, status: "ACTIVE" } }), expected: 2, comparison: "gte" },
    { label: "Company A work packages", actual: await prisma.workPackage.count({ where: { companyId: COMPANY_A } }), expected: 3, comparison: "gte" },
    { label: "Company A drawing revisions", actual: await prisma.engineeringDocumentRevision.count({ where: { companyId: COMPANY_A, engineeringDocumentId: "engdoc_arc_sd_023" } }), expected: 3, comparison: "gte" },
    { label: "Company A open RFIs", actual: await prisma.rfi.count({ where: { companyId: COMPANY_A, status: { in: ["OPEN", "ANSWERED", "CLARIFICATION_REQUIRED"] } } }), expected: 2, comparison: "gte" },
    { label: "Company A submittals in review", actual: await prisma.technicalSubmittal.count({ where: { companyId: COMPANY_A, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }), expected: 1, comparison: "gte" },
    // PRD #45 §348: company, project and scheduled announcements, one asking for acknowledgment.
    { label: "Company A published announcements", actual: await prisma.announcement.count({ where: { companyId: COMPANY_A, status: "PUBLISHED" } }), expected: 3, comparison: "gte" },
    { label: "Company A scheduled announcements", actual: await prisma.announcement.count({ where: { companyId: COMPANY_A, status: "SCHEDULED" } }), expected: 1, comparison: "gte" },
    { label: "Company A acknowledgment targets", actual: await prisma.announcementTarget.count({ where: { announcement: { companyId: COMPANY_A } } }), expected: 5, comparison: "gte" },
    // PRD #44 §311: a plan on the demo project, with dependencies and a critical blocker.
    { label: "Company A project phases", actual: await prisma.projectPhase.count({ where: { companyId: COMPANY_A, archivedAt: null } }), expected: 6, comparison: "gte" },
    { label: "Company A milestones", actual: await prisma.projectMilestone.count({ where: { companyId: COMPANY_A, archivedAt: null } }), expected: 11, comparison: "gte" },
    { label: "Company A milestone dependencies", actual: await prisma.projectMilestoneDependency.count({ where: { companyId: COMPANY_A } }), expected: 5, comparison: "gte" },
    // PRD #43 §251: daily logs on the demo project, one of them locked.
    { label: "Company A daily logs", actual: await prisma.dailyLog.count({ where: { companyId: COMPANY_A } }), expected: 3, comparison: "gte" },
    { label: "Company A locked daily logs", actual: await prisma.dailyLog.count({ where: { companyId: COMPANY_A, status: "LOCKED" } }), expected: 1, comparison: "gte" },
    // PRD #42 §245: an approved, a submitted and a returned week.
    { label: "Company A approved timesheets", actual: await prisma.timesheet.count({ where: { companyId: COMPANY_A, status: "APPROVED" } }), expected: 1, comparison: "gte" },
    { label: "Company A submitted timesheets", actual: await prisma.timesheet.count({ where: { companyId: COMPANY_A, status: "SUBMITTED" } }), expected: 1, comparison: "gte" },
    { label: "Company A returned timesheets", actual: await prisma.timesheet.count({ where: { companyId: COMPANY_A, status: "RETURNED" } }), expected: 1, comparison: "gte" },
    { label: "demo branches with a manager", actual: await prisma.department.count({ where: { companyId: { in: DEMO_COMPANY_IDS }, managerMemberId: { not: null } } }), expected: POSITIONS.filter((position) => position.level === "COMPANY_MANAGER").length, comparison: "eq" },
    // E-05D §104: a published unit, one waiting for review and one sent back, each with a Sales Plan.
    { label: "Company A published units", actual: await prisma.projectUnit.count({ where: { companyId: COMPANY_A, publicationStatus: "PUBLISHED", currentPublicationId: { not: null } } }), expected: 2, comparison: "gte" },
    { label: "Company A unit publishing requests waiting", actual: await prisma.unitPublicationApproval.count({ where: { companyId: COMPANY_A, status: "PENDING" } }), expected: 2, comparison: "gte" },
    { label: "Company A units sent back for revision", actual: await prisma.projectUnit.count({ where: { companyId: COMPANY_A, publicationStatus: "REVISION_REQUIRED", revisionReason: { not: null } } }), expected: 1, comparison: "gte" },
    { label: "Company A unit Sales Plans", actual: await prisma.projectUnit.count({ where: { companyId: COMPANY_A, salesPlanDocumentId: { not: null } } }), expected: 5, comparison: "gte" },
    // E-05E: a unit in each commercial state, a deal holding two units, and one reservation in Company B.
    { label: "Company A units for sale", actual: await prisma.unitCommercialProfile.count({ where: { companyId: COMPANY_A, status: "FOR_SALE" } }), expected: 1, comparison: "gte" },
    { label: "Company A units on hold", actual: await prisma.unitCommercialProfile.count({ where: { companyId: COMPANY_A, status: "ON_HOLD", holdReason: { not: null } } }), expected: 1, comparison: "gte" },
    { label: "Company A reserved units", actual: await prisma.unitCommercialProfile.count({ where: { companyId: COMPANY_A, status: "RESERVED" } }), expected: 2, comparison: "gte" },
    { label: "Company A sold units", actual: await prisma.unitCommercialProfile.count({ where: { companyId: COMPANY_A, status: "SOLD" } }), expected: 1, comparison: "gte" },
    { label: "Reserved units without exactly one active reservation", actual: await prisma.unitCommercialProfile.count({ where: { status: "RESERVED", unit: { reservations: { none: { status: "ACTIVE" } } } } }), expected: 0, comparison: "eq" },
    { label: "Company A deals holding more than one unit", actual: (await prisma.opportunityUnit.groupBy({ by: ["opportunityId"], where: { companyId: COMPANY_A }, _count: { _all: true } })).filter((row) => row._count._all > 1).length, expected: 1, comparison: "gte" },
    { label: "fixture tenant active unit reservations", actual: await prisma.unitReservation.count({ where: { companyId: FIXTURE_TENANT, status: "ACTIVE" } }), expected: 1, comparison: "gte" },
    // E-05F: a live sale contract with an active schedule, money allocated to it, a request in Legal's queue, and Company B's side.
    { label: "Company A live sale contracts", actual: await prisma.contractUnit.count({ where: { companyId: COMPANY_A, releasedAt: null, contract: { contractType: "SALE_AGREEMENT", status: { in: ["SIGNED", "ACTIVE"] } } } }), expected: 1, comparison: "gte" },
    { label: "Company A active payment schedules", actual: await prisma.paymentSchedule.count({ where: { companyId: COMPANY_A, status: "ACTIVE" } }), expected: 1, comparison: "gte" },
    { label: "Company A installment allocations", actual: await prisma.paymentAllocation.count({ where: { companyId: COMPANY_A, installmentId: { not: null } } }), expected: 2, comparison: "gte" },
    { label: "Company A open contract requests", actual: await prisma.unitContractRequest.count({ where: { companyId: COMPANY_A, status: "OPEN" } }), expected: 1, comparison: "gte" },
    { label: "fixture tenant sale contracts with a schedule", actual: await prisma.paymentSchedule.count({ where: { companyId: FIXTURE_TENANT, contract: { contractType: "SALE_AGREEMENT" } } }), expected: 1, comparison: "gte" },
    { label: "Payments settling nothing", actual: await prisma.payment.count({ where: { contractId: null, allocations: { none: {} } } }), expected: 0, comparison: "eq" },
    { label: "Units with more than one live contract", actual: (await prisma.contractUnit.groupBy({ by: ["unitId"], where: { releasedAt: null }, _count: { _all: true } })).filter((row) => row._count._all > 1).length, expected: 0, comparison: "eq" },
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
    "pm@nesto.test": [PROJECT_IDS.a],
    "architect@nesto.test": [PROJECT_IDS.a],
    "engineer@nesto.test": [PROJECT_IDS.a],
    "qaqc@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.c],
    "hse@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.b],
    "viewer@nesto.test": [PROJECT_IDS.a],
    "multicompany@nesto.test": [PROJECT_IDS.a, PROJECT_IDS.d],
    "pm-b@nesto.test": [PROJECT_IDS.b],
    "pm-c@nesto.test": [PROJECT_IDS.c],
    "pm-d@nesto.test": [PROJECT_IDS.d],
    "pm-e@nesto.test": [PROJECT_IDS.e],
    "architecture-manager-b@nesto.test": [PROJECT_IDS.b],
  };

  for (const [email, projects] of Object.entries(expectedMembership)) {
    const rows = await prisma.projectMember.findMany({
      where: { status: "ACTIVE", member: { user: { email } } },
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

  await validateOrganization(prisma, problems);

  // Cross-company relations must never exist in normal demo data (PRD #9
  // §115). Every table that names both a company and a project is checked:
  // nothing may sit in one company on another company's project (E-06 §105).
  const projectTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT c1.table_name FROM information_schema.columns c1
    JOIN information_schema.columns c2 ON c2.table_schema = c1.table_schema AND c2.table_name = c1.table_name AND c2.column_name = 'projectId'
    JOIN information_schema.tables t ON t.table_schema = c1.table_schema AND t.table_name = c1.table_name AND t.table_type = 'BASE TABLE'
    WHERE c1.table_schema = current_schema() AND c1.column_name = 'companyId' AND c1.table_name <> 'projects'`;
  for (const { table_name: table } of projectTables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "${table}" r JOIN "projects" p ON p."id" = r."projectId" WHERE p."companyId" <> r."companyId"`,
    );
    if (row && row.count > BigInt(0)) {
      problems.push(`${row.count} ${table} row(s) sit in one company on another company's project`);
    }
  }
  // The same for a record naming a client or a deal: it is that company's (E-06 §105).
  for (const [column, parent] of [["clientId", "clients"], ["opportunityId", "opportunities"]] as const) {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT c1.table_name FROM information_schema.columns c1
      JOIN information_schema.columns c2 ON c2.table_schema = c1.table_schema AND c2.table_name = c1.table_name AND c2.column_name = ${column}
      JOIN information_schema.tables t ON t.table_schema = c1.table_schema AND t.table_name = c1.table_name AND t.table_type = 'BASE TABLE'
      WHERE c1.table_schema = current_schema() AND c1.column_name = 'companyId' AND c1.table_name <> ${parent}`;
    for (const { table_name: table } of tables) {
      const [row] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "${table}" r JOIN "${parent}" p ON p."id" = r."${column}" WHERE p."companyId" <> r."companyId"`,
      );
      if (row && row.count > BigInt(0)) {
        problems.push(`${row.count} ${table} row(s) sit in one company and name another company's ${parent === "clients" ? "client" : "deal"}`);
      }
    }
  }

  // A won deal becomes its own client's project (PRD #17 §311). A unit's buyer
  // is not the project's client, so this is not asked of sales records.
  const convertedElsewhere = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "opportunities" o JOIN "projects" p ON p."id" = o."convertedProjectId"
    WHERE o."clientId" IS NOT NULL AND p."clientId" IS NOT NULL AND o."clientId" <> p."clientId"`;
  if ((convertedElsewhere[0]?.count ?? BigInt(0)) > BigInt(0)) {
    problems.push(`${convertedElsewhere[0]!.count} won deal(s) converted into another client's project`);
  }

  const crossCompanyClients = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "projects" p JOIN "clients" c ON c."id" = p."clientId" WHERE c."companyId" <> p."companyId"`;
  if ((crossCompanyClients[0]?.count ?? BigInt(0)) > BigInt(0)) {
    problems.push(`${crossCompanyClients[0]!.count} project(s) reference a client from another company`);
  }

  /*
   * Storage invariants (PRD #29 §17, §128, §233).
   *
   * A Document references one stored object. A demo dataset full of rows with
   * no bytes behind them would make every storage guarantee untestable, so
   * these are checked rather than assumed.
   */
  const documentsWithoutObjects = await prisma.document.count({ where: { storageKey: null } });
  if (documentsWithoutObjects > 0) {
    problems.push(`${documentsWithoutObjects} document(s) have no storage key`);
  }

  const unverifiedDocuments = await prisma.document.count({
    where: { storageStatus: { notIn: ["AVAILABLE", "ARCHIVED"] } },
  });
  if (unverifiedDocuments > 0) {
    problems.push(`${unverifiedDocuments} document(s) are not in a verified storage state`);
  }

  // Every company gets a quota row, so the ceiling is a stated policy rather
  // than an implicit default (PRD #29 §145).
  const companies = await prisma.company.count();
  const quotas = await prisma.companyStorageQuota.count();
  if (quotas < companies) {
    problems.push(`${companies - quotas} company(s) have no storage quota row`);
  }

  // The usage projection must agree with the documents it projects
  // (PRD #29 §148, PRD #35 §238).
  const usageRows = await prisma.companyStorageUsage.findMany();
  for (const usage of usageRows) {
    const actual = await prisma.document.aggregate({
      where: { companyId: usage.companyId, storageKey: { not: null }, storageStatus: { not: "REJECTED" } },
      _sum: { sizeBytes: true },
      _count: true,
    });
    if ((actual._sum.sizeBytes ?? BigInt(0)) !== usage.usedBytes || actual._count !== usage.fileCount) {
      problems.push(
        `storage usage for ${usage.companyId} does not reconcile: projection ${usage.fileCount} files, documents ${actual._count}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`Seed validation failed:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * The organization the demo stands on (E-06 §132, §134, §135): the group's
 * people and positions, the Platform Admin outside it, each company's project
 * run by its own project manager, and one person behind every account.
 */
async function validateOrganization(prisma: PrismaClient, problems: string[]) {
  for (const code of Object.keys(DEMO_PROJECTS) as Array<keyof typeof DEMO_PROJECTS>) {
    const project = DEMO_PROJECTS[code];
    const count = await prisma.project.count({ where: { companyId: project.companyId, archivedAt: null } });
    if (count !== 1) problems.push(`${project.companyId}: expected exactly one visible project, found ${count}`);

    const row = await prisma.project.findUnique({
      where: { id: project.id },
      select: { companyId: true, projectManagerMemberId: true, projectManager: { select: { companyId: true, user: { select: { username: true } } } }, members: { where: { status: "ACTIVE" }, select: { companyMemberId: true } } },
    });
    const pm = COMPANY_USERS.find((user) => user.role === "PROJECT_MANAGER" && user.companies[0] === project.companyId);
    if (!row || row.companyId !== project.companyId) problems.push(`${project.id} is not in ${project.companyId}`);
    else if (row.projectManager?.user.username !== pm?.username || row.projectManager?.companyId !== project.companyId) {
      problems.push(`${project.id}: project manager should be ${pm?.username}, found ${row.projectManager?.user.username ?? "nobody"}`);
    } else if (!row.members.some((member) => member.companyMemberId === row.projectManagerMemberId)) {
      problems.push(`${project.id}: the project manager is not on the project team`);
    }
  }

  for (const user of PLATFORM_USERS) {
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { platformAccess: { select: { status: true } }, _count: { select: { memberships: true } }, personProfileId: true } });
    if (account?.platformAccess?.status !== "ACTIVE") problems.push(`${user.username} has no active platform access`);
    if (account && account._count.memberships > 0) problems.push(`${user.username} is a company member; the Platform Admin must not be`);
    if (account?.personProfileId) problems.push(`${user.username} has a person record in a group`);
  }

  for (const user of GROUP_USERS) {
    const member = await prisma.parentGroupMember.findUnique({ where: { parentGroupId_userId: { parentGroupId: DEMO_GROUP.id, userId: user.id } }, select: { status: true } });
    if (member?.status !== "ACTIVE") problems.push(`${user.username} is not an active member of the demo group`);
    const memberships = await prisma.companyMember.count({ where: { userId: user.id, companyId: { in: DEMO_COMPANY_IDS }, status: "ACTIVE" } });
    if (memberships !== DEMO_COMPANY_IDS.length) problems.push(`${user.username}: expected a membership in all five companies, found ${memberships}`);
  }

  for (const position of POSITIONS) {
    const found = await prisma.departmentAssignment.count({
      where: {
        userId: position.userId,
        parentGroupId: DEMO_GROUP.id,
        positionLevel: position.level,
        companyId: position.companyId,
        groupDepartment: { key: position.department },
        status: "ACTIVE",
        ...(position.companyId ? { companyDepartmentId: { not: null } } : { companyDepartmentId: null }),
      },
    });
    if (found !== 1) problems.push(`${position.userId}: expected one ${position.level} assignment in ${position.department} (${position.companyId ?? "group"}), found ${found}`);
  }

  const stacked = await prisma.departmentAssignment.groupBy({ by: ["userId"], where: { parentGroupId: DEMO_GROUP.id, status: "ACTIVE", positionLevel: { in: ["GROUP_HEAD", "COMPANY_MANAGER"] } }, _count: { _all: true } });
  if (!stacked.some((row) => row._count._all > 1)) problems.push("no user holds a group head and a company manager position at once");

  // E-13, ADR 0003: a membership's department is a place on that department's team,
  // there is one head per department and one manager per branch, and every department has its code.
  const homesWithoutPlace = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "company_members" m
    JOIN "departments" d ON d."id" = m."departmentId" AND d."groupDepartmentId" IS NOT NULL
    WHERE m."status" = 'ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM "department_assignments" a
      WHERE a."userId" = m."userId" AND a."companyDepartmentId" = d."id" AND a."positionLevel" = 'MEMBER' AND a."status" = 'ACTIVE'
    )`;
  if (Number(homesWithoutPlace[0]?.count ?? 0) > 0) problems.push(`${homesWithoutPlace[0]!.count} membership(s) placed in a department with no place on its team`);
  const coverage = await prisma.departmentAssignment.groupBy({ by: ["userId", "groupDepartmentId"], where: { parentGroupId: DEMO_GROUP.id, status: "ACTIVE", positionLevel: "MEMBER" }, _count: { _all: true } });
  if (!coverage.some((row) => row._count._all > 1)) problems.push("nobody covers one department in more than one company");

  const multiCompany = await prisma.companyMember.groupBy({ by: ["userId"], where: { companyId: { in: DEMO_COMPANY_IDS }, status: "ACTIVE", userId: { in: COMPANY_USERS.map((user) => user.id) } }, _count: { _all: true } });
  if (!multiCompany.some((row) => row._count._all > 1)) problems.push("no company user works in more than one company");

  // E-06 §26, §83, §135: one person behind each account and each employment.
  const accountsWithoutPerson = await prisma.user.count({ where: { id: { in: [...GROUP_USERS, ...COMPANY_USERS].map((user) => user.id) }, personProfileId: null } });
  if (accountsWithoutPerson > 0) problems.push(`${accountsWithoutPerson} demo account(s) have no person record`);

  const splitIdentity = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "employee_profiles" e
    JOIN "company_members" m ON m."id" = e."companyMemberId"
    JOIN "users" u ON u."id" = m."userId"
    WHERE u."personProfileId" IS DISTINCT FROM e."personProfileId"`;
  if ((splitIdentity[0]?.count ?? BigInt(0)) > BigInt(0)) problems.push(`${splitIdentity[0]!.count} employment record(s) belong to a different person than their account`);

  const duplicatePeople = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM (
      SELECT "parentGroupId", lower("workEmail") FROM "person_profiles" WHERE "workEmail" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1
    ) duplicates`;
  if ((duplicatePeople[0]?.count ?? BigInt(0)) > BigInt(0)) problems.push(`${duplicatePeople[0]!.count} work email(s) belong to more than one person in a group`);

  // E-06 §135: the recruitment lifecycle, from a candidate with no login to a login with the same person behind it.
  const interviewing = await prisma.candidateProfile.count({ where: { parentGroupId: DEMO_GROUP.id, status: "INTERVIEWING", person: { user: null } } });
  if (interviewing === 0) problems.push("no interviewing candidate without a user account");
  const selected = await prisma.candidateProfile.count({ where: { parentGroupId: DEMO_GROUP.id, status: "SELECTED", person: { user: null } } });
  if (selected === 0) problems.push("no selected candidate without a user account");
  const approved = await prisma.userProvisioningRequest.count({ where: { parentGroupId: DEMO_GROUP.id, status: "APPROVED", provisionedUserId: null } });
  if (approved === 0) problems.push("no approved account request waiting for Group IT");
  const provisioned = await prisma.userProvisioningRequest.findMany({
    where: { parentGroupId: DEMO_GROUP.id, status: "PROVISIONED" },
    select: { id: true, personProfileId: true, provisionedUser: { select: { personProfileId: true } } },
  });
  if (provisioned.length === 0) problems.push("no provisioned account request");
  for (const request of provisioned) {
    if (request.provisionedUser?.personProfileId !== request.personProfileId) problems.push(`${request.id}: the provisioned account belongs to a different person than the request`);
  }
}
