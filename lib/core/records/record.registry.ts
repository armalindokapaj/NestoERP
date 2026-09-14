import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import {
  buildAmendmentScopeWhere,
  buildContractScopeWhere,
  buildObligationScopeWhere,
} from "@/lib/modules/contracts/contract.scope";
import {
  buildBudgetScopeWhere,
  buildCommitmentScopeWhere,
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
} from "@/lib/modules/finance/finance.scope";
import { buildEmployeeScopeWhere, buildLeaveScopeWhere, isSelf } from "@/lib/modules/hr/hr.scope";
import {
  buildActionScopeWhere as buildHseActionScopeWhere,
  buildHazardScopeWhere,
  buildIncidentScopeWhere,
  buildInspectionScopeWhere as buildHseInspectionScopeWhere,
  buildObservationScopeWhere,
  buildPermitScopeWhere,
  buildRiskAssessmentScopeWhere,
  buildStopWorkScopeWhere,
  buildToolboxScopeWhere,
} from "@/lib/modules/hse/hse.scope";
import {
  buildAdjustmentScopeWhere,
  buildIssueScopeWhere,
  buildItemScopeWhere,
  buildReceiptScopeWhere as buildInventoryReceiptScopeWhere,
  buildWarehouseScopeWhere,
} from "@/lib/modules/inventory/inventory.scope";
import {
  buildOrderScopeWhere,
  buildReceiptScopeWhere as buildGoodsReceiptScopeWhere,
  buildRequestScopeWhere as buildPurchaseRequestScopeWhere,
  buildRfqScopeWhere,
  buildSupplierWhere,
} from "@/lib/modules/procurement/procurement.scope";
import {
  buildCorrectiveActionScopeWhere,
  buildDefectScopeWhere,
  buildInspectionScopeWhere as buildQualityInspectionScopeWhere,
  buildNcrScopeWhere,
} from "@/lib/modules/qaqc/qaqc.scope";
import {
  buildLeadScopeWhere,
  buildOpportunityScopeWhere,
  buildProposalScopeWhere,
} from "@/lib/modules/sales/sales.scope";
import {
  RECORD_TYPES,
  isRecordType,
  type RecordDefinition,
  type RecordSummary,
  type RecordType,
} from "./record.types";

/**
 * The authoritative business-record registry (PRD #38 §28, §52).
 *
 * Every lookup reads the record through its own module's scope builder — the
 * same clause its list page and detail page use — plus an explicit company
 * constraint, so a record from another company, one outside the reader's scope
 * and one that does not exist are indistinguishable. Nothing here decides
 * access by itself; it asks the module that already decides.
 *
 * Adding a record type means adding one entry. The completeness test
 * (tests/unit/records/record-registry.test.ts) fails for a type with no
 * definition, no route, or a document tab that cannot be reached.
 */

function unique(...ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function numbered(number: string | null | undefined, title: string | null | undefined): string {
  if (number && title) return `${number} · ${title}`;
  return number || title || "Untitled";
}

function isArchived(row: { archivedAt?: Date | null; status?: unknown }): boolean {
  return Boolean(row.archivedAt) || String(row.status ?? "") === "ARCHIVED";
}

/** Module enabled for the company, reachable by the role, and every listed permission held. */
export function moduleAndPermissions(
  context: UserContext,
  moduleKey: ModuleKey,
  permissions: readonly Permission[],
): boolean {
  const access = context.moduleAccess[moduleKey];
  if (!access?.enabled || access.accessLevel === "NONE") return false;
  return permissions.every((permission) => can(context, permission));
}

const recordDocumentsTab = (summary: RecordSummary) => `${summary.href}/documents`;
const recordPage = (summary: RecordSummary) => summary.href;

const DEFINITIONS: RecordDefinition[] = [
  /* Work ------------------------------------------------------------------ */
  {
    type: "project",
    moduleKey: "projects",
    noun: "Project",
    activityEntityType: "Project",
    route: "/projects",
    viewPermissions: ["project.view"],
    async find(context, id) {
      const row = await prisma.project.findFirst({
        where: { AND: [buildProjectScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, code: true, name: true, status: true, archivedAt: true, projectManagerMemberId: true },
      });
      return row && {
        type: "project", id: row.id, companyId: row.companyId, label: numbered(row.code, row.name),
        href: `/projects/${row.id}`, projectId: row.id, archived: isArchived(row),
        stakeholderMemberIds: unique(row.projectManagerMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.project.findMany({
        where: { AND: [buildProjectScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: [], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "client",
    moduleKey: "clients",
    noun: "Client",
    activityEntityType: "Client",
    route: "/clients",
    viewPermissions: ["client.view"],
    async find(context, id) {
      const row = await prisma.client.findFirst({
        where: { AND: [buildClientScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, name: true, status: true, archivedAt: true },
      });
      return row && {
        type: "client", id: row.id, companyId: row.companyId, label: row.name, href: `/clients/${row.id}`,
        projectId: null, archived: isArchived(row), stakeholderMemberIds: [],
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.client.findMany({
        where: { AND: [buildClientScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: [], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "task",
    moduleKey: "tasks",
    noun: "Task",
    activityEntityType: "Task",
    route: "/tasks",
    viewPermissions: ["task.view"],
    async find(context, id) {
      const row = await prisma.task.findFirst({
        where: { AND: [buildTaskScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, title: true, projectId: true, status: true, archivedAt: true, assigneeMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "task", id: row.id, companyId: row.companyId, label: row.title, href: `/tasks/${row.id}`,
        projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.assigneeMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.task.findMany({
        where: { AND: [buildTaskScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: [], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "document",
    moduleKey: "documents",
    noun: "Document",
    activityEntityType: "Document",
    route: "/documents",
    viewPermissions: ["document.view"],
    async find(context, id) {
      // Documents decide their own readability through their parent; loaded
      // lazily because that decision itself reads this registry.
      const { findReadableDocument } = await import("@/lib/modules/documents/document.parent-access");
      const row = await findReadableDocument(context, id);
      return row && {
        type: "document", id: row.id, companyId: row.companyId, label: row.name, href: `/documents/${row.id}`,
        projectId: row.projectId, archived: row.status === "ARCHIVED",
        stakeholderMemberIds: unique(row.uploadedByMemberId),
      };
    },
    async reachable(context, ids) {
      const { findReadableDocument } = await import("@/lib/modules/documents/document.parent-access");
      const found = await Promise.all(ids.map((id) => findReadableDocument(context, id)));
      return found.filter((row) => row !== null).map((row) => row.id);
    },
    documents: null,
    collaboration: { requires: [] },
  },

  /* Finance --------------------------------------------------------------- */
  {
    type: "invoice",
    moduleKey: "finance",
    noun: "Invoice",
    activityEntityType: "Invoice",
    route: "/finance/invoices",
    viewPermissions: ["finance.invoice.view"],
    async find(context, id) {
      const row = await prisma.invoice.findFirst({
        where: { AND: [buildInvoiceScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, invoiceNumber: true, projectId: true, status: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "invoice", id: row.id, companyId: row.companyId, label: `Invoice ${row.invoiceNumber}`,
        href: `/finance/invoices/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.invoice.findMany({
        where: { AND: [buildInvoiceScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["finance.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "expense",
    moduleKey: "finance",
    noun: "Expense",
    activityEntityType: "Expense",
    route: "/finance/expenses",
    viewPermissions: ["finance.expense.view"],
    async find(context, id) {
      const row = await prisma.expense.findFirst({
        where: { AND: [buildExpenseScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, expenseNumber: true, projectId: true, status: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "expense", id: row.id, companyId: row.companyId, label: `Expense ${row.expenseNumber ?? "draft"}`,
        href: `/finance/expenses/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.expense.findMany({
        where: { AND: [buildExpenseScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["finance.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "budget",
    moduleKey: "finance",
    noun: "Budget",
    activityEntityType: "ProjectBudget",
    route: "/finance/budgets",
    viewPermissions: ["finance.budget.view"],
    async find(context, id) {
      const row = await prisma.projectBudget.findFirst({
        where: { AND: [buildBudgetScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, name: true, projectId: true, status: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "budget", id: row.id, companyId: row.companyId, label: row.name ?? "Project budget", href: `/finance/budgets/${row.id}`,
        projectId: row.projectId, archived: isArchived(row), stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.projectBudget.findMany({
        where: { AND: [buildBudgetScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["finance.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "commitment",
    moduleKey: "finance",
    noun: "Commitment",
    activityEntityType: "Commitment",
    route: "/finance/commitments",
    viewPermissions: ["finance.commitment.view"],
    async find(context, id) {
      const row = await prisma.commitment.findFirst({
        where: { AND: [buildCommitmentScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, reference: true, projectId: true, status: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "commitment", id: row.id, companyId: row.companyId, label: `Commitment ${row.reference ?? ""}`.trim(),
        href: `/finance/commitments/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.commitment.findMany({
        where: { AND: [buildCommitmentScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["finance.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },

  /* HR -------------------------------------------------------------------- */
  {
    // Addressed by membership id, the way every HR route is.
    type: "employee",
    moduleKey: "hr",
    noun: "Employee record",
    activityEntityType: "EmployeeProfile",
    route: "/hr/employees",
    viewPermissions: ["hr.employee.view"],
    async find(context, id) {
      const row = await prisma.employeeProfile.findFirst({
        where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: id, companyId: context.companyId }] },
        select: {
          companyMemberId: true,
          companyId: true,
          managerMemberId: true,
          companyMember: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });
      return row && {
        type: "employee", id: row.companyMemberId, companyId: row.companyId,
        label: `${row.companyMember.user.firstName} ${row.companyMember.user.lastName}`,
        href: `/hr/employees/${row.companyMemberId}`, projectId: null, archived: false,
        stakeholderMemberIds: [],
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.employeeProfile.findMany({
        where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: { in: ids }, companyId: context.companyId }] },
        select: { companyMemberId: true },
      });
      return rows.map((row) => row.companyMemberId);
    },
    documents: {
      view: ["hr.document.view"],
      upload: ["hr.document.create"],
      tabHref: recordDocumentsTab,
      self: { permission: "hr.self.documents", isSelf },
      reviewable: false,
    },
    // An HR discussion about somebody is more confidential than their record:
    // only those who manage employee records take part, never the employee
    // through self-service (PRD #38 §28 "where confidentiality permits").
    collaboration: { requires: ["hr.employee.update"] },
  },
  {
    type: "leave_request",
    moduleKey: "hr",
    noun: "Leave request",
    activityEntityType: "LeaveRequest",
    route: "/hr/leave",
    viewPermissions: ["hr.leave.view"],
    async find(context, id) {
      const row = await prisma.leaveRequest.findFirst({
        where: { AND: [buildLeaveScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, status: true, companyMemberId: true },
      });
      return row && {
        type: "leave_request", id: row.id, companyId: row.companyId, label: "Leave request",
        href: `/hr/leave/${row.id}`, projectId: null, archived: false, stakeholderMemberIds: unique(row.companyMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.leaveRequest.findMany({
        where: { AND: [buildLeaveScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hr.document.view"], upload: ["hr.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: null,
  },

  /* Sales ----------------------------------------------------------------- */
  {
    type: "lead",
    moduleKey: "sales",
    noun: "Lead",
    activityEntityType: "Lead",
    route: "/sales/leads",
    viewPermissions: ["sales.lead.view"],
    async find(context, id) {
      const row = await prisma.lead.findFirst({
        where: { AND: [buildLeadScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, name: true, status: true, archivedAt: true, ownerMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "lead", id: row.id, companyId: row.companyId, label: row.name, href: `/sales/leads/${row.id}`,
        projectId: null, archived: isArchived(row), stakeholderMemberIds: unique(row.ownerMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.lead.findMany({
        where: { AND: [buildLeadScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["sales.document.view"], upload: ["sales.document.create"], tabHref: recordPage, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "opportunity",
    moduleKey: "sales",
    noun: "Opportunity",
    activityEntityType: "Opportunity",
    route: "/sales/opportunities",
    viewPermissions: ["sales.opportunity.view"],
    async find(context, id) {
      const row = await prisma.opportunity.findFirst({
        where: { AND: [buildOpportunityScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, name: true, archivedAt: true, ownerMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "opportunity", id: row.id, companyId: row.companyId, label: row.name,
        href: `/sales/opportunities/${row.id}`, projectId: null, archived: isArchived(row),
        stakeholderMemberIds: unique(row.ownerMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.opportunity.findMany({
        where: { AND: [buildOpportunityScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["sales.document.view"], upload: ["sales.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "proposal",
    moduleKey: "sales",
    noun: "Proposal",
    activityEntityType: "Proposal",
    route: "/sales/proposals",
    viewPermissions: ["sales.proposal.view"],
    async find(context, id) {
      const row = await prisma.proposal.findFirst({
        where: { AND: [buildProposalScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, proposalNumber: true, title: true, status: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "proposal", id: row.id, companyId: row.companyId, label: numbered(row.proposalNumber, row.title),
        href: `/sales/proposals/${row.id}`, projectId: null, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.proposal.findMany({
        where: { AND: [buildProposalScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["sales.document.view"], upload: ["sales.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },

  /* Legal ----------------------------------------------------------------- */
  {
    type: "contract",
    moduleKey: "contracts",
    noun: "Contract",
    activityEntityType: "Contract",
    route: "/contracts",
    viewPermissions: ["legal.contract.view"],
    async find(context, id) {
      const row = await prisma.contract.findFirst({
        where: { AND: [buildContractScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, contractNumber: true, title: true, projectId: true, status: true, archivedAt: true, ownerMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "contract", id: row.id, companyId: row.companyId, label: numbered(row.contractNumber, row.title),
        href: `/contracts/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.ownerMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.contract.findMany({
        where: { AND: [buildContractScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["legal.document.view"], upload: ["legal.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "amendment",
    moduleKey: "contracts",
    noun: "Amendment",
    activityEntityType: "ContractAmendment",
    viewPermissions: ["legal.amendment.view"],
    async find(context, id) {
      const row = await prisma.contractAmendment.findFirst({
        where: { AND: [buildAmendmentScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, contractId: true, amendmentNumber: true, title: true, status: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "amendment", id: row.id, companyId: row.companyId, label: numbered(row.amendmentNumber, row.title),
        href: `/contracts/${row.contractId}/amendments/${row.id}`, projectId: null, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.contractAmendment.findMany({
        where: { AND: [buildAmendmentScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["legal.document.view"], upload: ["legal.document.create"], tabHref: recordPage, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "obligation",
    moduleKey: "contracts",
    noun: "Obligation",
    activityEntityType: "ContractObligation",
    viewPermissions: ["legal.obligation.view"],
    async find(context, id) {
      const row = await prisma.contractObligation.findFirst({
        where: { AND: [buildObligationScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, contractId: true, title: true, status: true, responsibleMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "obligation", id: row.id, companyId: row.companyId, label: row.title,
        href: `/contracts/${row.contractId}/obligations`, projectId: null, archived: isArchived(row),
        stakeholderMemberIds: unique(row.responsibleMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.contractObligation.findMany({
        where: { AND: [buildObligationScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["legal.document.view"], upload: ["legal.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },

  /* Procurement ----------------------------------------------------------- */
  {
    type: "purchase_request",
    moduleKey: "procurement",
    noun: "Purchase request",
    activityEntityType: "PurchaseRequest",
    route: "/procurement/requests",
    viewPermissions: ["procurement.request.view"],
    async find(context, id) {
      const row = await prisma.purchaseRequest.findFirst({
        where: { AND: [buildPurchaseRequestScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, requestNumber: true, title: true, projectId: true, status: true, archivedAt: true, requestedByMemberId: true, ownerMemberId: true },
      });
      return row && {
        type: "purchase_request", id: row.id, companyId: row.companyId, label: numbered(row.requestNumber, row.title),
        href: `/procurement/requests/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.requestedByMemberId, row.ownerMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.purchaseRequest.findMany({
        where: { AND: [buildPurchaseRequestScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["procurement.document.view"], upload: ["procurement.document.create"], tabHref: recordPage, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "rfq",
    moduleKey: "procurement",
    noun: "Request for quotation",
    activityEntityType: "RFQ",
    route: "/procurement/rfqs",
    viewPermissions: ["procurement.rfq.view"],
    async find(context, id) {
      const row = await prisma.rFQ.findFirst({
        where: { AND: [buildRfqScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, rfqNumber: true, title: true, projectId: true, status: true, createdByMemberId: true },
      });
      return row && {
        type: "rfq", id: row.id, companyId: row.companyId, label: numbered(row.rfqNumber, row.title),
        href: `/procurement/rfqs/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.rFQ.findMany({
        where: { AND: [buildRfqScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["procurement.document.view"], upload: ["procurement.document.create"], tabHref: recordPage, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "purchase_order",
    moduleKey: "procurement",
    noun: "Purchase order",
    activityEntityType: "PurchaseOrder",
    route: "/procurement/orders",
    viewPermissions: ["procurement.order.view"],
    async find(context, id) {
      const row = await prisma.purchaseOrder.findFirst({
        where: { AND: [buildOrderScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, poNumber: true, projectId: true, status: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "purchase_order", id: row.id, companyId: row.companyId, label: `Purchase order ${row.poNumber}`,
        href: `/procurement/orders/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.purchaseOrder.findMany({
        where: { AND: [buildOrderScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["procurement.document.view"], upload: ["procurement.document.create"], tabHref: recordPage, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "goods_receipt",
    moduleKey: "procurement",
    noun: "Goods receipt",
    activityEntityType: "GoodsReceipt",
    viewPermissions: ["procurement.receipt.view"],
    async find(context, id) {
      const row = await prisma.goodsReceipt.findFirst({
        where: { AND: [buildGoodsReceiptScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, receiptNumber: true, purchaseOrderId: true, projectId: true, status: true, receivedByMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "goods_receipt", id: row.id, companyId: row.companyId, label: `Goods receipt ${row.receiptNumber}`,
        href: `/procurement/orders/${row.purchaseOrderId}/receipts`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.receivedByMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.goodsReceipt.findMany({
        where: { AND: [buildGoodsReceiptScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["procurement.document.view"], upload: ["procurement.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "supplier",
    moduleKey: "procurement",
    noun: "Supplier",
    activityEntityType: "Supplier",
    route: "/procurement/suppliers",
    viewPermissions: ["procurement.supplier.view"],
    async find(context, id) {
      const row = await prisma.supplier.findFirst({
        where: { AND: [buildSupplierWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, name: true, status: true, archivedAt: true },
      });
      return row && {
        type: "supplier", id: row.id, companyId: row.companyId, label: row.name, href: `/procurement/suppliers/${row.id}`,
        projectId: null, archived: isArchived(row), stakeholderMemberIds: [],
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.supplier.findMany({
        where: { AND: [buildSupplierWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["procurement.document.view"], upload: ["procurement.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: null,
  },

  /* Inventory ------------------------------------------------------------- */
  {
    type: "inventory_item",
    moduleKey: "inventory",
    noun: "Inventory item",
    activityEntityType: "InventoryItem",
    route: "/inventory/items",
    viewPermissions: ["inventory.item.view"],
    async find(context, id) {
      const row = await prisma.inventoryItem.findFirst({
        where: { AND: [buildItemScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, sku: true, name: true, status: true, archivedAt: true },
      });
      return row && {
        type: "inventory_item", id: row.id, companyId: row.companyId, label: numbered(row.sku, row.name),
        href: `/inventory/items/${row.id}`, projectId: null, archived: isArchived(row), stakeholderMemberIds: [],
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.inventoryItem.findMany({
        where: { AND: [buildItemScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["inventory.document.view"], upload: ["inventory.document.create"], tabHref: recordDocumentsTab, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "warehouse",
    moduleKey: "inventory",
    noun: "Warehouse",
    activityEntityType: "Warehouse",
    route: "/inventory/warehouses",
    viewPermissions: ["inventory.warehouse.view"],
    async find(context, id) {
      const row = await prisma.warehouse.findFirst({
        where: { AND: [buildWarehouseScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, code: true, name: true, projectId: true, status: true, archivedAt: true },
      });
      return row && {
        type: "warehouse", id: row.id, companyId: row.companyId, label: numbered(row.code, row.name),
        href: `/inventory/warehouses/${row.id}`, projectId: row.projectId, archived: isArchived(row), stakeholderMemberIds: [],
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.warehouse.findMany({
        where: { AND: [buildWarehouseScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    // Files are read on warehouses filed before this registry existed, but no
    // page offers an upload for one (PRD #38 §54).
    documents: { view: ["inventory.document.view"], upload: null, tabHref: recordPage, reviewable: false },
    collaboration: null,
  },
  {
    type: "inventory_receipt",
    moduleKey: "inventory",
    noun: "Stock receipt",
    activityEntityType: "InventoryReceipt",
    route: "/inventory/receipts",
    viewPermissions: ["inventory.receipt.view"],
    async find(context, id) {
      const row = await prisma.inventoryReceipt.findFirst({
        where: { AND: [buildInventoryReceiptScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, receiptNumber: true, status: true, createdByMemberId: true },
      });
      return row && {
        type: "inventory_receipt", id: row.id, companyId: row.companyId, label: `Receipt ${row.receiptNumber}`,
        href: `/inventory/receipts/${row.id}`, projectId: null, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.inventoryReceipt.findMany({
        where: { AND: [buildInventoryReceiptScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["inventory.document.view"], upload: ["inventory.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "stock_issue",
    moduleKey: "inventory",
    noun: "Stock issue",
    activityEntityType: "StockIssue",
    route: "/inventory/issues",
    viewPermissions: ["inventory.issue.view"],
    async find(context, id) {
      const row = await prisma.stockIssue.findFirst({
        where: { AND: [buildIssueScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, issueNumber: true, projectId: true, status: true, requestedByMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "stock_issue", id: row.id, companyId: row.companyId, label: `Issue ${row.issueNumber}`,
        href: `/inventory/issues/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.requestedByMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.stockIssue.findMany({
        where: { AND: [buildIssueScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["inventory.document.view"], upload: ["inventory.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "stock_adjustment",
    moduleKey: "inventory",
    noun: "Stock adjustment",
    activityEntityType: "StockAdjustment",
    route: "/inventory/adjustments",
    viewPermissions: ["inventory.adjustment.view"],
    async find(context, id) {
      const row = await prisma.stockAdjustment.findFirst({
        where: { AND: [buildAdjustmentScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, adjustmentNumber: true, status: true, createdByMemberId: true },
      });
      return row && {
        type: "stock_adjustment", id: row.id, companyId: row.companyId, label: `Adjustment ${row.adjustmentNumber}`,
        href: `/inventory/adjustments/${row.id}`, projectId: null, archived: isArchived(row),
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.stockAdjustment.findMany({
        where: { AND: [buildAdjustmentScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["inventory.document.view"], upload: ["inventory.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },

  /* QA/QC ----------------------------------------------------------------- */
  {
    type: "quality_inspection",
    moduleKey: "qaqc",
    noun: "Inspection",
    activityEntityType: "QualityInspection",
    route: "/qaqc/inspections",
    viewPermissions: ["qaqc.inspection.view"],
    async find(context, id) {
      const row = await prisma.qualityInspection.findFirst({
        where: { AND: [buildQualityInspectionScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, inspectionNumber: true, projectId: true, status: true, assignedInspectorMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "quality_inspection", id: row.id, companyId: row.companyId, label: `Inspection ${row.inspectionNumber}`,
        href: `/qaqc/inspections/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.assignedInspectorMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.qualityInspection.findMany({
        where: { AND: [buildQualityInspectionScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["qaqc.document.view"], upload: ["qaqc.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "quality_defect",
    moduleKey: "qaqc",
    noun: "Defect",
    activityEntityType: "QualityDefect",
    route: "/qaqc/defects",
    viewPermissions: ["qaqc.defect.view"],
    async find(context, id) {
      const row = await prisma.qualityDefect.findFirst({
        where: { AND: [buildDefectScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, defectNumber: true, title: true, projectId: true, status: true, assignedToMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "quality_defect", id: row.id, companyId: row.companyId, label: numbered(row.defectNumber, row.title),
        href: `/qaqc/defects/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.assignedToMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.qualityDefect.findMany({
        where: { AND: [buildDefectScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["qaqc.document.view"], upload: ["qaqc.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "non_conformance_report",
    moduleKey: "qaqc",
    noun: "NCR",
    activityEntityType: "NonConformanceReport",
    route: "/qaqc/ncrs",
    viewPermissions: ["qaqc.ncr.view"],
    async find(context, id) {
      const row = await prisma.nonConformanceReport.findFirst({
        where: { AND: [buildNcrScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, ncrNumber: true, title: true, projectId: true, status: true, ownerMemberId: true, assignedToMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "non_conformance_report", id: row.id, companyId: row.companyId, label: numbered(row.ncrNumber, row.title),
        href: `/qaqc/ncrs/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.ownerMemberId, row.assignedToMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.nonConformanceReport.findMany({
        where: { AND: [buildNcrScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["qaqc.document.view"], upload: ["qaqc.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "corrective_action",
    moduleKey: "qaqc",
    noun: "Corrective action",
    activityEntityType: "CorrectiveAction",
    route: "/qaqc/corrective-actions",
    viewPermissions: ["qaqc.corrective_action.view"],
    async find(context, id) {
      const row = await prisma.correctiveAction.findFirst({
        where: { AND: [buildCorrectiveActionScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, actionNumber: true, title: true, projectId: true, status: true, assignedToMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "corrective_action", id: row.id, companyId: row.companyId, label: numbered(row.actionNumber, row.title),
        href: `/qaqc/corrective-actions/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.assignedToMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.correctiveAction.findMany({
        where: { AND: [buildCorrectiveActionScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["qaqc.document.view"], upload: ["qaqc.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },

  /* HSE ------------------------------------------------------------------- */
  {
    type: "hse_inspection",
    moduleKey: "hse",
    noun: "HSE inspection",
    activityEntityType: "HseInspection",
    route: "/hse/inspections",
    viewPermissions: ["hse.inspection.view"],
    async find(context, id) {
      const row = await prisma.hseInspection.findFirst({
        where: { AND: [buildHseInspectionScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, inspectionNumber: true, projectId: true, status: true, assignedInspectorMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "hse_inspection", id: row.id, companyId: row.companyId, label: `HSE inspection ${row.inspectionNumber}`,
        href: `/hse/inspections/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.assignedInspectorMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.hseInspection.findMany({
        where: { AND: [buildHseInspectionScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "hazard",
    moduleKey: "hse",
    noun: "Hazard",
    activityEntityType: "HseHazard",
    route: "/hse/hazards",
    viewPermissions: ["hse.hazard.view"],
    async find(context, id) {
      const row = await prisma.hseHazard.findFirst({
        where: { AND: [buildHazardScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, hazardNumber: true, title: true, projectId: true, status: true, reportedByMemberId: true, assignedToMemberId: true },
      });
      return row && {
        type: "hazard", id: row.id, companyId: row.companyId, label: numbered(row.hazardNumber, row.title),
        href: `/hse/hazards/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.reportedByMemberId, row.assignedToMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.hseHazard.findMany({
        where: { AND: [buildHazardScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordDocumentsTab, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "incident",
    moduleKey: "hse",
    noun: "Incident",
    activityEntityType: "HseIncident",
    route: "/hse/incidents",
    viewPermissions: ["hse.incident.view"],
    async find(context, id) {
      const row = await prisma.hseIncident.findFirst({
        where: { AND: [buildIncidentScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, incidentNumber: true, title: true, projectId: true, status: true, reportedByMemberId: true, investigatorMemberId: true },
      });
      return row && {
        type: "incident", id: row.id, companyId: row.companyId, label: numbered(row.incidentNumber, row.title),
        href: `/hse/incidents/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.reportedByMemberId, row.investigatorMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.hseIncident.findMany({
        where: { AND: [buildIncidentScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordDocumentsTab, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "risk_assessment",
    moduleKey: "hse",
    noun: "Risk assessment",
    activityEntityType: "HseRiskAssessment",
    route: "/hse/risk-assessments",
    viewPermissions: ["hse.risk.view"],
    async find(context, id) {
      const row = await prisma.hseRiskAssessment.findFirst({
        where: { AND: [buildRiskAssessmentScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, assessmentNumber: true, title: true, projectId: true, status: true, archivedAt: true, ownerMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "risk_assessment", id: row.id, companyId: row.companyId, label: numbered(row.assessmentNumber, row.title),
        href: `/hse/risk-assessments/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.ownerMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.hseRiskAssessment.findMany({
        where: { AND: [buildRiskAssessmentScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordPage, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "hse_action",
    moduleKey: "hse",
    noun: "HSE action",
    activityEntityType: "HseAction",
    route: "/hse/actions",
    viewPermissions: ["hse.action.view"],
    async find(context, id) {
      const row = await prisma.hseAction.findFirst({
        where: { AND: [buildHseActionScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, actionNumber: true, title: true, projectId: true, status: true, assignedToMemberId: true, createdByMemberId: true },
      });
      return row && {
        type: "hse_action", id: row.id, companyId: row.companyId, label: numbered(row.actionNumber, row.title),
        href: `/hse/actions/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.assignedToMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.hseAction.findMany({
        where: { AND: [buildHseActionScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "toolbox_talk",
    moduleKey: "hse",
    noun: "Toolbox talk",
    activityEntityType: "ToolboxTalk",
    route: "/hse/toolbox-talks",
    viewPermissions: ["hse.toolbox.view"],
    async find(context, id) {
      const row = await prisma.toolboxTalk.findFirst({
        where: { AND: [buildToolboxScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, talkNumber: true, title: true, projectId: true, status: true, conductedByMemberId: true },
      });
      return row && {
        type: "toolbox_talk", id: row.id, companyId: row.companyId, label: numbered(row.talkNumber, row.title),
        href: `/hse/toolbox-talks/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.conductedByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.toolboxTalk.findMany({
        where: { AND: [buildToolboxScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: null,
  },
  {
    type: "work_permit",
    moduleKey: "hse",
    noun: "Work permit",
    activityEntityType: "HseWorkPermit",
    route: "/hse/permits",
    viewPermissions: ["hse.permit.view"],
    async find(context, id) {
      const row = await prisma.hseWorkPermit.findFirst({
        where: { AND: [buildPermitScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, permitNumber: true, title: true, projectId: true, status: true, requestedByMemberId: true, responsibleMemberId: true },
      });
      return row && {
        type: "work_permit", id: row.id, companyId: row.companyId, label: numbered(row.permitNumber, row.title),
        href: `/hse/permits/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.requestedByMemberId, row.responsibleMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.hseWorkPermit.findMany({
        where: { AND: [buildPermitScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    type: "environmental_observation",
    moduleKey: "hse",
    noun: "Environmental observation",
    activityEntityType: "EnvironmentalObservation",
    route: "/hse/environment",
    viewPermissions: ["hse.environment.view"],
    async find(context, id) {
      const row = await prisma.environmentalObservation.findFirst({
        where: { AND: [buildObservationScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, observationNumber: true, title: true, projectId: true, status: true, reportedByMemberId: true, assignedToMemberId: true },
      });
      return row && {
        type: "environmental_observation", id: row.id, companyId: row.companyId, label: numbered(row.observationNumber, row.title),
        href: `/hse/environment/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.reportedByMemberId, row.assignedToMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.environmentalObservation.findMany({
        where: { AND: [buildObservationScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: { view: ["hse.document.view"], upload: ["hse.document.create"], tabHref: recordPage, reviewable: false },
    collaboration: null,
  },
  {
    type: "stop_work",
    moduleKey: "hse",
    noun: "Stop-work order",
    activityEntityType: "StopWorkRecord",
    route: "/hse/stop-work",
    viewPermissions: ["hse.stop_work.view"],
    async find(context, id) {
      const row = await prisma.stopWorkRecord.findFirst({
        where: { AND: [buildStopWorkScopeWhere(context), { id, companyId: context.companyId }] },
        select: { id: true, companyId: true, stopWorkNumber: true, title: true, projectId: true, status: true, issuedByMemberId: true },
      });
      return row && {
        type: "stop_work", id: row.id, companyId: row.companyId, label: numbered(row.stopWorkNumber, row.title),
        href: `/hse/stop-work/${row.id}`, projectId: row.projectId, archived: isArchived(row),
        stakeholderMemberIds: unique(row.issuedByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.stopWorkRecord.findMany({
        where: { AND: [buildStopWorkScopeWhere(context), { id: { in: ids }, companyId: context.companyId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    // Read-only: a stop-work order's evidence is filed on the hazard or
    // incident that caused it, and no page offers an upload here.
    documents: { view: ["hse.document.view"], upload: null, tabHref: recordPage, reviewable: false },
    collaboration: null,
  },
  {
    // A Calendar-owned event (PRD #39 §36). Its visibility rules are the
    // calendar's own; a reminder or invitation links here and is re-read.
    type: "calendar_event",
    moduleKey: "calendar",
    noun: "Calendar event",
    activityEntityType: "CalendarEvent",
    viewPermissions: ["calendar.view"],
    async find(context, id) {
      const { readableEventWhere } = await import("@/lib/modules/calendar/calendar.visibility");
      const row = await prisma.calendarEvent.findFirst({
        where: { AND: [readableEventWhere(context), { id }] },
        select: { id: true, companyId: true, title: true, projectId: true, archivedAt: true, createdByMemberId: true },
      });
      return row && {
        type: "calendar_event", id: row.id, companyId: row.companyId, label: row.title,
        href: `/calendar?event=${row.id}`, projectId: row.projectId, archived: row.archivedAt !== null,
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableEventWhere } = await import("@/lib/modules/calendar/calendar.visibility");
      const rows = await prisma.calendarEvent.findMany({
        where: { AND: [readableEventWhere(context), { id: { in: ids } }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: null,
    collaboration: null,
  },

  /* Meetings (PRD #40 §64, §68, §196, §197) -------------------------------- */
  {
    type: "meeting",
    moduleKey: "meetings",
    noun: "Meeting",
    activityEntityType: "Meeting",
    route: "/meetings",
    viewPermissions: ["meeting.view"],
    async find(context, id) {
      const { readableMeetingWhere } = await import("@/lib/modules/meetings/meeting.permissions");
      const row = await prisma.meeting.findFirst({
        where: { AND: [readableMeetingWhere(context), { id }] },
        select: {
          id: true, companyId: true, title: true, projectId: true, archivedAt: true, status: true, organizerMemberId: true,
          participants: { where: { role: { in: ["CHAIR", "SECRETARY"] } }, select: { memberId: true } },
        },
      });
      return row && {
        type: "meeting", id: row.id, companyId: row.companyId, label: row.title, href: `/meetings/${row.id}`,
        projectId: row.projectId, archived: row.archivedAt !== null,
        stakeholderMemberIds: unique(row.organizerMemberId, ...row.participants.map((participant) => participant.memberId)),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableMeetingWhere } = await import("@/lib/modules/meetings/meeting.permissions");
      const rows = await prisma.meeting.findMany({
        where: { AND: [readableMeetingWhere(context), { id: { in: ids } }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    // Meeting files need the meeting's own document permissions on top of Documents (PRD #40 §196, §234).
    documents: { view: ["meeting.document.view"], upload: ["meeting.document.create"], tabHref: recordDocumentsTab, reviewable: true },
    collaboration: { requires: [] },
  },

  /* Timesheets (PRD #42 §107-§111, §221, §222, §240) ---------------------- */
  {
    // One discussion per week, for the approver and the member to clear up an
    // entry; no documents (§111, §221). Work logs are not records of their own.
    type: "timesheet",
    moduleKey: "timesheets",
    noun: "Timesheet",
    activityEntityType: "Timesheet",
    route: "/timesheets",
    viewPermissions: ["timesheet.view_own"],
    async find(context, id) {
      const { readableTimesheetWhere } = await import("@/lib/modules/timesheets/timesheet.permissions");
      const { dateOf, weekLabel } = await import("@/lib/modules/timesheets/timesheet.time");
      const row = await prisma.timesheet.findFirst({
        where: { AND: [await readableTimesheetWhere(context), { id }] },
        select: { id: true, companyId: true, memberId: true, approverMemberId: true, periodStart: true, member: { select: { user: { select: { firstName: true, lastName: true } } } } },
      });
      return row && {
        type: "timesheet", id: row.id, companyId: row.companyId,
        label: `Timesheet · ${row.member.user.firstName} ${row.member.user.lastName} · ${weekLabel(dateOf(row.periodStart))}`,
        href: `/timesheets/${row.id}`, projectId: null, archived: false,
        stakeholderMemberIds: unique(row.memberId, row.approverMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableTimesheetWhere } = await import("@/lib/modules/timesheets/timesheet.permissions");
      const rows = await prisma.timesheet.findMany({ where: { AND: [await readableTimesheetWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: null,
    collaboration: { requires: [] },
  },

  /* Daily logs (PRD #43 §74, §122-§125, §226-§228) ------------------------- */
  {
    // Reached through its project; files are the day's evidence, added while
    // the log is still being written, and read by anybody who can open it.
    type: "daily_log",
    moduleKey: "dailyLogs",
    noun: "Daily log",
    activityEntityType: "DailyLog",
    viewPermissions: ["daily_log.view"],
    async find(context, id) {
      const { readableDailyLogWhere } = await import("@/lib/modules/daily-logs/daily-log.permissions");
      const { dateLabel } = await import("@/lib/modules/daily-logs/daily-log.time");
      const row = await prisma.dailyLog.findFirst({
        where: { AND: [readableDailyLogWhere(context), { id }] },
        select: { id: true, companyId: true, projectId: true, workDate: true, status: true, createdByMemberId: true, submittedByMemberId: true, reviewerMemberId: true, project: { select: { name: true } } },
      });
      return row && {
        type: "daily_log", id: row.id, companyId: row.companyId,
        label: `Daily log · ${row.project.name} · ${dateLabel(row.workDate.toISOString().slice(0, 10))}`,
        href: `/projects/${row.projectId}/daily-logs/${row.id}`,
        projectId: row.projectId,
        archived: row.status === "VOID",
        filesClosed: row.status !== "DRAFT" && row.status !== "CORRECTION_REQUIRED",
        stakeholderMemberIds: unique(row.createdByMemberId, row.submittedByMemberId, row.reviewerMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableDailyLogWhere } = await import("@/lib/modules/daily-logs/daily-log.permissions");
      const rows = await prisma.dailyLog.findMany({ where: { AND: [readableDailyLogWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["daily_log.edit"], tabHref: (summary) => `${summary.href}#evidence`, reviewable: false },
    collaboration: { requires: [] },
  },

  /* Project planning (PRD #44 §57, §59, §178-§182) -------------------------- */
  {
    // Reached through its project's plan. Files are the milestone's evidence —
    // certificates, approvals, handover packs — added by whoever keeps it; its
    // discussion is context, never the status of record (§179).
    type: "project_milestone",
    moduleKey: "projects",
    noun: "Milestone",
    activityEntityType: "ProjectMilestone",
    viewPermissions: ["project.view", "project_planning.view"],
    async find(context, id) {
      const { readableMilestoneWhere } = await import("@/lib/modules/project-planning/planning.permissions");
      const row = await prisma.projectMilestone.findFirst({
        where: { AND: [readableMilestoneWhere(context), { id }] },
        select: { id: true, companyId: true, projectId: true, name: true, archivedAt: true, ownerMemberId: true, createdByMemberId: true, project: { select: { name: true, archivedAt: true, status: true, projectManagerMemberId: true } } },
      });
      return row && {
        type: "project_milestone", id: row.id, companyId: row.companyId,
        label: `${row.name} · ${row.project.name}`,
        href: `/projects/${row.projectId}/planning?milestone=${row.id}`,
        projectId: row.projectId,
        archived: Boolean(row.archivedAt) || Boolean(row.project.archivedAt) || row.project.status === "ARCHIVED",
        stakeholderMemberIds: unique(row.ownerMemberId, row.createdByMemberId, row.project.projectManagerMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableMilestoneWhere } = await import("@/lib/modules/project-planning/planning.permissions");
      const rows = await prisma.projectMilestone.findMany({ where: { AND: [readableMilestoneWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["project_planning.milestone.edit"], tabHref: (summary) => summary.href, reviewable: true },
    collaboration: { requires: [] },
  },

  /* Announcements (PRD #45 §37-§39, §64, §280) ------------------------------ */
  {
    // Reached through its audience. Attachments sit with it while it is live;
    // an expired one keeps its files but takes no more. No discussion (§64).
    type: "announcement",
    moduleKey: "announcements",
    noun: "Announcement",
    activityEntityType: "Announcement",
    route: "/announcements",
    viewPermissions: ["announcement.view"],
    async find(context, id) {
      const { managedWhere, readableAnnouncementWhere } = await import("@/lib/modules/announcements/announcement.permissions");
      const row = await prisma.announcement.findFirst({
        where: { AND: [readableAnnouncementWhere(context), { id }] },
        select: { id: true, companyId: true, title: true, status: true, projectId: true, authorMemberId: true },
      });
      if (!row) return null;
      // Files are added by the people who manage it, never by a reader who happens to hold the edit grant.
      const managed = (await prisma.announcement.count({ where: { AND: [{ id: row.id }, managedWhere(context)] } })) > 0;
      return {
        type: "announcement", id: row.id, companyId: row.companyId, label: row.title, href: `/announcements/${row.id}`,
        projectId: row.projectId, archived: row.status === "ARCHIVED", filesClosed: row.status === "EXPIRED" || !managed,
        stakeholderMemberIds: unique(row.authorMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableAnnouncementWhere } = await import("@/lib/modules/announcements/announcement.permissions");
      const rows = await prisma.announcement.findMany({ where: { AND: [readableAnnouncementWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["announcement.edit"], tabHref: (summary) => summary.href, reviewable: false },
    collaboration: null,
  },

  /* Contractors (PRD #46 §126, §127, §240-§247) ----------------------------- */
  {
    // Company master data, reached through the directory's scope. Its files are
    // the contractor's own paperwork — prequalification, registration — added
    // by whoever keeps the record; discussion is internal only (§5, §22).
    type: "contractor",
    moduleKey: "contractors",
    noun: "Contractor",
    activityEntityType: "ContractorProfile",
    route: "/contractors",
    viewPermissions: ["contractor.view"],
    async find(context, id) {
      const { contractorDirectoryWhere } = await import("@/lib/modules/contractors/contractor.permissions");
      const row = await prisma.contractorProfile.findFirst({ where: { AND: [contractorDirectoryWhere(context), { id }] }, select: { id: true, companyId: true, legalName: true, status: true, createdByMemberId: true } });
      return row && {
        type: "contractor", id: row.id, companyId: row.companyId, label: row.legalName, href: `/contractors/${row.id}`,
        projectId: null, archived: row.status === "ARCHIVED", stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { contractorDirectoryWhere } = await import("@/lib/modules/contractors/contractor.permissions");
      const rows = await prisma.contractorProfile.findMany({ where: { AND: [contractorDirectoryWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["contractor.edit"], tabHref: (summary) => `/contractors/${summary.id}/documents`, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    // A project scope unit, reached through its project (§38, §246).
    type: "work_package",
    moduleKey: "contractors",
    noun: "Work package",
    activityEntityType: "WorkPackage",
    viewPermissions: ["work_package.view"],
    async find(context, id) {
      const { readableWorkPackageWhere } = await import("@/lib/modules/contractors/contractor.permissions");
      const row = await prisma.workPackage.findFirst({
        where: { AND: [readableWorkPackageWhere(context), { id }] },
        select: { id: true, companyId: true, projectId: true, code: true, name: true, status: true, archivedAt: true, responsibleMemberId: true, createdByMemberId: true, project: { select: { archivedAt: true, status: true, projectManagerMemberId: true } } },
      });
      return row && {
        type: "work_package", id: row.id, companyId: row.companyId, label: numbered(row.code, row.name),
        href: `/projects/${row.projectId}/work-packages/${row.id}`, projectId: row.projectId,
        archived: Boolean(row.archivedAt) || Boolean(row.project.archivedAt) || row.project.status === "ARCHIVED",
        stakeholderMemberIds: unique(row.responsibleMemberId, row.createdByMemberId, row.project.projectManagerMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableWorkPackageWhere } = await import("@/lib/modules/contractors/contractor.permissions");
      const rows = await prisma.workPackage.findMany({ where: { AND: [readableWorkPackageWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["work_package.edit"], tabHref: (summary) => summary.href, reviewable: true },
    collaboration: { requires: [] },
  },
  {
    // Evidence that a contractor holds what it must — the certificate lives here
    // as a Document (§47). No discussion: questions go on the contractor.
    type: "contractor_compliance",
    moduleKey: "contractors",
    noun: "Compliance item",
    activityEntityType: "ContractorComplianceItem",
    viewPermissions: ["contractor_compliance.view"],
    async find(context, id) {
      const { readableComplianceWhere } = await import("@/lib/modules/contractors/contractor.permissions");
      const row = await prisma.contractorComplianceItem.findFirst({ where: { AND: [readableComplianceWhere(context), { id }] }, select: { id: true, companyId: true, contractorId: true, title: true, status: true, archivedAt: true, createdByMemberId: true, contractor: { select: { legalName: true, status: true } } } });
      return row && {
        type: "contractor_compliance", id: row.id, companyId: row.companyId, label: `${row.title} · ${row.contractor.legalName}`,
        href: `/contractors/${row.contractorId}/compliance?item=${row.id}`, projectId: null,
        archived: Boolean(row.archivedAt) || row.contractor.status === "ARCHIVED",
        stakeholderMemberIds: unique(row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableComplianceWhere } = await import("@/lib/modules/contractors/contractor.permissions");
      const rows = await prisma.contractorComplianceItem.findMany({ where: { AND: [readableComplianceWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["contractor_compliance.manage"], tabHref: (summary) => summary.href, reviewable: false },
    collaboration: null,
  },

  /* Engineering (PRD #46 §59-§124, §126, §249, §253) ------------------------ */
  {
    // A register entry; each revision's file is uploaded here and frozen once
    // submitted (§69). Reviews are the register's own workflow, never a
    // document review (§75). A void or superseded document takes no new files.
    type: "engineering_document",
    moduleKey: "engineering",
    noun: "Engineering document",
    activityEntityType: "EngineeringDocument",
    viewPermissions: ["engineering_document.view"],
    async find(context, id) {
      const { readableEngineeringDocumentWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const row = await prisma.engineeringDocument.findFirst({
        where: { AND: [readableEngineeringDocumentWhere(context), { id }] },
        select: { id: true, companyId: true, projectId: true, documentNumber: true, title: true, status: true, responsibleMemberId: true, reviewerMemberId: true, createdByMemberId: true, project: { select: { archivedAt: true, status: true } } },
      });
      return row && {
        type: "engineering_document", id: row.id, companyId: row.companyId, label: numbered(row.documentNumber, row.title),
        href: `/projects/${row.projectId}/engineering/documents/${row.id}`, projectId: row.projectId,
        archived: row.status === "VOID" || Boolean(row.project.archivedAt) || row.project.status === "ARCHIVED",
        filesClosed: row.status === "SUPERSEDED",
        stakeholderMemberIds: unique(row.responsibleMemberId, row.reviewerMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableEngineeringDocumentWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const rows = await prisma.engineeringDocument.findMany({ where: { AND: [readableEngineeringDocumentWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["engineering_document.edit"], tabHref: (summary) => summary.href, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    // Sketches and marked-up extracts travel with the question and its answers;
    // a closed or void RFI keeps them and takes no more.
    type: "rfi",
    moduleKey: "engineering",
    noun: "RFI",
    activityEntityType: "Rfi",
    viewPermissions: ["rfi.view"],
    async find(context, id) {
      const { readableRfiWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const row = await prisma.rfi.findFirst({
        where: { AND: [readableRfiWhere(context), { id }] },
        select: { id: true, companyId: true, projectId: true, rfiNumber: true, subject: true, status: true, assignedToMemberId: true, raisedByMemberId: true, createdByMemberId: true, project: { select: { archivedAt: true, status: true } } },
      });
      return row && {
        type: "rfi", id: row.id, companyId: row.companyId, label: numbered(row.rfiNumber, row.subject),
        href: `/projects/${row.projectId}/engineering/rfis/${row.id}`, projectId: row.projectId,
        archived: row.status === "VOID" || Boolean(row.project.archivedAt) || row.project.status === "ARCHIVED",
        filesClosed: row.status === "CLOSED",
        stakeholderMemberIds: unique(row.assignedToMemberId, row.raisedByMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableRfiWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const rows = await prisma.rfi.findMany({ where: { AND: [readableRfiWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["rfi.respond"], tabHref: (summary) => summary.href, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    type: "technical_submittal",
    moduleKey: "engineering",
    noun: "Submittal",
    activityEntityType: "TechnicalSubmittal",
    viewPermissions: ["submittal.view"],
    async find(context, id) {
      const { readableSubmittalWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const row = await prisma.technicalSubmittal.findFirst({
        where: { AND: [readableSubmittalWhere(context), { id }] },
        select: { id: true, companyId: true, projectId: true, submittalNumber: true, title: true, status: true, assignedReviewerMemberId: true, createdByMemberId: true, project: { select: { archivedAt: true, status: true } } },
      });
      return row && {
        type: "technical_submittal", id: row.id, companyId: row.companyId, label: numbered(row.submittalNumber, row.title),
        href: `/projects/${row.projectId}/engineering/submittals/${row.id}`, projectId: row.projectId,
        archived: row.status === "VOID" || Boolean(row.project.archivedAt) || row.project.status === "ARCHIVED",
        filesClosed: row.status === "CLOSED",
        stakeholderMemberIds: unique(row.assignedReviewerMemberId, row.createdByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableSubmittalWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const rows = await prisma.technicalSubmittal.findMany({ where: { AND: [readableSubmittalWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["submittal.edit"], tabHref: (summary) => summary.href, reviewable: false },
    collaboration: { requires: [] },
  },
  {
    // A cover letter can be attached while it is a draft; once issued, its
    // contents — items and files — never change (§123).
    type: "transmittal",
    moduleKey: "engineering",
    noun: "Transmittal",
    activityEntityType: "DocumentTransmittal",
    viewPermissions: ["transmittal.view"],
    async find(context, id) {
      const { readableTransmittalWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const row = await prisma.documentTransmittal.findFirst({
        where: { AND: [readableTransmittalWhere(context), { id }] },
        select: { id: true, companyId: true, projectId: true, transmittalNumber: true, subject: true, status: true, createdByMemberId: true, issuedByMemberId: true, project: { select: { archivedAt: true, status: true } } },
      });
      return row && {
        type: "transmittal", id: row.id, companyId: row.companyId, label: numbered(row.transmittalNumber, row.subject),
        href: `/projects/${row.projectId}/engineering/transmittals/${row.id}`, projectId: row.projectId,
        archived: row.status === "VOID" || Boolean(row.project.archivedAt) || row.project.status === "ARCHIVED",
        filesClosed: row.status !== "DRAFT",
        stakeholderMemberIds: unique(row.createdByMemberId, row.issuedByMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const { readableTransmittalWhere } = await import("@/lib/modules/engineering/engineering.permissions");
      const rows = await prisma.documentTransmittal.findMany({ where: { AND: [readableTransmittalWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
    documents: { view: [], upload: ["transmittal.create"], tabHref: (summary) => summary.href, reviewable: false },
    collaboration: null,
  },

  /* Approvals (PRD #41 §170) ----------------------------------------------- */
  {
    // A delegation is only ever the business of the two people in it, so it is
    // readable by them alone — which is who its notification goes to.
    type: "approval_delegation",
    moduleKey: "approvals",
    noun: "Approval delegation",
    activityEntityType: "ApprovalDelegation",
    viewPermissions: ["approvals.view"],
    async find(context, id) {
      const row = await prisma.approvalDelegation.findFirst({
        where: { id, companyId: context.companyId, OR: [{ fromMemberId: context.membershipId }, { toMemberId: context.membershipId }] },
        select: { id: true, companyId: true, fromMemberId: true, toMemberId: true, revokedAt: true, endsAt: true },
      });
      return row && {
        type: "approval_delegation", id: row.id, companyId: row.companyId, label: "Approval delegation",
        href: "/approvals?panel=delegation", projectId: null, archived: row.revokedAt !== null || row.endsAt <= new Date(),
        stakeholderMemberIds: unique(row.fromMemberId, row.toMemberId),
      };
    },
    async reachable(context, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.approvalDelegation.findMany({
        where: { id: { in: ids }, companyId: context.companyId, OR: [{ fromMemberId: context.membershipId }, { toMemberId: context.membershipId }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    documents: null,
    collaboration: null,
  },
];

const BY_TYPE = new Map<RecordType, RecordDefinition>();
for (const definition of DEFINITIONS) {
  if (BY_TYPE.has(definition.type)) throw new Error(`Duplicate record definition: ${definition.type}`);
  BY_TYPE.set(definition.type, definition);
}
for (const type of RECORD_TYPES) {
  if (!BY_TYPE.has(type)) throw new Error(`Record type without a definition: ${type}`);
}

export function recordDefinition(type: string): RecordDefinition | null {
  return isRecordType(type) ? (BY_TYPE.get(type) ?? null) : null;
}

/**
 * A record's page from its id alone, for types whose route is `route/id`.
 * Null for a type whose page sits under another record (an amendment under its
 * contract): that link needs the record loaded, which `find` does.
 */
export function recordPath(type: string, id: string): string | null {
  const route = recordDefinition(type)?.route;
  return route ? `${route}/${id}` : null;
}

export function recordDefinitions(): RecordDefinition[] {
  return [...DEFINITIONS];
}

/**
 * The record, if this reader may see it right now. Unknown types, disabled
 * modules, missing permissions, other companies and out-of-scope records all
 * answer null.
 */
export async function loadRecord(context: UserContext, type: string, id: string): Promise<RecordSummary | null> {
  const definition = recordDefinition(type);
  if (!definition || !id) return null;
  if (!moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) return null;
  return definition.find(context, id);
}

export async function canReadRecord(context: UserContext, type: string, id: string): Promise<boolean> {
  return (await loadRecord(context, type, id)) !== null;
}
