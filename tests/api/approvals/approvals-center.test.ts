import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { runWithRequestContext } from "@/lib/core/observability/request-context";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { openNotification } from "@/lib/core/notifications/notification.service";
import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider } from "@/lib/core/storage/storage-provider.factory";
import { createDelegation, listDelegations, revokeDelegation } from "@/lib/modules/approvals/approvals.delegation";
import { approvalDocuments } from "@/lib/modules/approvals/approvals.documents";
import { remindOverdueApprovals } from "@/lib/modules/approvals/approvals.overdue";
import type { ApprovalProvider } from "@/lib/modules/approvals/approvals.provider";
import { approvalProviders, createApprovalRegistry } from "@/lib/modules/approvals/approvals.registry";
import { approvalQuerySchema, createDelegationSchema, reasonInputSchema } from "@/lib/modules/approvals/approvals.schema";
import { decideApproval, findApprovalForRecord, getApprovalCounts, getApprovalDetail, listApprovals } from "@/lib/modules/approvals/approvals.service";
import type { ApprovalTab, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import { attachDocumentFromBytes } from "@/lib/modules/documents/storage/upload.service";
import { reassignReview, requestReview } from "@/lib/modules/documents/versions/review.service";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { createExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import { createLeaveSchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import { cleanupSessions, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * The Unified Approvals Center, against the real database (PRD #41 §259-§300).
 *
 * Every fixture is created through the owning module's own service, and every
 * decision goes through the Center exactly as the API routes send it — so a
 * pass here says the modules stayed authoritative: the Center never wrote a
 * status, and every refusal came from the module or the Center's own access
 * rules.
 */

const PREFIX = "APRTEST";
const created = { expenses: [] as string[], orders: [] as string[], amendments: [] as string[], leave: [] as string[], documents: [] as string[], delegations: [] as string[] };
let storageRoot: string;

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-approvals-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
});

afterEach(async () => {
  const records = [...created.expenses, ...created.orders, ...created.amendments, ...created.leave, ...created.documents];
  if (created.delegations.length) await prisma.approvalDelegation.deleteMany({ where: { id: { in: created.delegations } } });
  if (records.length) {
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: records } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: records } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: records } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: records } } });
  }
  if (created.expenses.length) {
    await prisma.financeApproval.deleteMany({ where: { recordId: { in: created.expenses } } });
    await prisma.expense.deleteMany({ where: { id: { in: created.expenses } } });
  }
  if (created.orders.length) {
    const cycles = await prisma.procurementApproval.findMany({ where: { recordId: { in: created.orders } }, select: { id: true } });
    await prisma.approvalStep.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
    await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
    await prisma.procurementApproval.deleteMany({ where: { recordId: { in: created.orders } } });
    await prisma.commitment.deleteMany({ where: { sourceEntityId: { in: created.orders } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: created.orders } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.orders } } });
  }
  if (created.amendments.length) {
    await prisma.contractApproval.deleteMany({ where: { recordId: { in: created.amendments } } });
    for (const amendmentId of created.amendments) {
      await prisma.activity.deleteMany({ where: { entityId: "contract_005", metadata: { path: ["amendmentId"], equals: amendmentId } } });
    }
    await prisma.contractAmendment.deleteMany({ where: { id: { in: created.amendments } } });
  }
  if (created.leave.length) {
    await prisma.attendanceRecord.deleteMany({ where: { sourceEntityId: { in: created.leave } } });
    await prisma.leaveRequest.deleteMany({ where: { id: { in: created.leave } } });
  }
  if (created.documents.length) {
    await prisma.documentReview.deleteMany({ where: { documentId: { in: created.documents } } });
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: created.documents } } });
    await prisma.document.deleteMany({ where: { id: { in: created.documents } } });
  }
  for (const list of Object.values(created)) list.length = 0;
});

afterAll(async () => {
  setStorageProvider(null);
  await rm(storageRoot, { recursive: true, force: true });
  await cleanupSessions();
  await prisma.$disconnect();
});

/* Fixtures ------------------------------------------------------------------ */

const query = (input: Record<string, unknown> = {}) => approvalQuerySchema.parse(input);

async function queue(context: UserContext, tab: ApprovalTab, extra: Record<string, unknown> = {}) {
  return listApprovals(context, query({ tab, limit: 100, ...extra }));
}

async function expectCode(promise: Promise<unknown>, code: string, detailCode?: string) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected ${code}${detailCode ? `/${detailCode}` : ""}`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (detailCode) expect(((error as AccessError).details as { code?: string })?.code).toBe(detailCode);
}

/** An expense Finance raises and submits: somebody else has to decide it. */
async function submittedExpense(netAmount = "1200.00") {
  const finance = await loginAs("FINANCE");
  const expense = await expenses.createExpense(
    finance,
    createExpenseSchema.parse({ projectId: PROJECT.a, expenseDate: "2026-09-01", category: "MATERIALS", description: `${PREFIX} scaffold hire`, currency: "EUR", netAmount, taxAmount: "0" }),
  );
  created.expenses.push(expense.id);
  await expenses.submitExpense(finance, expense.id);
  const approval = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: expense.id, status: "PENDING" } });
  return { expenseId: expense.id, approvalId: approval.id };
}

/** A purchase order large enough for the full chain under the seeded policy (25k / 75k). */
async function chainOrder(unitPrice = "68000") {
  const pm = await loginAs("PROJECT_MANAGER");
  const order = await orders.createOrder(pm, {
    supplierId: "supplier_atlas",
    projectId: PROJECT.a,
    orderDate: new Date(),
    currency: "EUR",
    items: [{ description: `${PREFIX} steel`, quantity: "1", unit: "lot", unitPrice, taxRate: "0.2" }],
  } as Parameters<typeof orders.createOrder>[1]);
  created.orders.push(order.id);
  await orders.submitOrder(pm, order.id);
  const approval = await prisma.procurementApproval.findFirstOrThrow({ where: { recordId: order.id, status: "PENDING" } });
  return { orderId: order.id, approvalId: approval.id, pm };
}

const has = (items: UnifiedApprovalItem[], approvalId: string) => items.some((item) => item.approvalId === approvalId);

/* Registry and access ------------------------------------------------------ */

describe("registry (§10, §240)", () => {
  it("registers the eight sources and refuses any key it does not know", async () => {
    expect(approvalProviders.all().map((provider) => provider.key).sort()).toEqual(["documents", "finance", "hr", "hse", "legal", "procurement", "qaqc", "sales"]);
    expect(() => approvalProviders.getProvider("../finance")).toThrow(AccessError);
    const owner = await loginAs("OWNER");
    await expectCode(getApprovalDetail(owner, "workflow", "anything"), "NOT_FOUND", "APPROVAL_PROVIDER_UNKNOWN");
    await expectCode(decideApproval(owner, "finance' OR 1=1", "x", "APPROVE", { note: null }), "NOT_FOUND", "APPROVAL_PROVIDER_UNKNOWN");
  });

  it("refuses the Viewer the Center entirely, and gives no role a global approve grant (§134, §150)", async () => {
    const viewer = await loginAs("VIEWER");
    await expectCode(listApprovals(viewer, query()), "FORBIDDEN");
    const owner = await loginAs("OWNER");
    expect(owner.permissions.filter((permission) => permission.startsWith("approvals.")).sort()).toEqual(["approvals.delegation.manage", "approvals.history.view", "approvals.view"]);
  });
});

describe("queue (§114, §192, §253)", () => {
  it("counts exactly what waits, from the same providers as the list", async () => {
    const ceo = await loginAs("CEO");
    const [waiting, counts] = await Promise.all([queue(ceo, "waiting"), getApprovalCounts(ceo)]);
    expect(counts.waiting).toBe(waiting.items.length);
    expect(counts.overdue).toBe(waiting.items.filter((item) => item.dueState === "overdue").length);
    expect(waiting.items.every((item) => item.status === "PENDING" && (item.canApprove || item.canReject))).toBe(true);
  });

  it("pages history with a cursor that neither repeats nor skips an item", async () => {
    const owner = await loginAs("OWNER");
    const all = (await listApprovals(owner, query({ tab: "history", limit: 60 }))).items.map((item) => item.id);
    const paged: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 12; page += 1) {
      const result = await listApprovals(owner, query({ tab: "history", limit: 5, cursor }));
      paged.push(...result.items.map((item) => item.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toEqual(all.slice(0, paged.length));
    expect(paged.length).toBeGreaterThanOrEqual(Math.min(all.length, 60));
  });

  it("reads every tab and status filter from every source without a source failing", async () => {
    const owner = await loginAs("OWNER");
    for (const tab of ["waiting", "requested", "approved", "rejected", "returned", "history"] as const) {
      expect((await queue(owner, tab)).failedProviders, tab).toEqual([]);
    }
    for (const status of ["PENDING", "APPROVED", "REJECTED", "RETURNED", "CANCELLED", "EXPIRED"]) {
      expect((await queue(owner, "history", { status })).failedProviders, status).toEqual([]);
    }
  });

  it("orders waiting items by urgency, deterministically", async () => {
    const owner = await loginAs("OWNER");
    const first = (await queue(owner, "waiting")).items.map((item) => item.id);
    const second = (await queue(owner, "waiting")).items.map((item) => item.id);
    expect(second).toEqual(first);
    const urgencies = (await queue(owner, "waiting")).items.map((item) => item.urgency);
    expect(urgencies).toEqual([...urgencies].sort((a, b) => b - a));
  });

  it("filters by source, search, project and amount", async () => {
    const { approvalId } = await submittedExpense("33333.00");
    const ceo = await loginAs("CEO");
    expect(has((await queue(ceo, "waiting", { provider: "finance" })).items, approvalId)).toBe(true);
    expect(has((await queue(ceo, "waiting", { provider: "procurement" })).items, approvalId)).toBe(false);
    expect(has((await queue(ceo, "waiting", { q: `${PREFIX} scaffold` })).items, approvalId)).toBe(true);
    expect(has((await queue(ceo, "waiting", { q: "nothing-like-this" })).items, approvalId)).toBe(false);
    expect(has((await queue(ceo, "waiting", { projectId: PROJECT.b })).items, approvalId)).toBe(false);
    expect(has((await queue(ceo, "waiting", { amountMin: "30000", amountMax: "40000" })).items, approvalId)).toBe(true);
    expect(has((await queue(ceo, "waiting", { amountMin: "40000" })).items, approvalId)).toBe(false);
  });

  it("isolates a failing source: the rest loads, and nothing is counted for it (§130, §201)", async () => {
    const failing: ApprovalProvider = { ...approvalProviders.getProvider("sales"), key: "sales", queue: async () => Promise.reject(new Error("boom")) };
    const registry = createApprovalRegistry([...approvalProviders.all().filter((provider) => provider.key !== "sales"), failing]);
    const ceo = await loginAs("CEO");
    const result = await listApprovals(ceo, query({ tab: "waiting" }), { registry });
    expect(result.failedProviders.map((provider) => provider.key)).toEqual(["sales"]);
    expect(result.items.some((item) => item.providerKey === "sales")).toBe(false);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("hides a switched-off module's approvals and refuses to decide them (§232, §272)", async () => {
    const { approvalId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    const off: UserContext = {
      ...ceo,
      moduleAccess: { ...ceo.moduleAccess, finance: { ...ceo.moduleAccess.finance, enabled: false } },
      enabledModules: ceo.enabledModules.filter((key) => key !== "finance"),
    };
    expect((await queue(off, "waiting")).items.some((item) => item.providerKey === "finance")).toBe(false);
    await expectCode(getApprovalDetail(off, "finance", approvalId), "FORBIDDEN", "APPROVAL_PROVIDER_UNAVAILABLE");
    await expectCode(decideApproval(off, "finance", approvalId, "APPROVE", { note: null }), "FORBIDDEN", "APPROVAL_PROVIDER_UNAVAILABLE");
    expect((await prisma.financeApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe("PENDING");
  });

  it("never shows, opens or decides another company's approval (§239, §283)", async () => {
    const { approvalId, expenseId } = await submittedExpense();
    const ownerB = await loginAsEmail("owner-b@nesto.test");
    for (const tab of ["waiting", "history", "requested"] as const) {
      expect((await queue(ownerB, tab)).items.some((item) => item.approvalId === approvalId || item.sourceId === expenseId)).toBe(false);
    }
    // Not found — or, where Company B has Finance switched off, not available: never Company A's record.
    for (const attempt of [getApprovalDetail(ownerB, "finance", approvalId), decideApproval(ownerB, "finance", approvalId, "APPROVE", { note: null })]) {
      const error = await attempt.then(() => null, (reason: unknown) => reason);
      expect(error).toBeInstanceOf(AccessError);
      expect(["NOT_FOUND", "FORBIDDEN"]).toContain((error as AccessError).code);
    }
    expect((await prisma.financeApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe("PENDING");
    expect(await findApprovalForRecord(ownerB, "expense", expenseId)).toBeNull();
  });
});

/* Finance ------------------------------------------------------------------ */

describe("finance (§261, §266, §280)", () => {
  it("blocks the requester, lets an approver reject with a reason, and tells the requester", async () => {
    const { approvalId, expenseId } = await submittedExpense();
    const finance = await loginAs("FINANCE");
    const ceo = await loginAs("CEO");

    expect(has((await queue(finance, "waiting")).items, approvalId)).toBe(false);
    expect((await queue(finance, "requested")).items.find((item) => item.approvalId === approvalId)?.blockedReason).toMatch(/somebody else/);
    await expectCode(decideApproval(finance, "finance", approvalId, "APPROVE", { note: null }), "FORBIDDEN", "APPROVAL_SELF_APPROVAL_BLOCKED");

    expect(has((await queue(ceo, "waiting")).items, approvalId)).toBe(true);
    expect(reasonInputSchema.safeParse({ note: "  " }).success).toBe(false);

    const result = await decideApproval(ceo, "finance", approvalId, "REJECT", { note: "Hire rate is above the framework price." });
    expect(result).toMatchObject({ outcome: "REJECTED", alreadyApplied: false });
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("REJECTED");

    expect(await prisma.notificationEventOutbox.count({ where: { entityId: expenseId, eventType: "APPROVAL_REJECTED" } })).toBe(1);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: expenseId, actionKey: "APPROVAL_REJECTED" }, orderBy: { occurredAt: "desc" } });
    expect(audit).not.toBeNull();

    expect(has((await queue(ceo, "rejected")).items, approvalId)).toBe(true);
    expect(has((await queue(ceo, "waiting")).items, approvalId)).toBe(false);

    // The same person repeating the same decision is answered, not decided twice (§124).
    expect(await decideApproval(ceo, "finance", approvalId, "REJECT", { note: "again" })).toMatchObject({ outcome: "REJECTED", alreadyApplied: true });
    await expectCode(decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }), "CONFLICT", "APPROVAL_ALREADY_DECIDED");
  });

  it("returns an expense to draft; resubmitting it is a new cycle and the stale review is refused", async () => {
    const { approvalId, expenseId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    const finance = await loginAs("FINANCE");

    expect(await decideApproval(ceo, "finance", approvalId, "RETURN", { note: "Attach the hire agreement." })).toMatchObject({ outcome: "RETURNED" });
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("DRAFT");
    expect(has((await queue(finance, "returned", { returned: "to" })).items, approvalId)).toBe(true);

    await expenses.submitExpense(finance, expenseId);
    // The old drawer, still open on the returned cycle.
    await expectCode(decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }), "CONFLICT", "APPROVAL_SOURCE_CHANGED");

    const fresh = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: expenseId, status: "PENDING" } });
    const detail = await getApprovalDetail(ceo, "finance", fresh.id);
    expect(detail.history.map((entry) => entry.action)).toEqual(["Requested", "Returned for revision", "Resubmitted", "Awaiting decision"]);
  });

  it("replays an idempotent retry, and refuses the key for a different decision (§123)", async () => {
    const { approvalId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    const key = `apr_${Date.now()}_retry`;
    const first = await decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }, { idempotencyKey: key });
    const retry = await decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }, { idempotencyKey: key });
    expect(first).toMatchObject({ outcome: "APPROVED", alreadyApplied: false });
    expect(retry).toMatchObject({ outcome: "APPROVED", alreadyApplied: true });
    await expectCode(decideApproval(ceo, "finance", approvalId, "REJECT", { note: "x" }, { idempotencyKey: key }), "CONFLICT", "APPROVAL_IDEMPOTENCY_KEY_REUSED");
    await prisma.approvalDecisionReceipt.deleteMany({ where: { idempotencyKey: key } });
  });

  it("settles a race between two approvers once (§125, §269)", async () => {
    const { approvalId, expenseId } = await submittedExpense();
    const [ceo, owner] = await Promise.all([loginAs("CEO"), loginAs("OWNER")]);
    const outcomes = await Promise.allSettled([
      decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }),
      decideApproval(owner, "finance", approvalId, "REJECT", { note: "Race" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const status = (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).status;
    expect(["APPROVED", "REJECTED"]).toContain(status);
    expect(await prisma.financeApproval.count({ where: { recordId: expenseId, status: { in: ["APPROVED", "REJECTED"] } } })).toBe(1);
  });

  it("links approval notifications and attention to the Center's drawer (§42, §227, §277)", async () => {
    const { approvalId, expenseId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    await reconcileAttention({ companyId: ceo.companyId });
    const item = await prisma.attentionItem.findFirst({ where: { recipientMemberId: ceo.membershipId, entityId: expenseId, conditionKey: "PENDING_APPROVAL", status: "ACTIVE" } });
    expect(item).not.toBeNull();

    await dispatchNotifications(500);
    const notification = await prisma.notification.findFirstOrThrow({ where: { recipientMemberId: ceo.membershipId, entityId: expenseId, eventType: "APPROVAL_REQUESTED" } });
    const opened = await openNotification(ceo, notification.id);
    expect(opened).toEqual({ href: `/approvals?record=${encodeURIComponent(`expense:${expenseId}`)}` });
    expect(await findApprovalForRecord(ceo, "expense", expenseId)).toBe(`finance:${approvalId}`);

    await decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null });
    expect((await prisma.attentionItem.findUniqueOrThrow({ where: { id: item!.id } })).status).toBe("RESOLVED");
  });

  it("carries one correlation id through the decision's audit and outbox (§229)", async () => {
    const { approvalId, expenseId } = await submittedExpense();
    const ceo = await loginAs("CEO");
    const correlationId = `corr_${"a".repeat(24)}`;
    await runWithRequestContext({ requestId: `req_${"b".repeat(24)}`, correlationId, startedAt: Date.now() }, () =>
      decideApproval(ceo, "finance", approvalId, "APPROVE", { note: null }),
    );
    const outbox = await prisma.notificationEventOutbox.findFirstOrThrow({ where: { entityId: expenseId, eventType: "APPROVAL_APPROVED" } });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: expenseId, actionKey: "APPROVAL_APPROVED" } });
    expect(outbox.correlationId).toBe(correlationId);
    expect(audit.correlationId).toBe(correlationId);
  });
});

/* Procurement chain -------------------------------------------------------- */

describe("purchase order chain (§21, §27, §262, §267)", () => {
  it("walks Procurement → Finance → CEO, with only the current step actionable", async () => {
    const { orderId, approvalId, pm } = await chainOrder();
    const [procurement, finance, ceo] = await Promise.all([loginAs("PROCUREMENT"), loginAs("FINANCE"), loginAs("CEO")]);
    const steps = await prisma.approvalStep.findMany({ where: { approvalId }, orderBy: { stepNumber: "asc" } });
    expect(steps.map((step) => step.label)).toEqual(["Procurement", "Finance", "Executive"]);

    expect(has((await queue(procurement, "waiting")).items, approvalId)).toBe(true);
    expect(has((await queue(finance, "waiting")).items, approvalId)).toBe(false);
    expect(has((await queue(ceo, "waiting")).items, approvalId)).toBe(false);
    await expectCode(decideApproval(finance, "procurement", approvalId, "APPROVE", { note: null }), "FORBIDDEN", "APPROVAL_NOT_CURRENT_APPROVER");
    await expectCode(decideApproval(pm, "procurement", approvalId, "APPROVE", { note: null }), "FORBIDDEN");

    expect(await decideApproval(procurement, "procurement", approvalId, "APPROVE", { note: "Best compliant bid.", expectedVersion: 1 })).toMatchObject({ outcome: "STEP_APPROVED" });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING_APPROVAL");

    const atFinance = (await queue(finance, "waiting")).items.find((item) => item.approvalId === approvalId);
    expect(atFinance).toMatchObject({ currentStep: 2, totalSteps: 3, stepLabel: "Finance", version: 2 });
    // Nobody decides two steps.
    await expectCode(decideApproval(procurement, "procurement", approvalId, "APPROVE", { note: null }), "FORBIDDEN");
    // A review of step 1 is stale now.
    await expectCode(decideApproval(finance, "procurement", approvalId, "APPROVE", { note: null, expectedVersion: 1 }), "CONFLICT", "APPROVAL_SOURCE_CHANGED");

    expect(await decideApproval(finance, "procurement", approvalId, "APPROVE", { note: "In budget.", expectedVersion: 2 })).toMatchObject({ outcome: "STEP_APPROVED" });
    expect(has((await queue(procurement, "approved")).items, approvalId)).toBe(true);

    const atCeo = (await queue(ceo, "waiting")).items.find((item) => item.approvalId === approvalId)!;
    expect(atCeo).toMatchObject({ stepLabel: "Executive", requiresStrongConfirmation: true, priority: "HIGH" });
    const detail = await getApprovalDetail(ceo, "procurement", approvalId);
    expect(detail.chainMode).toBe("SEQUENTIAL");
    expect(detail.steps.map((step) => step.status)).toEqual(["APPROVED", "APPROVED", "PENDING"]);
    expect(detail.reason).toMatch(/Finance/);

    expect(await decideApproval(ceo, "procurement", approvalId, "APPROVE", { note: null, expectedVersion: 3 })).toMatchObject({ outcome: "APPROVED" });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("APPROVED");
    expect(await prisma.commitment.count({ where: { sourceEntityId: orderId } })).toBe(1);

    expect(await prisma.auditEvent.count({ where: { entityId: orderId, actionKey: "APPROVAL_STEP_APPROVED" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { entityId: orderId, actionKey: "APPROVAL_APPROVED" } })).toBe(1);
    const asks = await prisma.notificationEventOutbox.findMany({ where: { entityId: orderId, eventType: { in: ["APPROVAL_REQUESTED", "PO_APPROVAL_REQUIRED"] } }, orderBy: { createdAt: "asc" } });
    expect(asks.map((row) => (row.payloadJson as { stepLabel?: string }).stepLabel)).toEqual(["Procurement", "Finance", "Executive"]);
    expect((asks[2].payloadJson as { recipientMemberIds?: string[] }).recipientMemberIds).toContain(ceo.membershipId);
  });

  it("keeps small orders a single Procurement decision", async () => {
    const { approvalId } = await chainOrder("1000");
    expect(await prisma.approvalStep.count({ where: { approvalId } })).toBe(0);
    const ceo = await loginAs("CEO");
    expect(has((await queue(ceo, "waiting")).items, approvalId)).toBe(true);
  });

  it("refuses to submit an order whose chain nobody could finish (§161)", async () => {
    const policy = await prisma.procurementApprovalPolicy.findUniqueOrThrow({ where: { companyId: "company_demo_a" } });
    await prisma.procurementApprovalPolicy.update({ where: { companyId: "company_demo_a" }, data: { executiveRoleKey: "VIEWER" } });
    try {
      const pm = await loginAs("PROJECT_MANAGER");
      const order = await orders.createOrder(pm, {
        supplierId: "supplier_atlas",
        projectId: PROJECT.a,
        orderDate: new Date(),
        currency: "EUR",
        items: [{ description: `${PREFIX} orphan`, quantity: "1", unit: "lot", unitPrice: "90000", taxRate: "0" }],
      } as Parameters<typeof orders.createOrder>[1]);
      created.orders.push(order.id);
      await expectCode(orders.submitOrder(pm, order.id), "VALIDATION_ERROR", "APPROVAL_NO_ELIGIBLE_APPROVER");
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DRAFT");
    } finally {
      await prisma.procurementApprovalPolicy.update({ where: { companyId: "company_demo_a" }, data: { executiveRoleKey: policy.executiveRoleKey } });
    }
  });

  it("returns an order at any step to draft and closes the steps nobody reached", async () => {
    const { orderId, approvalId, pm } = await chainOrder();
    const procurement = await loginAs("PROCUREMENT");
    await decideApproval(procurement, "procurement", approvalId, "APPROVE", { note: null });
    const finance = await loginAs("FINANCE");
    expect(await decideApproval(finance, "procurement", approvalId, "RETURN", { note: "Split the erection cost out." })).toMatchObject({ outcome: "RETURNED" });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DRAFT");
    expect((await prisma.approvalStep.findMany({ where: { approvalId }, orderBy: { stepNumber: "asc" } })).map((step) => step.status)).toEqual(["APPROVED", "RETURNED", "CANCELLED"]);
    expect(has((await queue(pm, "returned")).items, approvalId)).toBe(true);
    expect(has((await queue(finance, "returned")).items, approvalId)).toBe(true);
  });

  it("lets only one of two step approvers win a race (§269)", async () => {
    const { approvalId } = await chainOrder();
    const [procurement, owner] = await Promise.all([loginAs("PROCUREMENT"), loginAs("OWNER")]);
    const outcomes = await Promise.allSettled([
      decideApproval(procurement, "procurement", approvalId, "APPROVE", { note: null }),
      decideApproval(owner, "procurement", approvalId, "APPROVE", { note: null }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.approvalStep.count({ where: { approvalId, status: "APPROVED" } })).toBe(1);
  });
});

/* Legal -------------------------------------------------------------------- */

describe("legal return and resubmit (§264, §281)", () => {
  it("returns an amendment to its requester, whose resubmission opens a new cycle with the history kept", async () => {
    const owner = await loginAs("OWNER");
    const legal = await loginAs("LEGAL");
    const amendment = await amendments.createAmendment(owner, "contract_005", {
      amendmentNumber: `${PREFIX}-${Date.now().toString(36)}`,
      title: `${PREFIX} additional basement works`,
      summary: "Adds the second basement level to the scope.",
      newContractValue: "1500000.00",
      acknowledgeReduction: false,
    } as Parameters<typeof amendments.createAmendment>[2]);
    created.amendments.push(amendment.id);
    await amendments.submitAmendment(owner, amendment.id);
    const cycle = await prisma.contractApproval.findFirstOrThrow({ where: { recordId: amendment.id, status: "PENDING" } });

    expect(has((await queue(legal, "waiting")).items, cycle.id)).toBe(true);
    // A return says what to change, whoever calls the service (§45).
    await expectCode(decideApproval(legal, "legal", cycle.id, "RETURN", { note: "  " }), "VALIDATION_ERROR", "APPROVAL_REASON_REQUIRED");

    const fresh = cycle;
    expect(await decideApproval(legal, "legal", fresh.id, "RETURN", { note: "The value excludes the agreed contingency." })).toMatchObject({ outcome: "RETURNED" });
    expect((await prisma.contractAmendment.findUniqueOrThrow({ where: { id: amendment.id } })).status).toBe("DRAFT");
    expect(has((await queue(owner, "returned", { returned: "to" })).items, fresh.id)).toBe(true);

    await amendments.submitAmendment(owner, amendment.id);
    const next = await prisma.contractApproval.findFirstOrThrow({ where: { recordId: amendment.id, status: "PENDING" } });
    expect(next.id).not.toBe(fresh.id);
    const detail = await getApprovalDetail(legal, "legal", next.id);
    expect(detail.history.map((entry) => entry.action)).toContain("Returned for revision");
    expect(detail.history.filter((entry) => entry.action === "Resubmitted")).toHaveLength(1);
    expect(detail.history.find((entry) => entry.action === "Returned for revision")?.note).toBe("The value excludes the agreed contingency.");
  });
});

/* HR ----------------------------------------------------------------------- */

describe("leave privacy (§69, §181, §263)", () => {
  it("shows an approver who and when, never the reason without the grant, and nobody outside HR scope anything", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");
    const architect = await loginAs("ARCHITECT");
    const start = new Date(Date.UTC(2027, 10 + Math.floor(Math.random() * 12), 1));
    while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1);
    const end = new Date(start.getTime() + 86_400_000);
    const request = await leave.createLeave(engineer, createLeaveSchema.parse({ leaveType: "UNPAID", startDate: start, endDate: end, reason: "Medical appointment" }));
    created.leave.push(request.id);
    await leave.submitLeave(engineer, request.id);

    const waiting = (await queue(hr, "waiting")).items.find((item) => item.approvalId === request.id);
    const stored = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(waiting).toMatchObject({ providerKey: "hr", canApprove: true, dueAt: stored.startDate.toISOString() });
    const detail = await getApprovalDetail(hr, "hr", request.id);
    expect(detail.description === "Medical appointment").toBe(hr.permissions.includes("hr.leave.reason.view"));
    expect(detail.discussion).toBeNull();

    await expectCode(getApprovalDetail(architect, "hr", request.id), "NOT_FOUND");
    expect(has((await queue(architect, "history")).items, request.id)).toBe(false);
    await expectCode(decideApproval(engineer, "hr", request.id, "APPROVE", { note: null }), "FORBIDDEN", "APPROVAL_SELF_APPROVAL_BLOCKED");
    await expectCode(decideApproval(hr, "hr", request.id, "RETURN", { note: "x" }), "VALIDATION_ERROR", "APPROVAL_RETURN_NOT_SUPPORTED");

    expect(await decideApproval(hr, "hr", request.id, "APPROVE", { note: null })).toMatchObject({ outcome: "APPROVED" });
    expect(has((await queue(hr, "approved")).items, request.id)).toBe(true);
    expect((await queue(engineer, "requested")).items.find((item) => item.approvalId === request.id)?.status).toBe("APPROVED");
  });
});

/* Documents, delegation, reassignment -------------------------------------- */

async function reviewedDocument(reviewers: UserContext[], dueDate?: string) {
  const pm = await loginAs("PROJECT_MANAGER");
  const result = await attachDocumentFromBytes(
    pm,
    { name: `${PREFIX} drawing`, context: "project", projectId: PROJECT.a, fileName: "Drawing.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1],
    new TextEncoder().encode("%PDF-1.4\napproval fixture\n%%EOF\n"),
  );
  created.documents.push(result.documentId);
  const versionId = (await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } })).currentVersionId!;
  const reviews = [];
  for (const reviewer of reviewers) reviews.push((await requestReview(pm, versionId, { reviewerMemberId: reviewer.membershipId, dueDate })).reviewId);
  return { documentId: result.documentId, versionId, reviews, pm };
}

describe("document review (§22, §62, §265, §268)", () => {
  it("completes a parallel review only when every reviewer approves", async () => {
    const [architect, legal] = await Promise.all([loginAs("ARCHITECT"), loginAs("LEGAL")]);
    const { versionId, reviews } = await reviewedDocument([architect, legal]);

    expect(has((await queue(architect, "waiting")).items, reviews[0])).toBe(true);
    const detail = await getApprovalDetail(architect, "documents", reviews[0]);
    expect(detail).toMatchObject({ chainMode: "PARALLEL", completionRule: "ALL" });
    expect(detail.steps).toHaveLength(2);
    expect(detail.documents[0].versionNumber).toBe(1);

    await decideApproval(architect, "documents", reviews[0], "APPROVE", { note: null });
    expect((await prisma.documentVersion.findUniqueOrThrow({ where: { id: versionId } })).reviewState).toBe("IN_REVIEW");
    await decideApproval(legal, "documents", reviews[1], "APPROVE", { note: null });
    expect((await prisma.documentVersion.findUniqueOrThrow({ where: { id: versionId } })).reviewState).toBe("APPROVED");
  });

  it("lets a delegate decide a review on the reviewer's behalf, within the delegation's rules (§33, §170-§173, §270)", async () => {
    const [legal, procurement, finance, architect, viewer, ownerB] = await Promise.all([
      loginAs("LEGAL"),
      loginAs("PROCUREMENT"),
      loginAs("FINANCE"),
      loginAs("ARCHITECT"),
      loginAs("VIEWER"),
      loginAsEmail("owner-b@nesto.test"),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const input = (toMemberId: string, extra: Record<string, unknown> = {}) => createDelegationSchema.parse({ toMemberId, providerKey: "documents", startsOn: today, endsOn: today, ...extra });

    await expectCode(createDelegation(architect, input(legal.membershipId)), "FORBIDDEN");
    await expectCode(createDelegation(legal, input(legal.membershipId)), "VALIDATION_ERROR", "DELEGATE_SELF");
    await expectCode(createDelegation(legal, input(ownerB.membershipId)), "VALIDATION_ERROR", "DELEGATE_NOT_ALLOWED");
    await expectCode(createDelegation(legal, input(viewer.membershipId)), "VALIDATION_ERROR", "DELEGATE_NO_ACCESS");
    await expectCode(createDelegation(legal, input(procurement.membershipId, { endsOn: "2099-01-01" })), "VALIDATION_ERROR", "DELEGATION_TOO_LONG");

    const delegation = await createDelegation(legal, input(procurement.membershipId, { reason: "Court hearing" }));
    created.delegations.push(delegation.id);
    expect(delegation.state).toBe("ACTIVE");
    await expectCode(createDelegation(legal, input(procurement.membershipId)), "CONFLICT", "DELEGATION_OVERLAP");
    await expectCode(createDelegation(procurement, input(legal.membershipId)), "CONFLICT", "DELEGATION_CIRCULAR");
    await expectCode(createDelegation(finance, input(legal.membershipId)), "CONFLICT", "DELEGATE_AWAY");
    expect((await listDelegations(procurement)).received.map((row) => row.id)).toContain(delegation.id);

    const { reviews } = await reviewedDocument([legal]);
    const lent = (await queue(procurement, "waiting")).items.find((item) => item.approvalId === reviews[0]);
    expect(lent?.onBehalfOf?.memberId).toBe(legal.membershipId);
    await decideApproval(procurement, "documents", reviews[0], "APPROVE", { note: "Checked for Legal." });
    const review = await prisma.documentReview.findUniqueOrThrow({ where: { id: reviews[0] } });
    expect(review).toMatchObject({ status: "APPROVED", decidedByMemberId: procurement.membershipId, reviewerMemberId: legal.membershipId });

    await revokeDelegation(legal, delegation.id);
    const { reviews: later } = await reviewedDocument([legal]);
    expect(has((await queue(procurement, "waiting")).items, later[0])).toBe(false);
    await expectCode(decideApproval(procurement, "documents", later[0], "APPROVE", { note: null }), "FORBIDDEN");
    expect(await prisma.auditEvent.count({ where: { entityId: delegation.id, actionKey: { in: ["APPROVAL_DELEGATION_CREATED", "APPROVAL_DELEGATION_REVOKED"] } } })).toBe(2);
  });

  it("reassigns a review explicitly, audited and announced to both reviewers (§235-§237, §271)", async () => {
    const [architect, legal] = await Promise.all([loginAs("ARCHITECT"), loginAs("LEGAL")]);
    const { documentId, reviews, pm } = await reviewedDocument([architect]);
    await expectCode(reassignReview(architect, reviews[0], { reviewerMemberId: legal.membershipId }), "FORBIDDEN");
    await reassignReview(pm, reviews[0], { reviewerMemberId: legal.membershipId, reason: "Anna is on leave" });
    expect(has((await queue(architect, "waiting")).items, reviews[0])).toBe(false);
    expect(has((await queue(legal, "waiting")).items, reviews[0])).toBe(true);
    expect(await prisma.auditEvent.count({ where: { entityId: documentId, actionKey: "APPROVAL_REASSIGNED" } })).toBe(1);
    const event = await prisma.notificationEventOutbox.findFirstOrThrow({ where: { entityId: documentId, eventType: "APPROVAL_REASSIGNED" } });
    expect(event.payloadJson).toMatchObject({ fromMemberId: architect.membershipId, toMemberId: legal.membershipId });
  });

  it("never exposes documents through an approval to somebody the document service would refuse (§61, §274)", async () => {
    const ceo = await loginAs("CEO");
    const { orderId } = await chainOrder("1000");
    const noDocuments: UserContext = { ...ceo, permissions: ceo.permissions.filter((permission) => permission !== "document.view") };
    expect(await approvalDocuments(noDocuments, "purchase_order", orderId)).toEqual({ available: false, documents: [] });
    const withDocuments = await approvalDocuments(ceo, "purchase_order", "order_approval_chain");
    expect(withDocuments.available).toBe(true);
    expect(withDocuments.documents.map((document) => document.id)).toContain("document_po_142_quote");
  });

  it("reminds an overdue reviewer once a day, and raises attention for it (§36, §228)", async () => {
    const architect = await loginAs("ARCHITECT");
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const { documentId, reviews } = await reviewedDocument([architect], "2026-01-02");
    await prisma.documentReview.update({ where: { id: reviews[0] }, data: { dueAt: new Date(`${yesterday}T12:00:00.000Z`) } });

    await remindOverdueApprovals();
    await remindOverdueApprovals();
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: documentId, eventType: "APPROVAL_OVERDUE" } })).toBe(1);

    await reconcileAttention({ companyId: architect.companyId });
    expect(await prisma.attentionItem.count({ where: { recipientMemberId: architect.membershipId, entityId: documentId, conditionKey: "APPROVAL_OVERDUE", status: "ACTIVE" } })).toBe(1);
    const item = (await queue(architect, "waiting")).items.find((row) => row.approvalId === reviews[0]);
    expect(item?.dueState).toBe("overdue");
  });
});

/* Roles -------------------------------------------------------------------- */

describe("role acceptance (§285-§300)", () => {
  it("gives decision authority only where a source module grants it", async () => {
    const roles = ["OWNER", "ADMIN", "COMPANY_IT", "HR", "CEO", "PROJECT_MANAGER", "ARCHITECT", "ENGINEER", "FINANCE", "LEGAL", "SALES", "PROCUREMENT", "INVENTORY", "QAQC", "HSE"] as const;
    const summary: Record<string, string[]> = {};
    for (const role of roles) {
      const context = await loginAs(role);
      const waiting = await queue(context, "waiting");
      summary[role] = [...new Set(waiting.items.map((item) => item.providerKey))].sort();
      // Everything offered can actually be acted on by this person.
      expect(waiting.items.every((item) => item.canApprove || item.canReject), role).toBe(true);
      expect(context.permissions.includes("approvals.history.view"), role).toBe(["OWNER", "HR", "CEO", "PROJECT_MANAGER", "FINANCE", "LEGAL", "SALES", "PROCUREMENT", "QAQC", "HSE"].includes(role));
    }
    // No business approval authority for administration, IT or stores (§136, §137, §147).
    for (const role of ["ADMIN", "COMPANY_IT", "INVENTORY"]) {
      expect(summary[role].filter((key) => key !== "documents"), role).toEqual([]);
    }
    expect(summary.HR).toContain("hr");
    expect(summary.CEO).toEqual(expect.arrayContaining(["procurement", "sales"]));
    expect(summary.LEGAL.every((key) => ["legal", "documents"].includes(key))).toBe(true);
  });

  it("lets a submitter track what they asked for without any approval authority (§151, §292)", async () => {
    const { approvalId } = await chainOrder("1000");
    const pm = await loginAs("PROJECT_MANAGER");
    const mine = (await queue(pm, "requested")).items.find((item) => item.approvalId === approvalId);
    expect(mine).toMatchObject({ status: "PENDING", canApprove: false });
  });
});
