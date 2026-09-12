import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";

/**
 * The parent-access registry (PRD #13 §42–§45).
 *
 * A generic `document.view` is never enough. Every document is reachable only
 * through its parent's permissions:
 *
 *   document.view + company + parent module permission + parent record access
 *
 * Each parent shape registers a resolver here rather than every Documents
 * endpoint re-implementing the rule. An unregistered shape **fails closed**: a
 * document filed under a module whose resolver does not exist yet is excluded
 * from lists and refused on detail, rather than quietly assumed safe
 * (PRD #13 §45, §136, §243).
 */

export type DocumentParentRef = {
  projectId: string | null;
  clientId: string | null;
  module: string | null;
  entityType: string | null;
  entityId: string | null;
};

/* -------------------------------------------------------------------------- */
/* Module gate                                                                 */
/* -------------------------------------------------------------------------- */

function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Modules the caller may reach at all. */
function reachableModules(context: UserContext): ModuleKey[] {
  return (Object.keys(context.moduleAccess) as ModuleKey[]).filter((key) => {
    const access = context.moduleAccess[key];
    return access.enabled && access.accessLevel !== "NONE";
  });
}

/**
 * Modules the caller reaches at *company* level.
 *
 * A company-level document has no project or client to narrow it, so it needs
 * company-level access to the module it was filed under. That is what keeps
 * "Company Financial Summary.pdf" away from an Architect whose Finance access
 * is scoped to their own projects (PRD #13 §39, §46, §202, §283).
 */
function companyLevelModules(context: UserContext): ModuleKey[] {
  return reachableModules(context).filter((key) => {
    const scope = getModuleScope(context, key);
    return scope === "COMPANY" || scope === "SYSTEM";
  });
}

/**
 * A document filed under a module the caller cannot reach is invisible whatever
 * its parent record says.
 */
function moduleAllowed(context: UserContext, moduleName: string | null): boolean {
  if (moduleName === null) return true;
  if (!isModuleKey(moduleName)) return false; // fail closed on an unknown module
  return reachableModules(context).includes(moduleName);
}

/* -------------------------------------------------------------------------- */
/* Entity resolvers                                                            */
/* -------------------------------------------------------------------------- */

type EntityResolver = (context: UserContext, entityId: string) => Promise<boolean>;

/**
 * Registered `entityType` resolvers.
 *
 * `task` is here because Tasks is a real module now; anything not listed is
 * refused until its module registers one (PRD #13 §44, §199, §289).
 */
const ENTITY_RESOLVERS: Record<string, EntityResolver> = {
  async project(context, entityId) {
    const found = await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async client(context, entityId) {
    const found = await prisma.client.findFirst({
      where: { AND: [buildClientScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async task(context, entityId) {
    if (!can(context, "task.view")) return false;
    const { buildTaskScopeWhere } = await import("@/lib/access/scope");
    const found = await prisma.task.findFirst({
      where: { AND: [buildTaskScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  /*
   * Finance parents (PRD #15 §187, §188).
   *
   * Each finance record answers with its own scope clause and its own view
   * permission, so an invoice PDF is exactly as reachable as the invoice —
   * never more (PRD #15 §189–§192).
   */
  async invoice(context, entityId) {
    if (!can(context, "finance.invoice.view")) return false;
    const { buildInvoiceScopeWhere } = await import("@/lib/modules/finance/finance.scope");
    const found = await prisma.invoice.findFirst({
      where: { AND: [buildInvoiceScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async expense(context, entityId) {
    if (!can(context, "finance.expense.view")) return false;
    const { buildExpenseScopeWhere } = await import("@/lib/modules/finance/finance.scope");
    const found = await prisma.expense.findFirst({
      where: { AND: [buildExpenseScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async budget(context, entityId) {
    if (!can(context, "finance.budget.view")) return false;
    const { buildBudgetScopeWhere } = await import("@/lib/modules/finance/finance.scope");
    const found = await prisma.projectBudget.findFirst({
      where: { AND: [buildBudgetScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async commitment(context, entityId) {
    if (!can(context, "finance.commitment.view")) return false;
    const { buildCommitmentScopeWhere } = await import("@/lib/modules/finance/finance.scope");
    const found = await prisma.commitment.findFirst({
      where: { AND: [buildCommitmentScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  /*
   * HR parents (PRD #16 §129, §204, §205).
   *
   * `employee` is addressed by membership id, the way every HR route is. Both
   * resolvers allow the self-service door: somebody reaches the files on their
   * own employment record and their own leave without holding an HR grant over
   * anybody else (PRD #16 §133, §135).
   */
  async employee(context, entityId) {
    const { buildEmployeeScopeWhere, isSelf } = await import("@/lib/modules/hr/hr.scope");

    // Either the pair of HR grants, or this is the reader's own record
    // (PRD #16 §133, §135).
    const byGrant = can(context, "hr.document.view") && can(context, "hr.employee.view");
    const byOwnership = isSelf(context, entityId) && can(context, "hr.self.documents");
    if (!byGrant && !byOwnership) return false;

    const found = await prisma.employeeProfile.findFirst({
      where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  /*
   * Sales parents (PRD #17 §141–§144, §265, §335).
   *
   * Each record answers with its own scope clause and its own view permission,
   * so a proposal PDF is exactly as reachable as the proposal — never more. An
   * Architect holding generic `document.view` gets nothing here, which is the
   * release-critical case (PRD #17 §335).
   */
  async lead(context, entityId) {
    if (!can(context, "sales.document.view") || !can(context, "sales.lead.view")) return false;
    const { buildLeadScopeWhere } = await import("@/lib/modules/sales/sales.scope");
    const found = await prisma.lead.findFirst({
      where: { AND: [buildLeadScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async opportunity(context, entityId) {
    if (!can(context, "sales.document.view") || !can(context, "sales.opportunity.view")) {
      return false;
    }
    const { buildOpportunityScopeWhere } = await import("@/lib/modules/sales/sales.scope");
    const found = await prisma.opportunity.findFirst({
      where: { AND: [buildOpportunityScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async proposal(context, entityId) {
    if (!can(context, "sales.document.view") || !can(context, "sales.proposal.view")) return false;
    const { buildProposalScopeWhere } = await import("@/lib/modules/sales/sales.scope");
    const found = await prisma.proposal.findFirst({
      where: { AND: [buildProposalScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  /*
   * Legal parents (PRD #18 §199–§201, §437).
   *
   * An amendment and an obligation are exactly as reachable as the contract
   * they belong to — they carry no scope of their own, so there is one answer
   * to "may this person see this agreement?" and the document resolver is not a
   * second one. Release-critical: a generic `document.view` must never open a
   * signed contract (PRD #18 §437).
   */
  async contract(context, entityId) {
    if (!can(context, "legal.document.view") || !can(context, "legal.contract.view")) return false;
    const { buildContractScopeWhere } = await import("@/lib/modules/contracts/contract.scope");
    const found = await prisma.contract.findFirst({
      where: { AND: [buildContractScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async amendment(context, entityId) {
    if (!can(context, "legal.document.view") || !can(context, "legal.amendment.view")) return false;
    const { buildAmendmentScopeWhere } = await import("@/lib/modules/contracts/contract.scope");
    const found = await prisma.contractAmendment.findFirst({
      where: { AND: [buildAmendmentScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async obligation(context, entityId) {
    if (!can(context, "legal.document.view") || !can(context, "legal.obligation.view")) {
      return false;
    }
    const { buildObligationScopeWhere } = await import("@/lib/modules/contracts/contract.scope");
    const found = await prisma.contractObligation.findFirst({
      where: { AND: [buildObligationScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  /*
   * Inventory parents (PRD #20 §189–§196).
   *
   * Each stock record answers with its own scope clause and its own view
   * permission, so a delivery photo is exactly as reachable as the receipt it
   * is filed against. A generic `document.view` opens nothing here, which is
   * the release-critical case: a project user must not reach central-warehouse
   * paperwork by way of the Documents module (PRD #20 §191, §302).
   */
  async inventory_item(context, entityId) {
    if (!can(context, "inventory.document.view") || !can(context, "inventory.item.view")) {
      return false;
    }
    const { buildItemScopeWhere } = await import("@/lib/modules/inventory/inventory.scope");
    const found = await prisma.inventoryItem.findFirst({
      where: { AND: [buildItemScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async warehouse(context, entityId) {
    if (!can(context, "inventory.document.view") || !can(context, "inventory.warehouse.view")) {
      return false;
    }
    const { buildWarehouseScopeWhere } = await import("@/lib/modules/inventory/inventory.scope");
    const found = await prisma.warehouse.findFirst({
      where: { AND: [buildWarehouseScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async inventory_receipt(context, entityId) {
    if (!can(context, "inventory.document.view") || !can(context, "inventory.receipt.view")) {
      return false;
    }
    const { buildReceiptScopeWhere } = await import("@/lib/modules/inventory/inventory.scope");
    const found = await prisma.inventoryReceipt.findFirst({
      where: { AND: [buildReceiptScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async stock_issue(context, entityId) {
    if (!can(context, "inventory.document.view") || !can(context, "inventory.issue.view")) {
      return false;
    }
    const { buildIssueScopeWhere } = await import("@/lib/modules/inventory/inventory.scope");
    const found = await prisma.stockIssue.findFirst({
      where: { AND: [buildIssueScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async stock_adjustment(context, entityId) {
    if (!can(context, "inventory.document.view") || !can(context, "inventory.adjustment.view")) {
      return false;
    }
    const { buildAdjustmentScopeWhere } = await import("@/lib/modules/inventory/inventory.scope");
    const found = await prisma.stockAdjustment.findFirst({
      where: { AND: [buildAdjustmentScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  /*
   * QA/QC parents (PRD #21 §175–§183).
   *
   * Each quality record answers with its own scope clause and its own view
   * permission, so a photograph of a failed check is exactly as reachable as
   * the inspection it hangs off. A generic `document.view` opens nothing here:
   * quality evidence is often the record of somebody's mistake, and it is not
   * everybody's to read (PRD #21 §177, §187).
   */
  async quality_inspection(context, entityId) {
    if (!can(context, "qaqc.document.view") || !can(context, "qaqc.inspection.view")) {
      return false;
    }
    const { buildInspectionScopeWhere } = await import("@/lib/modules/qaqc/qaqc.scope");
    const found = await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async quality_defect(context, entityId) {
    if (!can(context, "qaqc.document.view") || !can(context, "qaqc.defect.view")) return false;
    const { buildDefectScopeWhere } = await import("@/lib/modules/qaqc/qaqc.scope");
    const found = await prisma.qualityDefect.findFirst({
      where: { AND: [buildDefectScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async non_conformance_report(context, entityId) {
    if (!can(context, "qaqc.document.view") || !can(context, "qaqc.ncr.view")) return false;
    const { buildNcrScopeWhere } = await import("@/lib/modules/qaqc/qaqc.scope");
    const found = await prisma.nonConformanceReport.findFirst({
      where: { AND: [buildNcrScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async corrective_action(context, entityId) {
    if (
      !can(context, "qaqc.document.view") ||
      !can(context, "qaqc.corrective_action.view")
    ) {
      return false;
    }
    const { buildCorrectiveActionScopeWhere } = await import("@/lib/modules/qaqc/qaqc.scope");
    const found = await prisma.correctiveAction.findFirst({
      where: { AND: [buildCorrectiveActionScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  /*
   * HSE parents (PRD #22 §185–§193).
   *
   * Each safety record answers with its own scope clause and its own view
   * permission, so a photograph of an unguarded edge is exactly as reachable as
   * the hazard it hangs off. A generic `document.view` opens nothing here: an
   * incident's supporting files may show somebody being hurt, and they are not
   * everybody's to read (PRD #22 §21, §187).
   */
  async hse_inspection(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.inspection.view")) {
      return false;
    }
    const { buildInspectionScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.hseInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async hazard(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.hazard.view")) return false;
    const { buildHazardScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.hseHazard.findFirst({
      where: { AND: [buildHazardScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async incident(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.incident.view")) return false;
    const { buildIncidentScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.hseIncident.findFirst({
      where: { AND: [buildIncidentScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async risk_assessment(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.risk.view")) return false;
    const { buildRiskAssessmentScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.hseRiskAssessment.findFirst({
      where: { AND: [buildRiskAssessmentScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async hse_action(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.action.view")) return false;
    const { buildActionScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.hseAction.findFirst({
      where: { AND: [buildActionScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async toolbox_talk(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.toolbox.view")) return false;
    const { buildToolboxScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.toolboxTalk.findFirst({
      where: { AND: [buildToolboxScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async work_permit(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.permit.view")) return false;
    const { buildPermitScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.hseWorkPermit.findFirst({
      where: { AND: [buildPermitScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async environmental_observation(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.environment.view")) {
      return false;
    }
    const { buildObservationScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.environmentalObservation.findFirst({
      where: { AND: [buildObservationScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async stop_work(context, entityId) {
    if (!can(context, "hse.document.view") || !can(context, "hse.stop_work.view")) return false;
    const { buildStopWorkScopeWhere } = await import("@/lib/modules/hse/hse.scope");
    const found = await prisma.stopWorkRecord.findFirst({
      where: { AND: [buildStopWorkScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async leave_request(context, entityId) {
    // No self-service door: a supporting file on a leave request may be a
    // medical certificate, which is what `hr.leave.view` protects
    // (PRD #16 §132).
    if (!can(context, "hr.document.view") || !can(context, "hr.leave.view")) return false;

    const { buildLeaveScopeWhere } = await import("@/lib/modules/hr/hr.scope");
    const found = await prisma.leaveRequest.findFirst({
      where: { AND: [buildLeaveScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },
};

/* -------------------------------------------------------------------------- */
/* Access decision                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Can this caller reach the record a document hangs off?
 *
 * The order matters: company isolation is applied by the caller, then the
 * module gate, then the parent record itself.
 */
export async function canReachDocumentParent(
  context: UserContext,
  ref: DocumentParentRef,
): Promise<boolean> {
  if (!moduleAllowed(context, ref.module)) return false;

  if (ref.projectId) {
    const found = await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: ref.projectId }] },
      select: { id: true },
    });
    return Boolean(found);
  }

  if (ref.clientId) {
    if (!can(context, "client.view")) return false;
    const found = await prisma.client.findFirst({
      where: { AND: [buildClientScopeWhere(context), { id: ref.clientId }] },
      select: { id: true },
    });
    return Boolean(found);
  }

  if (ref.entityType && ref.entityId) {
    const resolver = ENTITY_RESOLVERS[ref.entityType];
    // Fail closed: an entity type nobody has registered is not reachable.
    if (!resolver) return false;
    return resolver(context, ref.entityId);
  }

  // A company-level document: no narrowing parent, so it needs company-level
  // access to its filing module.
  if (ref.module === null) return can(context, "document.company.view");
  return isModuleKey(ref.module) && companyLevelModules(context).includes(ref.module);
}

/**
 * Modules that require their own upload grant on top of `document.create`
 * before a document may be filed against one of their records.
 *
 * Finance is the case this exists for: reading an invoice is not the same
 * permission as attaching a file to it (PRD #15 §189–§192).
 */
const MODULE_UPLOAD_GRANT: Record<string, Permission> = {
  finance: "finance.document.create",
  // Self-service covers *reading* your own HR file, never adding one: an
  // employee putting a document onto their own record is still an HR filing
  // decision (PRD #16 §134, §135).
  hr: "hr.document.create",
  // Reading a proposal is not the same permission as attaching a file to it
  // (PRD #17 §143).
  sales: "sales.document.create",
  // Nor is reading a contract the same permission as filing against it
  // (PRD #18 §203).
  contracts: "legal.document.create",
  // Reading a delivery note is not the same permission as filing one
  // (PRD #20 §189).
  inventory: "inventory.document.create",
  // Nor is reading an inspection the same permission as attaching evidence to
  // it (PRD #21 §175).
  qaqc: "qaqc.document.create",
  // Nor is reading a hazard the same permission as filing evidence against it
  // (PRD #22 §185, §187).
  hse: "hse.document.create",
};

/** May this caller file a *new* document against that parent (PRD #13 §43, §91)? */
export async function canAttachToDocumentParent(
  context: UserContext,
  ref: DocumentParentRef,
): Promise<boolean> {
  if (!can(context, "document.create")) return false;
  if (ref.projectId === null && ref.clientId === null && ref.entityId === null) {
    // A general company document needs the company-document grant on top
    // (PRD #13 §92).
    return can(context, "document.company.create");
  }

  const grant = ref.module ? MODULE_UPLOAD_GRANT[ref.module] : undefined;
  if (grant && !can(context, grant)) return false;

  return canReachDocumentParent(context, ref);
}

/* -------------------------------------------------------------------------- */
/* List query                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The authorised `where` for a document list (PRD #13 §134, §135).
 *
 * Built as a set of OR branches rather than by loading every company document
 * and filtering in memory — which would be both slow and one refactor away
 * from a leak.
 */
/**
 * The view permission behind each record-document branch.
 *
 * Deliberately a table rather than a chain of ifs: adding a record type means
 * adding a line here and a resolver above, and forgetting either one leaves the
 * documents invisible rather than exposed.
 */
const RECORD_DOCUMENT_GRANTS: Record<string, Permission[]> = {
  task: ["task.view"],
  invoice: ["finance.invoice.view"],
  expense: ["finance.expense.view"],
  budget: ["finance.budget.view"],
  commitment: ["finance.commitment.view"],
  // HR needs both the document grant and access to the kind of record it hangs
  // off: an employee file is not reachable through leave access, or the other
  // way round (PRD #16 §132, §133).
  employee: ["hr.document.view", "hr.employee.view"],
  leave_request: ["hr.document.view", "hr.leave.view"],
  // Sales needs the document grant and access to the kind of record it hangs
  // off: an opportunity brief is not reachable through proposal access, or the
  // other way round (PRD #17 §143).
  lead: ["sales.document.view", "sales.lead.view"],
  opportunity: ["sales.document.view", "sales.opportunity.view"],
  proposal: ["sales.document.view", "sales.proposal.view"],
  // Legal is the same shape: a signed contract is reachable through contract
  // access, an amendment through amendment access (PRD #18 §200, §201).
  contract: ["legal.document.view", "legal.contract.view"],
  amendment: ["legal.document.view", "legal.amendment.view"],
  obligation: ["legal.document.view", "legal.obligation.view"],
};

/**
 * The one self-service branch (PRD #16 §135).
 *
 * `hr.self.documents` reaches documents parented to the reader's *own*
 * employment record and nothing else. Leave documents are deliberately absent:
 * a supporting file on a leave request requires `hr.leave.view`, because
 * medical certificates are exactly what that permission is protecting
 * (PRD #16 §132).
 */
const SELF_RECORD_DOCUMENT_GRANT: Permission = "hr.self.documents";

export function buildDocumentAccessWhere(context: UserContext): Prisma.DocumentWhereInput {
  const reachable = reachableModules(context);
  const companyLevel = companyLevelModules(context);

  const moduleGate = (allowed: ModuleKey[]): Prisma.DocumentWhereInput => ({
    OR: [{ module: null }, { module: { in: allowed } }],
  });

  const branches: Prisma.DocumentWhereInput[] = [
    // A project document follows project access.
    {
      AND: [
        { projectId: { not: null } },
        { project: buildProjectScopeWhere(context) },
        moduleGate(reachable),
      ],
    },
  ];

  // A client document follows client access.
  if (can(context, "client.view")) {
    branches.push({
      AND: [
        { projectId: null, clientId: { not: null } },
        { client: buildClientScopeWhere(context) },
        moduleGate(reachable),
      ],
    });
  }

  // A record document follows its own record's access. Each entity type is
  // gated by the permission that governs reading the record itself, which is
  // what keeps an invoice PDF exactly as reachable as its invoice — never more
  // (PRD #13 §44, PRD #15 §189–§192).
  for (const [entityType, permissions] of Object.entries(RECORD_DOCUMENT_GRANTS)) {
    if (permissions.every((permission) => can(context, permission))) {
      branches.push({
        AND: [{ projectId: null, clientId: null, entityType }, moduleGate(reachable)],
      });
    }
  }

  // Somebody's own employment file, reachable without any HR grant over anybody
  // else. Narrowed to their own membership, which is what "own" means here
  // (PRD #16 §135).
  if (can(context, SELF_RECORD_DOCUMENT_GRANT)) {
    branches.push({
      AND: [
        { projectId: null, clientId: null, entityType: "employee" },
        { entityId: context.membershipId },
        moduleGate(reachable),
      ],
    });
  }

  // A company document needs company-level access to its filing module, or the
  // dedicated company-document grant when it has no module at all.
  if (can(context, "document.company.view")) {
    branches.push({
      AND: [{ projectId: null, clientId: null, entityType: null, module: null }],
    });
  }
  if (companyLevel.length > 0) {
    branches.push({
      AND: [
        { projectId: null, clientId: null, entityType: null },
        { module: { in: companyLevel } },
      ],
    });
  }

  return { companyId: context.companyId, OR: branches };
}
