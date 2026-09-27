import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { approvalProviders } from "@/lib/modules/approvals/approvals.registry";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { decideApproval, findApprovalForRecord, getApprovalCounts, getApprovalDetail, listApprovals } from "@/lib/modules/approvals/approvals.service";
import type { ApprovalDecision, ApprovalProviderKey } from "@/lib/modules/approvals/approvals.types";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider } from "@/lib/core/storage/storage-provider.factory";
import { createExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import sharp from "sharp";

import { setFileScanner } from "@/lib/core/storage";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { attachDocumentFromBytes } from "@/lib/modules/documents/storage/upload.service";
import { requestReview } from "@/lib/modules/documents/versions/review.service";
import { permitSchema } from "@/lib/modules/hse/hse.schema";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import { createLeaveSchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { createBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { createFloor } from "@/lib/modules/project-structure/structure.floors";
import { createBuildingSchema, createFloorSchema, createUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { createUnit } from "@/lib/modules/project-structure/structure.units";
import { addUnitMedia, setUnitSalesPlan } from "@/lib/modules/project-structure/unit-files.service";
import { submitUnitForPublishing } from "@/lib/modules/project-structure/unit-publishing.service";
import * as qaqcInspections from "@/lib/modules/qaqc/inspections/inspection.service";
import { inspectionSchema as qaqcInspectionSchema, submitInspectionSchema as qaqcSubmitSchema } from "@/lib/modules/qaqc/qaqc.schema";
import { createOpportunitySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { createProposalSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { requestSaleApproval } from "@/lib/modules/sales/units/unit-sale-approval.service";
import { commercialDetailsSchema, reserveSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { changeSaleStatus, reserveUnit, updateCommercialDetails } from "@/lib/modules/sales/units/unit-sales.service";
import { updateSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { workLogInputSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { getTimesheet } from "@/lib/modules/timesheets/timesheet.service";
import { submitTimesheet } from "@/lib/modules/timesheets/timesheet.submission";
import { createWorkLog } from "@/lib/modules/timesheets/timesheet.worklogs";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";
import { COMPANY_A, loginRoles, SaleFixture, type Roles } from "../finance/unit-sale-fixture";

/**
 * Every Approvals Center provider, proven (AUD-10 §4, §9 — CW-02, CW-03).
 *
 * One provider's example does not prove another's (§9): each registered source
 * gets a fresh cycle made through its own module, then
 *
 *   - a refused decision (the requester deciding their own, or somebody the
 *     module bars) that changes nothing — source, cycle, activity, audit, outbox;
 *   - the positive control: the designated approver decides through the Center,
 *     and the source status, the cycle row, the activity, the audit (with this
 *     provider's own key) and the outbox each change exactly as the module's
 *     rules say — counted in the database, never read back from the service;
 *   - a conflict: deciding the closed cycle again answers "already decided" and
 *     writes nothing more.
 *
 * Expectations are written from each module's contract, not from its output.
 */

const PREFIX = "aud10b_prov";
const cleanups: Array<() => Promise<unknown>> = [];
let storageRoot: string;

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-aud10-providers-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
});

afterAll(async () => {
  for (const undo of cleanups.splice(0).reverse()) await undo();
  setStorageProvider(null);
  await rm(storageRoot, { recursive: true, force: true });
  await cleanupSessions();
  await prisma.$disconnect();
});

/** Removes everything a decision trail wrote about these records. */
async function clearTrail(entityIds: string[]) {
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: entityIds } } });
}

/* The harness --------------------------------------------------------------- */

type Cycle = { status: string; decidedByMemberId: string | null };

type Fixture = {
  /** The record the cycle decides; the trail is counted on these entity ids. */
  recordId: string;
  approvalId: string;
  trailIds: string[];
  approver: UserContext;
  /** Somebody the module refuses, and the code the Center answers them with. */
  refused: { who: UserContext; code: "FORBIDDEN"; detail?: string };
};

type Spec = {
  key: ApprovalProviderKey;
  decision: ApprovalDecision;
  make(): Promise<Fixture>;
  source(recordId: string): Promise<string>;
  cycle(approvalId: string): Promise<Cycle>;
  /** Source status before and after the decision. */
  sourceBefore: string;
  sourceAfter: string;
  cycleAfter: string;
  /** What the decision adds, by kind — nothing else may appear. */
  adds: { activity: string[]; audit: string[]; outbox: string[] };
  /** The providerKey the approval audit must carry (A7: never another source's). */
  auditProviderKey?: string;
};

type Trail = { activity: string[]; audit: string[]; outbox: string[]; auditProviders: string[] };

async function trailOf(ids: string[]): Promise<Trail> {
  const [activity, audit, outbox] = await Promise.all([
    prisma.activity.findMany({ where: { entityId: { in: ids } }, select: { action: true } }),
    prisma.auditEvent.findMany({ where: { entityId: { in: ids } }, select: { actionKey: true, changesJson: true } }),
    prisma.notificationEventOutbox.findMany({ where: { entityId: { in: ids } }, select: { eventType: true } }),
  ]);
  return {
    activity: activity.map((row) => row.action).sort(),
    audit: audit.map((row) => row.actionKey).sort(),
    outbox: outbox.map((row) => row.eventType).sort(),
    auditProviders: audit
      .filter((row) => row.actionKey.startsWith("APPROVAL_"))
      .map((row) => (row.changesJson as { providerKey?: { after?: string } } | null)?.providerKey?.after ?? "")
      .sort(),
  };
}

/** What `after` holds beyond `before`, as a sorted multiset. */
function added(before: string[], after: string[]): string[] {
  const left = [...before];
  const extra: string[] = [];
  for (const value of after) {
    const index = left.indexOf(value);
    if (index >= 0) left.splice(index, 1);
    else extra.push(value);
  }
  return extra.sort();
}

const codeOf = (error: unknown) => (error instanceof AccessError ? ((error.details as { code?: string } | undefined)?.code ?? error.code) : undefined);

async function refusal(promise: Promise<unknown>): Promise<AccessError> {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error, "expected a refusal").toBeInstanceOf(AccessError);
  return error as AccessError;
}

const waiting = (context: UserContext, provider: ApprovalProviderKey) => listApprovals(context, approvalQuerySchema.parse({ tab: "waiting", provider, limit: 100 }));

/** Whether the Center lists it as waiting for this person; no Center at all is "not offered". */
async function offeredTo(context: UserContext, provider: ApprovalProviderKey, approvalId: string): Promise<boolean> {
  try {
    return (await waiting(context, provider)).items.some((item) => item.approvalId === approvalId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "FORBIDDEN") return false;
    throw error;
  }
}
const NOTE: Record<ApprovalDecision, string | null> = { APPROVE: null, REJECT: "aud10 provider test: rejected", RETURN: "aud10 provider test: returned" };

function proves(spec: Spec) {
  describe(`${spec.key} (CW-03)`, () => {
    it("refuses a barred decider without writing anything, then lets the designated approver decide exactly once", async () => {
      const fixture = await spec.make();
      const { approvalId, recordId, approver, refused } = fixture;
      expect(await spec.source(recordId)).toBe(spec.sourceBefore);
      expect(await spec.cycle(approvalId)).toEqual({ status: "PENDING", decidedByMemberId: null });
      const start = await trailOf(fixture.trailIds);

      // The Center offers it to the approver, and not to the barred person.
      const offered = (await waiting(approver, spec.key)).items.find((item) => item.approvalId === approvalId);
      expect(offered, "waiting for the designated approver").toBeDefined();
      expect(offered![spec.decision === "APPROVE" ? "canApprove" : spec.decision === "REJECT" ? "canReject" : "canReturn"]).toBe(true);
      expect(await offeredTo(refused.who, spec.key, approvalId)).toBe(false);

      // Refused: nothing moves.
      const error = await refusal(decideApproval(refused.who, spec.key, approvalId, spec.decision, { note: NOTE[spec.decision], expectedVersion: offered!.version }));
      expect(error.code).toBe(refused.code);
      if (refused.detail) expect(codeOf(error)).toBe(refused.detail);
      expect(await spec.source(recordId)).toBe(spec.sourceBefore);
      expect(await spec.cycle(approvalId)).toEqual({ status: "PENDING", decidedByMemberId: null });
      expect(await trailOf(fixture.trailIds)).toEqual(start);

      // Positive control: the designated approver, through the Center.
      const result = await decideApproval(approver, spec.key, approvalId, spec.decision, { note: NOTE[spec.decision], expectedVersion: offered!.version });
      expect(result).toMatchObject({ outcome: spec.cycleAfter, alreadyApplied: false });
      expect(await spec.source(recordId)).toBe(spec.sourceAfter);
      expect(await spec.cycle(approvalId)).toEqual({ status: spec.cycleAfter, decidedByMemberId: approver.membershipId });
      const end = await trailOf(fixture.trailIds);
      expect(added(start.activity, end.activity)).toEqual([...spec.adds.activity].sort());
      expect(added(start.audit, end.audit)).toEqual([...spec.adds.audit].sort());
      expect(added(start.outbox, end.outbox)).toEqual([...spec.adds.outbox].sort());
      if (spec.auditProviderKey) expect(added(start.auditProviders, end.auditProviders).every((key) => key === spec.auditProviderKey)).toBe(true);

      // Source, queue and detail agree after the decision (CW-02).
      expect((await waiting(approver, spec.key)).items.some((item) => item.approvalId === approvalId)).toBe(false);
      expect((await getApprovalDetail(approver, spec.key, approvalId)).item.status).toBe(spec.cycleAfter);

      // Conflict: the closed cycle cannot be decided again, the other way, and nothing more is written.
      const other: ApprovalDecision = spec.decision !== "APPROVE" ? "APPROVE" : spec.key === "projects" ? "RETURN" : "REJECT";
      const again = await refusal(decideApproval(approver, spec.key, approvalId, other, { note: NOTE[other] ?? "aud10 again" }));
      expect(again.code).toBe("CONFLICT");
      expect(codeOf(again)).toBe("APPROVAL_ALREADY_DECIDED");
      expect(await spec.source(recordId)).toBe(spec.sourceAfter);
      expect(await trailOf(fixture.trailIds)).toEqual(end);
    });
  });
}

/* The sources ------------------------------------------------------------- */

describe("every registered provider has a spec here", () => {
  it("covers the registry", () => {
    expect(approvalProviders.all().map((provider) => provider.key).sort()).toEqual([...SPECS.map((spec) => spec.key)].sort());
  });
});

const created = { expenses: [] as string[], orders: [] as string[] };
cleanups.push(async () => {
  const ids = [...created.expenses, ...created.orders];
  if (!ids.length) return;
  await clearTrail(ids);
  const cycles = await prisma.procurementApproval.findMany({ where: { recordId: { in: created.orders } }, select: { id: true } });
  await prisma.approvalStep.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
  await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
  await prisma.financeApproval.deleteMany({ where: { recordId: { in: created.expenses } } });
  await prisma.expense.deleteMany({ where: { id: { in: created.expenses } } });
  await prisma.procurementApproval.deleteMany({ where: { recordId: { in: created.orders } } });
  await prisma.commitment.deleteMany({ where: { sourceEntityId: { in: created.orders } } });
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: created.orders } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.orders } } });
});

const cycleIn =
  (table: { findUniqueOrThrow(args: { where: { id: string }; select: { status: true; decidedByMemberId: true } }): Promise<Cycle> }) =>
  (approvalId: string) =>
    table.findUniqueOrThrow({ where: { id: approvalId }, select: { status: true, decidedByMemberId: true } });

const finance: Spec = {
  key: "finance",
  decision: "APPROVE",
  async make() {
    const accountant = await loginAs("FINANCE");
    const expense = await expenses.createExpense(
      accountant,
      createExpenseSchema.parse({ projectId: PROJECT.a, expenseDate: "2026-09-01", category: "MATERIALS", description: `${PREFIX} expense`, currency: "EUR", netAmount: "1200.00", taxAmount: "0" }),
    );
    created.expenses.push(expense.id);
    await expenses.submitExpense(accountant, expense.id);
    const approval = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: expense.id, status: "PENDING" } });
    return { recordId: expense.id, approvalId: approval.id, trailIds: [expense.id], approver: await loginAs("CEO"), refused: { who: accountant, code: "FORBIDDEN", detail: "APPROVAL_SELF_APPROVAL_BLOCKED" } };
  },
  source: async (id) => (await prisma.expense.findUniqueOrThrow({ where: { id } })).status,
  cycle: cycleIn(prisma.financeApproval as never),
  sourceBefore: "PENDING_APPROVAL",
  sourceAfter: "APPROVED",
  cycleAfter: "APPROVED",
  adds: { activity: ["FINANCE_EXPENSE_APPROVED"], audit: ["APPROVAL_APPROVED", "FINANCE_EXPENSE_APPROVED"], outbox: ["APPROVAL_APPROVED"] },
  auditProviderKey: "finance",
};

const procurement: Spec = {
  key: "procurement",
  decision: "REJECT",
  async make() {
    const pm = await loginAs("PROJECT_MANAGER");
    const order = await orders.createOrder(pm, {
      supplierId: "supplier_atlas",
      projectId: PROJECT.a,
      orderDate: new Date(),
      currency: "EUR",
      items: [{ description: `${PREFIX} gravel`, quantity: "1", unit: "lot", unitPrice: "1000", taxRate: "0.2" }],
    } as Parameters<typeof orders.createOrder>[1]);
    created.orders.push(order.id);
    await orders.submitOrder(pm, order.id);
    const approval = await prisma.procurementApproval.findFirstOrThrow({ where: { recordId: order.id, status: "PENDING" } });
    // A small order is one Procurement decision; its submitter never takes it.
    return { recordId: order.id, approvalId: approval.id, trailIds: [order.id], approver: await loginAs("PROCUREMENT"), refused: { who: pm, code: "FORBIDDEN" } };
  },
  source: async (id) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status,
  cycle: cycleIn(prisma.procurementApproval as never),
  sourceBefore: "PENDING_APPROVAL",
  sourceAfter: "REJECTED",
  cycleAfter: "REJECTED",
  adds: { activity: ["PROCUREMENT_ORDER_REJECTED"], audit: ["APPROVAL_REJECTED"], outbox: ["APPROVAL_REJECTED"] },
  auditProviderKey: "procurement",
};

/* Sales: a proposal Sales submits and a sales approver decides. */
const salesCreated = { proposals: [] as string[], opportunities: [] as string[] };
cleanups.push(async () => {
  await clearTrail([...salesCreated.proposals, ...salesCreated.opportunities]);
  await prisma.salesApproval.deleteMany({ where: { recordId: { in: salesCreated.proposals } } });
  await prisma.proposal.deleteMany({ where: { id: { in: salesCreated.proposals } } });
  await prisma.opportunity.deleteMany({ where: { id: { in: salesCreated.opportunities } } });
});

const sales: Spec = {
  key: "sales",
  decision: "APPROVE",
  async make() {
    const rep = await loginAs("SALES");
    const opportunity = await opportunities.createOpportunity(rep, createOpportunitySchema.parse({ name: `${PREFIX} opportunity`, ownerMemberId: rep.membershipId, stage: "QUALIFIED", estimatedValue: "100000", currency: "EUR", clientId: "client_acme" }));
    salesCreated.opportunities.push(opportunity.id);
    const proposal = await proposals.createProposal(
      rep,
      createProposalSchema.parse({ opportunityId: opportunity.id, proposalNumber: `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`, title: `${PREFIX} proposal`, currency: "EUR", issueDate: "2026-01-15", lineItems: [{ description: "Works", quantity: "1", unitPrice: "10000", taxRate: "20" }] }),
    );
    salesCreated.proposals.push(proposal.id);
    await proposals.submitProposal(rep, proposal.id);
    const approval = await prisma.salesApproval.findFirstOrThrow({ where: { recordId: proposal.id, status: "PENDING" } });
    // Sales submits and holds no approval grant; the CEO approves proposals.
    return { recordId: proposal.id, approvalId: approval.id, trailIds: [proposal.id], approver: await loginAs("CEO"), refused: { who: rep, code: "FORBIDDEN" } };
  },
  source: async (id) => (await prisma.proposal.findUniqueOrThrow({ where: { id } })).status,
  cycle: cycleIn(prisma.salesApproval as never),
  sourceBefore: "PENDING_APPROVAL",
  sourceAfter: "APPROVED",
  cycleAfter: "APPROVED",
  adds: { activity: ["SALES_PROPOSAL_APPROVED"], audit: ["APPROVAL_APPROVED"], outbox: ["APPROVAL_APPROVED"] },
  auditProviderKey: "sales",
};

/* Legal: a contract Legal sends for approval; the CEO returns it for revision. */
const legalCreated: string[] = [];
cleanups.push(async () => {
  await clearTrail(legalCreated);
  await prisma.contractApproval.deleteMany({ where: { recordId: { in: legalCreated } } });
  await prisma.contractObligation.deleteMany({ where: { contractId: { in: legalCreated } } });
  await prisma.contractAmendment.deleteMany({ where: { contractId: { in: legalCreated } } });
  await prisma.contractParty.deleteMany({ where: { contractId: { in: legalCreated } } });
  await prisma.contract.deleteMany({ where: { id: { in: legalCreated } } });
});

const legal: Spec = {
  key: "legal",
  decision: "RETURN",
  async make() {
    const counsel = await loginAs("LEGAL");
    const contract = await contracts.createContract(counsel, {
      contractNumber: `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${PREFIX} agreement`,
      contractType: "SERVICE_AGREEMENT",
      ownerMemberId: counsel.membershipId,
      renewalType: "NONE",
    } as Parameters<typeof contracts.createContract>[1]);
    legalCreated.push(contract.id);
    await contracts.submitForReview(counsel, contract.id);
    await contracts.submitForApproval(counsel, contract.id);
    const approval = await prisma.contractApproval.findFirstOrThrow({ where: { recordId: contract.id, status: "PENDING" } });
    // Only the Owner may decide their own; Legal may not.
    return { recordId: contract.id, approvalId: approval.id, trailIds: [contract.id], approver: await loginAs("CEO"), refused: { who: counsel, code: "FORBIDDEN" } };
  },
  source: async (id) => (await prisma.contract.findUniqueOrThrow({ where: { id } })).status,
  cycle: cycleIn(prisma.contractApproval as never),
  sourceBefore: "PENDING_APPROVAL",
  // contract.machine: return_for_revision PENDING_APPROVAL → DRAFT.
  sourceAfter: "DRAFT",
  cycleAfter: "RETURNED",
  adds: { activity: ["LEGAL_CONTRACT_RETURNED"], audit: ["APPROVAL_RETURNED"], outbox: ["APPROVAL_RETURNED"] },
  auditProviderKey: "legal",
};

/* QA/QC: an inspection QA/QC submits; nobody decides their own, the Owner approves. */
const qaqcCreated: string[] = [];
cleanups.push(async () => {
  await clearTrail(qaqcCreated);
  await prisma.qualityApproval.deleteMany({ where: { recordId: { in: qaqcCreated } } });
  await prisma.materialInspectionDecision.deleteMany({ where: { inspectionId: { in: qaqcCreated } } });
  await prisma.qualityMaterialRelease.deleteMany({ where: { inspectionId: { in: qaqcCreated } } });
  await prisma.inspectionChecklistItem.deleteMany({ where: { inspectionId: { in: qaqcCreated } } });
  await prisma.qualityInspection.deleteMany({ where: { parentInspectionId: { in: qaqcCreated } } });
  await prisma.qualityInspection.deleteMany({ where: { id: { in: qaqcCreated } } });
});

const qaqc: Spec = {
  key: "qaqc",
  decision: "APPROVE",
  async make() {
    const quality = await loginAs("QAQC");
    const inspection = await qaqcInspections.createInspection(
      quality,
      qaqcInspectionSchema.parse({ inspectionType: "WORK", templateId: "tpl_concrete", projectId: PROJECT.a, assignedInspectorMemberId: quality.membershipId }),
    );
    qaqcCreated.push(inspection.id);
    await qaqcInspections.saveChecklist(quality, inspection.id, { answers: inspection.checklist.map((item) => ({ itemId: item.id, result: "PASS" as const, responseValue: "38", note: undefined })) });
    await qaqcInspections.submitInspection(quality, inspection.id, qaqcSubmitSchema.parse({ result: "PASS" }));
    const approval = await prisma.qualityApproval.findFirstOrThrow({ where: { recordType: "INSPECTION", recordId: inspection.id, status: "PENDING" } });
    return { recordId: inspection.id, approvalId: approval.id, trailIds: [inspection.id], approver: await loginAs("OWNER"), refused: { who: quality, code: "FORBIDDEN", detail: "APPROVAL_SELF_APPROVAL_BLOCKED" } };
  },
  source: async (id) => (await prisma.qualityInspection.findUniqueOrThrow({ where: { id } })).status,
  cycle: cycleIn(prisma.qualityApproval as never),
  sourceBefore: "PENDING_APPROVAL",
  sourceAfter: "APPROVED",
  cycleAfter: "APPROVED",
  adds: { activity: ["QAQC_INSPECTION_APPROVED"], audit: ["APPROVAL_APPROVED"], outbox: ["APPROVAL_APPROVED"] },
  auditProviderKey: "qaqc",
};

/*
 * HSE: a work permit the HSE officer requested and the Project Manager submitted.
 * HSE bars the requester as well as the submitter (permit.service), so the HSE
 * officer — who holds the approval grant — is neither offered it nor counted as
 * waiting on it (A8); the Owner decides.
 */
const hseCreated: string[] = [];
cleanups.push(async () => {
  await clearTrail(hseCreated);
  await prisma.hseApproval.deleteMany({ where: { recordId: { in: hseCreated } } });
  await prisma.hseAction.deleteMany({ where: { permitId: { in: hseCreated } } });
  await prisma.hseWorkPermit.deleteMany({ where: { id: { in: hseCreated } } });
});

async function requestedPermit() {
  const officer = await loginAs("HSE");
  const pm = await loginAs("PROJECT_MANAGER");
  const permit = await permits.createPermit(
    officer,
    permitSchema.parse({ permitType: "GENERAL", title: `${PREFIX} hot works`, projectId: PROJECT.a, locationText: "Level 1", validFrom: new Date(Date.now() + 86_400_000).toISOString(), validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
  );
  hseCreated.push(permit.id);
  await permits.submitPermit(pm, permit.id);
  const approval = await prisma.hseApproval.findFirstOrThrow({ where: { recordId: permit.id, status: "PENDING" } });
  return { permitId: permit.id, approvalId: approval.id, officer, pm };
}

const hse: Spec = {
  key: "hse",
  decision: "APPROVE",
  async make() {
    const { permitId, approvalId, officer } = await requestedPermit();
    return { recordId: permitId, approvalId, trailIds: [permitId], approver: await loginAs("OWNER"), refused: { who: officer, code: "FORBIDDEN", detail: "APPROVAL_SEPARATION_OF_DUTIES" } };
  },
  source: async (id) => (await prisma.hseWorkPermit.findUniqueOrThrow({ where: { id } })).status,
  cycle: cycleIn(prisma.hseApproval as never),
  sourceBefore: "PENDING_APPROVAL",
  sourceAfter: "APPROVED",
  cycleAfter: "APPROVED",
  adds: { activity: ["HSE_PERMIT_APPROVED"], audit: ["APPROVAL_APPROVED"], outbox: ["APPROVAL_APPROVED"] },
  auditProviderKey: "hse",
};

/* HR: a leave request the Engineer submits and HR decides; the leave row is the cycle. */
const leaveCreated: string[] = [];
cleanups.push(async () => {
  await clearTrail(leaveCreated);
  await prisma.attendanceRecord.deleteMany({ where: { sourceEntityId: { in: leaveCreated } } });
  await prisma.leaveRequest.deleteMany({ where: { id: { in: leaveCreated } } });
});

const hr: Spec = {
  key: "hr",
  decision: "APPROVE",
  async make() {
    const engineer = await loginAs("ENGINEER");
    const start = new Date(Date.UTC(2028, Math.floor(Math.random() * 12), 1));
    while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1);
    const request = await leave.createLeave(engineer, createLeaveSchema.parse({ leaveType: "UNPAID", startDate: start, endDate: new Date(start.getTime() + 86_400_000), reason: `${PREFIX} appointment` }));
    leaveCreated.push(request.id);
    await leave.submitLeave(engineer, request.id);
    return { recordId: request.id, approvalId: request.id, trailIds: [request.id], approver: await loginAs("HR"), refused: { who: engineer, code: "FORBIDDEN" } };
  },
  source: async (id) => (await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status,
  async cycle(id) {
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, select: { status: true, approvedByMemberId: true, rejectedByMemberId: true } });
    return { status: row.status, decidedByMemberId: row.approvedByMemberId ?? row.rejectedByMemberId };
  },
  sourceBefore: "PENDING",
  sourceAfter: "APPROVED",
  cycleAfter: "APPROVED",
  // HR announces a decision as LEAVE_DECIDED and audits it as its own action, not through the generic approval trail.
  adds: { activity: ["HR_LEAVE_APPROVED"], audit: ["HR_LEAVE_REQUEST_APPROVED"], outbox: ["LEAVE_DECIDED"] },
};

/* Documents: a review the Project Manager asks of the Architect; the review row is the cycle. */
const documentCreated: string[] = [];
cleanups.push(async () => {
  await clearTrail(documentCreated);
  await prisma.documentReview.deleteMany({ where: { documentId: { in: documentCreated } } });
  await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: documentCreated } } });
  await prisma.document.deleteMany({ where: { id: { in: documentCreated } } });
});

const documents: Spec = {
  key: "documents",
  decision: "APPROVE",
  async make() {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    const uploaded = await attachDocumentFromBytes(
      pm,
      { name: `${PREFIX} drawing`, context: "project", projectId: PROJECT.a, fileName: "Drawing.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1],
      new TextEncoder().encode("%PDF-1.4\naud10 review fixture\n%%EOF\n"),
    );
    documentCreated.push(uploaded.documentId);
    const versionId = (await prisma.document.findUniqueOrThrow({ where: { id: uploaded.documentId } })).currentVersionId!;
    const { reviewId } = await requestReview(pm, versionId, { reviewerMemberId: architect.membershipId });
    return { recordId: uploaded.documentId, approvalId: reviewId, trailIds: [uploaded.documentId], approver: architect, refused: { who: pm, code: "FORBIDDEN", detail: "APPROVAL_SELF_APPROVAL_BLOCKED" } };
  },
  async source(documentId) {
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { currentVersionId: true } });
    return (await prisma.documentVersion.findUniqueOrThrow({ where: { id: document.currentVersionId! }, select: { reviewState: true } })).reviewState;
  },
  cycle: cycleIn(prisma.documentReview as never),
  sourceBefore: "IN_REVIEW",
  sourceAfter: "APPROVED",
  cycleAfter: "APPROVED",
  adds: { activity: ["DOCUMENT_REVIEW_APPROVED"], audit: ["DOCUMENT_REVIEW_DECIDED"], outbox: ["DOCUMENT_APPROVED"] },
};

/*
 * Timesheets: the HSE officer's week, whose designated approver is the Project
 * Manager (seeded). HR may approve timesheets in general but is not this week's
 * approver, so the Center neither lists nor lets them decide it.
 */
const timesheetCreated: string[] = [];
cleanups.push(async () => {
  const cycles = await prisma.timesheetApproval.findMany({ where: { recordId: { in: timesheetCreated } }, select: { id: true } });
  await prisma.approvalStep.deleteMany({ where: { providerKey: "timesheets", approvalId: { in: cycles.map((row) => row.id) } } });
  await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
  await prisma.timesheetApproval.deleteMany({ where: { recordId: { in: timesheetCreated } } });
  await prisma.workLog.deleteMany({ where: { timesheetId: { in: timesheetCreated } } });
  await clearTrail(timesheetCreated);
  await prisma.timesheet.deleteMany({ where: { id: { in: timesheetCreated } } });
});

async function submittedWeek() {
  const officer = await loginAs("HSE");
  const logged = await createWorkLog(officer, workLogInputSchema.parse({ workDate: localDate(new Date(), "Europe/Tirane"), workType: "PROJECT_WORK", projectId: PROJECT.a, taskId: "task_009", minutes: 480, description: `${PREFIX} entry` }));
  if (!timesheetCreated.includes(logged.timesheetId)) timesheetCreated.push(logged.timesheetId);
  const week = await getTimesheet(officer, logged.timesheetId);
  await submitTimesheet(officer, logged.timesheetId, { expectedVersion: week.version, acknowledgeShortfall: true });
  const approval = await prisma.timesheetApproval.findFirstOrThrow({ where: { recordId: logged.timesheetId, status: "PENDING" } });
  return { timesheetId: logged.timesheetId, approvalId: approval.id, officer };
}

const timesheets: Spec = {
  key: "timesheets",
  decision: "RETURN",
  async make() {
    const { timesheetId, approvalId } = await submittedWeek();
    return { recordId: timesheetId, approvalId, trailIds: [timesheetId], approver: await loginAs("PROJECT_MANAGER"), refused: { who: await loginAs("HR"), code: "FORBIDDEN", detail: "APPROVAL_NOT_CURRENT_APPROVER" } };
  },
  source: async (id) => (await prisma.timesheet.findUniqueOrThrow({ where: { id } })).status,
  cycle: cycleIn(prisma.timesheetApproval as never),
  sourceBefore: "SUBMITTED",
  sourceAfter: "RETURNED",
  cycleAfter: "RETURNED",
  adds: { activity: ["TIMESHEET_RETURNED"], audit: ["TIMESHEET_RETURNED"], outbox: ["TIMESHEET_RETURNED"] },
};

/*
 * Unit publishing: a complete unit the Architect submits on a project this file
 * builds for itself; the Architecture head publishes it. The Architect holds no
 * publish grant, so is refused.
 */
const MARINA = "aud10b_marina";
const UNIT_PREFIX = "AUD10B";
const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n${label}\n%%EOF\n`);
const png = async () => new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: 40, g: 120, b: 160 } } }).png().toBuffer());

async function removeMarina() {
  const buildings = await prisma.projectBuilding.findMany({ where: { projectId: MARINA }, select: { id: true } });
  const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildings.map((row) => row.id) } }, select: { id: true } });
  const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floors.map((row) => row.id) } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  const requests = await prisma.unitPublicationApproval.findMany({ where: { recordId: { in: unitIds } }, select: { id: true } });
  await prisma.unitPublicationApproval.deleteMany({ where: { recordId: { in: unitIds } } });
  await prisma.unitMedia.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitDocumentLink.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.projectUnit.updateMany({ where: { id: { in: unitIds } }, data: { currentPublicationId: null, salesPlanDocumentId: null } });
  await prisma.unitPublication.deleteMany({ where: { unitId: { in: unitIds } } });
  const documents = await prisma.document.findMany({ where: { OR: [{ entityType: "project_unit", entityId: { in: unitIds } }, { name: { startsWith: UNIT_PREFIX } }] }, select: { id: true } });
  const documentIds = documents.map((row) => row.id);
  // What the A7 test sells on the unit: its sale request, reservation, commercial profile, client and deal.
  await prisma.unitSaleApproval.deleteMany({ where: { recordId: { in: unitIds } } });
  const reservations = await prisma.unitReservation.findMany({ where: { unitId: { in: unitIds } }, select: { id: true } });
  await prisma.unitReservationExtension.deleteMany({ where: { reservationId: { in: reservations.map((row) => row.id) } } });
  await prisma.unitReservation.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.opportunityUnit.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitPriceHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialProfile.deleteMany({ where: { unitId: { in: unitIds } } });
  const deals = await prisma.opportunity.findMany({ where: { companyId: COMPANY.a, name: { startsWith: UNIT_PREFIX } }, select: { id: true } });
  const clients = await prisma.client.findMany({ where: { companyId: COMPANY.a, name: { startsWith: UNIT_PREFIX } }, select: { id: true } });
  await clearTrail([...unitIds, ...documentIds, ...requests.map((row) => row.id), ...buildings.map((row) => row.id), ...floors.map((row) => row.id), MARINA, ...deals.map((row) => row.id), ...clients.map((row) => row.id)]);
  await prisma.opportunity.deleteMany({ where: { id: { in: deals.map((row) => row.id) } } });
  await prisma.contact.deleteMany({ where: { clientId: { in: clients.map((row) => row.id) } } });
  await prisma.client.deleteMany({ where: { id: { in: clients.map((row) => row.id) } } });
  await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: documentIds } } });
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.projectFloor.deleteMany({ where: { id: { in: floors.map((row) => row.id) } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: buildings.map((row) => row.id) } } });
  await prisma.projectMember.deleteMany({ where: { projectId: MARINA } });
  await prisma.project.deleteMany({ where: { id: MARINA } });
}
cleanups.push(removeMarina);

async function uploadToUnit(context: UserContext, unitId: string, name: string, fileName: string, mimeType: string, bytes: Uint8Array) {
  const result = await attachDocumentFromBytes(context, { name: `${UNIT_PREFIX} ${name}`, context: "record", entityType: "project_unit", entityId: unitId, fileName, mimeType } as Parameters<typeof attachDocumentFromBytes>[1], bytes);
  return result.documentId;
}

/** A complete unit the Architect has submitted for publishing, on a project of its own. */
async function submittedUnit() {
  setFileScanner(null);
  const [owner, architect, rep] = await Promise.all([loginAs("OWNER"), loginAs("ARCHITECT"), loginAs("SALES")]);
  await removeMarina();
  await prisma.project.create({ data: { id: MARINA, companyId: COMPANY.a, code: "AUD10B-MARINA", name: "AUD10 Marina", status: "ACTIVE", projectManagerMemberId: owner.membershipId, createdBy: "test" } });
  await prisma.projectMember.createMany({ data: [owner.membershipId, architect.membershipId, rep.membershipId].map((companyMemberId) => ({ companyId: COMPANY.a, projectId: MARINA, companyMemberId, status: "ACTIVE" as const })) });
  const building = await createBuilding(owner, MARINA, createBuildingSchema.parse({ name: `${UNIT_PREFIX} Block` }));
  const floor = await createFloor(owner, building.id, createFloorSchema.parse({ number: 3, name: "Floor 3", levelType: "STANDARD" }));
  const apartment = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY.a, code: "APARTMENT" }, select: { id: true } })).id;
  const unitId = (await createUnit(owner, floor.id, createUnitSchema.parse({ unitCode: `${UNIT_PREFIX}-101`, unitTypeId: apartment, saleableArea: "113.00", internalArea: "92.40", bedrooms: 2, bathrooms: 2, rooms: 3, orientation: "SW", position: "CORNER" }))).id;
  const plan = await uploadToUnit(architect, unitId, "sales plan", "Sales plan.pdf", "application/pdf", pdf("aud10"));
  await setUnitSalesPlan(architect, unitId, { documentId: plan });
  const image = await uploadToUnit(architect, unitId, "render", "Render.png", "image/png", await png());
  await addUnitMedia(architect, unitId, { documentId: image, category: "INTERIOR_RENDER", caption: null });
  const version = (await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { version: true } })).version;
  await submitUnitForPublishing(architect, unitId, { expectedVersion: version });
  const approval = await prisma.unitPublicationApproval.findFirstOrThrow({ where: { recordId: unitId, status: "PENDING" } });
  return { unitId, approvalId: approval.id, owner, architect, rep };
}

const projects: Spec = {
  key: "projects",
  decision: "APPROVE",
  async make() {
    const { unitId, approvalId, architect } = await submittedUnit();
    return { recordId: unitId, approvalId, trailIds: [unitId], approver: await loginAsEmail(DEMO_EMAIL.architectureHead), refused: { who: architect, code: "FORBIDDEN" } };
  },
  source: async (id) => (await prisma.projectUnit.findUniqueOrThrow({ where: { id } })).publicationStatus,
  cycle: cycleIn(prisma.unitPublicationApproval as never),
  sourceBefore: "READY_FOR_PUBLISHING",
  sourceAfter: "PUBLISHED",
  cycleAfter: "APPROVED",
  // publishUnit: the publication audit, and the request's decision through the shared approval trail.
  adds: { activity: ["UNIT_PUBLISHED"], audit: ["APPROVAL_APPROVED", "PROJECT_UNIT_PUBLISHED"], outbox: ["APPROVAL_APPROVED"] },
  auditProviderKey: "projects",
};

/*
 * Unit sales: where the company's Sold rule is Manual approval, Sales asks for a
 * reservation's sale to be approved and the Sales head decides. Its approval
 * audit names the unit-sales source, not unit publishing's (A7).
 */
let roles: Roles | null = null;
const saleFixture = new SaleFixture("A10SALE", () => roles!);
let savedSoldRule: { unitSoldRule: string; unitReservationDays: number } | null = null;
cleanups.push(async () => {
  if (!roles) return;
  await saleFixture.cleanup();
  if (savedSoldRule) await prisma.companySettings.update({ where: { companyId: COMPANY_A }, data: savedSoldRule as never });
});

/** The company's Sold rule set to Manual approval for this file, restored after it. */
async function manualApproval(): Promise<Roles> {
  if (!roles) {
    roles = await loginRoles();
    await saleFixture.setUp();
    const settings = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: COMPANY_A }, select: { unitSoldRule: true, unitReservationDays: true } });
    savedSoldRule = settings as never;
    await updateSalesSettings(roles.owner, { unitReservationDays: settings.unitReservationDays, unitSoldRule: "MANUAL_APPROVAL" });
  }
  return roles;
}

async function requestedSale() {
  const people = await manualApproval();
  const unit = await saleFixture.reserved();
  const { approvalId } = await requestSaleApproval(people.sales, unit.id, { note: `${PREFIX} buyer signed` });
  return { unitId: unit.id, approvalId, roles: people };
}

const unitSales: Spec = {
  key: "unit_sales",
  decision: "APPROVE",
  async make() {
    const { unitId, approvalId, roles: people } = await requestedSale();
    return { recordId: unitId, approvalId, trailIds: [unitId], approver: people.manager, refused: { who: people.sales, code: "FORBIDDEN" } };
  },
  source: async (id) => (await prisma.unitCommercialProfile.findUniqueOrThrow({ where: { unitId: id } })).status,
  cycle: cycleIn(prisma.unitSaleApproval as never),
  // Approving unlocks Mark Sold; the unit stays reserved until somebody marks it (E-05F §42).
  sourceBefore: "RESERVED",
  sourceAfter: "RESERVED",
  cycleAfter: "APPROVED",
  adds: { activity: ["UNIT_SALE_APPROVED"], audit: ["APPROVAL_APPROVED", "UNIT_SALE_APPROVAL_DECIDED"], outbox: ["APPROVAL_APPROVED"] },
  auditProviderKey: "unit_sales",
};

const SPECS: Spec[] = [finance, procurement, sales, legal, qaqc, hse, hr, documents, timesheets, projects, unitSales];

for (const spec of SPECS) proves(spec);

/* A7 — two sources on one record ---------------------------------------- */

describe("a unit's publishing and its sale are two sources on one record (A7)", () => {
  it("opens the cycle a link is about — the pending sale, or the named source — and audits the sale under its own source", async () => {
    const { unitId, approvalId: publishingId } = await submittedUnit();
    const people = await manualApproval();
    const head = await loginAsEmail(DEMO_EMAIL.architectureHead);
    await decideApproval(head, "projects", publishingId, "APPROVE", { note: null });
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: unitId } })).publicationStatus).toBe("PUBLISHED");

    // Sales puts the published unit on sale, reserves it and asks for the sale to be approved.
    await updateCommercialDetails(people.sales, unitId, commercialDetailsSchema.parse({ askingPrice: "310000.00", currency: "EUR", priceBasis: "SALEABLE_AREA" }));
    await changeSaleStatus(people.sales, unitId, { action: "put_on_sale", reason: null });
    await reserveUnit(people.sales, unitId, reserveSchema.parse({ newClient: { name: `${UNIT_PREFIX} Buyer`, type: "INDIVIDUAL", acceptDuplicate: true }, newDeal: { name: `${UNIT_PREFIX} Deal` }, agreedPrice: "300000.00" }));
    const { approvalId: saleId } = await requestSaleApproval(people.sales, unitId, { note: `${PREFIX} offer signed` });

    // Both sources claim project_unit; the link lands on what waits on this reader, not the first source registered.
    const owner = await loginAs("OWNER");
    expect(await findApprovalForRecord(owner, "project_unit", unitId)).toBe(`unit_sales:${saleId}`);
    // A link that names its source opens that source's cycle.
    expect(await findApprovalForRecord(owner, "project_unit", unitId, { providerKey: "projects" })).toBe(`projects:${publishingId}`);
    expect(await findApprovalForRecord(owner, "project_unit", unitId, { providerKey: "unit_sales" })).toBe(`unit_sales:${saleId}`);
    // Positive control: a reader with no sale approval to open still reaches the publishing cycle.
    expect(await findApprovalForRecord(head, "project_unit", unitId, { providerKey: "projects" })).toBe(`projects:${publishingId}`);

    // The sale's request audit names the unit-sales source (before AUD-10 it said "projects").
    const requested = await prisma.auditEvent.findMany({ where: { entityId: unitId, actionKey: "APPROVAL_REQUEST_CREATED" }, select: { changesJson: true } });
    const keys = requested.map((row) => (row.changesJson as { providerKey?: { after?: string } }).providerKey?.after).sort();
    expect(keys).toEqual(["projects", "unit_sales"]);
    const outbox = await prisma.notificationEventOutbox.findFirstOrThrow({ where: { entityId: unitId, eventType: "APPROVAL_REQUESTED", payloadJson: { path: ["recordLabel"], equals: "Unit sale" } } });
    expect((outbox.payloadJson as { providerKey?: string }).providerKey).toBe("unit_sales");
  });
});

/* A8 — the Center's eligibility is the module's --------------------------- */

describe("HSE separation of duties in the Center (A8)", () => {
  it("never counts or offers a permit to its requester, and says why; the Owner is offered it", async () => {
    const { approvalId, officer } = await requestedPermit();
    const owner = await loginAs("OWNER");
    const counts = await getApprovalCounts(officer);
    const list = await waiting(officer, "hse");
    expect(list.items.some((item) => item.approvalId === approvalId)).toBe(false);
    expect(counts.waiting).toBe((await listApprovals(officer, approvalQuerySchema.parse({ tab: "waiting", limit: 100 }))).items.length);
    const seen = await getApprovalDetail(officer, "hse", approvalId);
    expect(seen.item).toMatchObject({ canApprove: false, canReject: false, blockedReason: "You requested this permit, so somebody else decides it." });
    // Positive control.
    expect((await getApprovalDetail(owner, "hse", approvalId)).item).toMatchObject({ canApprove: true, canReject: true, blockedReason: null });
  });
});

/* A11 — each timesheet decision is its own grant ------------------------- */

describe("timesheet decisions follow their own grants (A11)", () => {
  it("offers only the decisions the timesheet service accepts: no Reject without its grant, nothing without Approve", async () => {
    const { approvalId, timesheetId } = await submittedWeek();
    const pm = await loginAs("PROJECT_MANAGER");
    const item = async (context: UserContext) => (await getApprovalDetail(context, "timesheets", approvalId)).item;
    const without = (...grants: string[]): UserContext => ({ ...pm, permissions: pm.permissions.filter((permission) => !grants.includes(permission)) });

    // Positive control: the designated approver with all three grants.
    expect(await item(pm)).toMatchObject({ canApprove: true, canReject: true, canReturn: true });

    // Approve and Return, but not Reject: before AUD-10 the Center offered Reject, which the service refuses.
    const noReject = without("timesheet.reject");
    expect(await item(noReject)).toMatchObject({ canApprove: true, canReject: false, canReturn: true });
    const refused = await refusal(decideApproval(noReject, "timesheets", approvalId, "REJECT", { note: "aud10 not mine to reject" }));
    expect(refused.code).toBe("FORBIDDEN");
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheetId } })).status).toBe("SUBMITTED");

    // The step itself names the approve grant (a designated approver must hold it), so without it
    // the service refuses every decision — and the Center neither offers nor counts it.
    const returnOnly = without("timesheet.reject", "timesheet.approve");
    expect(await item(returnOnly)).toMatchObject({ canApprove: false, canReject: false, canReturn: false });
    expect(await offeredTo(returnOnly, "timesheets", approvalId)).toBe(false);

    // Return, by the approver who may.
    await expect(decideApproval(noReject, "timesheets", approvalId, "RETURN", { note: "aud10 split the hours by task" })).resolves.toMatchObject({ outcome: "RETURNED" });
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheetId } })).status).toBe("RETURNED");
    expect((await prisma.timesheetApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe("RETURNED");
  });
});
