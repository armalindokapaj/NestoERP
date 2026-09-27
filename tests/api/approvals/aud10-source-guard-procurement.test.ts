import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as actions from "@/lib/actions/procurement";
import * as approvals from "@/lib/modules/procurement/approvals/approval.service";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import * as requests from "@/lib/modules/procurement/requests/request.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";
import { disconnectLocker, shownCycle } from "./aud10-cycles";
import { asPerson, fromAction, snapshot, sourceGuardTests, type SourceScenario } from "./aud10-scenarios";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * Procurement decisions name the cycle — and, on a chained order, the step —
 * they decide (AUD-10 §4, CW-02, CW-04, CW-05; gaps A1, A6, A13). The request
 * and order pages, the procurement queue and the Approvals Center all name
 * what they showed; a page that showed step one cannot approve step two.
 */

const PREFIX = "aud10a_";
const made = { requests: new Set<string>(), orders: new Set<string>() };

afterEach(async () => {
  const all = [...made.requests, ...made.orders];
  if (all.length === 0) return;
  const cycles = await prisma.procurementApproval.findMany({ where: { recordId: { in: all } }, select: { id: true } });
  await prisma.approvalStep.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
  await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: cycles.map((row) => row.id) } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: all } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: all } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: all } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: all } } });
  await prisma.procurementApproval.deleteMany({ where: { recordId: { in: all } } });
  await prisma.commitment.deleteMany({ where: { sourceEntityId: { in: [...made.orders] } } });
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: [...made.orders] } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: [...made.orders] } } });
  await prisma.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: { in: [...made.requests] } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: [...made.requests] } } });
  made.requests.clear();
  made.orders.clear();
});

afterAll(async () => {
  await disconnectLocker();
  await cleanupSessions();
  await prisma.$disconnect();
});

const ceo = () => loginAs("CEO");
const buyer = () => loginAs("PROCUREMENT");

const request: SourceScenario = {
  label: "procurement request",
  module: "procurement",
  providerKey: "procurement",
  sourceTable: "purchase_requests",
  approver: ceo,
  async createSubmitted() {
    const context = await buyer();
    const created = await requests.createRequest(context, {
      title: `${PREFIX}request`,
      priority: "MEDIUM",
      currency: "EUR",
      items: [{ description: `${PREFIX}line`, quantity: "10", unit: "each", estimatedUnitPrice: "25.50" }],
    } as Parameters<typeof requests.createRequest>[1]);
    made.requests.add(created.id);
    await requests.submitRequest(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await ceo(), () => actions.requestLifecycleAction(id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await ceo(), () => actions.rejectRequestAction(id, `${PREFIX}quantities look wrong`, cycle))),
  resubmit: async (id) => requests.submitRequest(await buyer(), id),
  status: async (id) => (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "PROCUREMENT_REQUEST_APPROVED",
};

async function draftOrder(unitPrice: string, context?: Awaited<ReturnType<typeof loginAs>>) {
  const author = context ?? (await buyer());
  const created = await orders.createOrder(author, {
    supplierId: "supplier_atlas",
    projectId: PROJECT.a,
    orderDate: new Date(),
    currency: "EUR",
    items: [{ description: `${PREFIX}steel`, quantity: "1", unit: "lot", unitPrice, taxRate: "0" }],
  } as Parameters<typeof orders.createOrder>[1]);
  made.orders.add(created.id);
  return created.id;
}

/** Below the seeded chain threshold (25k): one Procurement decision. */
const order: SourceScenario = {
  label: "procurement order",
  module: "procurement",
  providerKey: "procurement",
  sourceTable: "purchase_orders",
  approver: ceo,
  async createSubmitted() {
    const id = await draftOrder("1000");
    await orders.submitOrder(await buyer(), id);
    return id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await ceo(), () => actions.orderLifecycleAction(id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await ceo(), () => actions.rejectOrderAction(id, `${PREFIX}wrong supplier`, cycle))),
  resubmit: async (id) => orders.submitOrder(await buyer(), id),
  status: async (id) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "PROCUREMENT_ORDER_APPROVED",
};

const tracker = { track: () => undefined };

for (const scenario of [request, order]) {
  describe(`${scenario.label} (AUD-10 §4)`, () => {
    sourceGuardTests(scenario, tracker);
  });
}

describe("a chained order is decided one named step at a time (AUD-10 §4, CW-04)", () => {
  it("CW-04 a page still showing step one cannot approve step two; naming step two does", async () => {
    // 80k: Procurement → Finance → Executive under the seeded policy (25k / 75k).
    const pm = await loginAs("PROJECT_MANAGER");
    const id = await draftOrder("80000", pm);
    await orders.submitOrder(pm, id);
    const atStepOne = await shownCycle("procurement", id);
    expect(atStepOne.stepNumber).toBe(1);

    // Procurement approves step one from the order page, naming it.
    const procurement = await buyer();
    expect(fromAction(await asPerson(procurement, () => actions.orderLifecycleAction(id, "approve", undefined, atStepOne)))).toEqual({ ok: true });
    const steps = await prisma.approvalStep.findMany({ where: { approvalId: atStepOne.approvalId }, orderBy: { stepNumber: "asc" } });
    expect(steps.map((step) => step.status)).toEqual(["APPROVED", "PENDING", "PENDING"]);
    expect(await order.status(id)).toBe("PENDING_APPROVAL");

    // The Owner's page, opened at step one, is now stale: step two is not decided from it.
    const owner = await loginAs("OWNER");
    const before = await snapshot(order, id);
    const stale = fromAction(await asPerson(owner, () => actions.orderLifecycleAction(id, "approve", undefined, atStepOne)));
    expect(stale).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    // Naming the cycle but not the step is refused as well: a chain decision names both.
    const stepless = fromAction(await asPerson(owner, () => actions.orderLifecycleAction(id, "approve", undefined, { approvalId: atStepOne.approvalId })));
    expect(stepless).toMatchObject({ ok: false, code: "APPROVAL_CYCLE_REQUIRED" });
    // The stale queue row too.
    const queued = fromAction(await asPerson(owner, () => actions.decideApprovalAction("PURCHASE_ORDER", id, "approve", undefined, atStepOne)));
    expect(queued).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    expect(await snapshot(order, id)).toEqual(before);

    // Reloaded: the page shows step two and decides it.
    const atStepTwo = await shownCycle("procurement", id);
    expect(atStepTwo).toEqual({ approvalId: atStepOne.approvalId, stepNumber: 2 });
    expect(fromAction(await asPerson(owner, () => actions.orderLifecycleAction(id, "approve", undefined, atStepTwo)))).toEqual({ ok: true });
    const after = await prisma.approvalStep.findMany({ where: { approvalId: atStepOne.approvalId }, orderBy: { stepNumber: "asc" } });
    expect(after.map((step) => [step.status, step.decidedByMemberId])).toEqual([
      ["APPROVED", procurement.membershipId],
      ["APPROVED", owner.membershipId],
      ["PENDING", null],
    ]);
    expect(await order.status(id)).toBe("PENDING_APPROVAL");
    expect(await prisma.activity.count({ where: { entityId: id, action: "PROCUREMENT_ORDER_STEP_APPROVED" } })).toBe(2);
  });

  it("CW-04 the module queue passes the step it shows, so its own row decides", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const id = await draftOrder("80000", pm);
    await orders.submitOrder(pm, id);
    const row = await prisma.procurementApproval.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });
    const steps = await approvals.currentStepNumbers([row.id]);
    expect(steps).toEqual({ [row.id]: 1 });
    const procurement = await buyer();
    const outcome = fromAction(await asPerson(procurement, () => actions.decideApprovalAction("PURCHASE_ORDER", id, "approve", undefined, { approvalId: row.id, stepNumber: steps[row.id] })));
    expect(outcome).toEqual({ ok: true });
    expect(await approvals.currentStepNumbers([row.id])).toEqual({ [row.id]: 2 });
  });
});

describe("saying no needs a reason at the service (AUD-10 §4, A13)", () => {
  it("refuses a request rejection and an order return with a blank reason, then accepts one with a reason", async () => {
    const context = await ceo();
    const requestId = await request.createSubmitted();
    const orderId = await order.createSubmitted();
    await expect(requests.rejectRequest(context, requestId, "  ", await shownCycle("procurement", requestId))).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "APPROVAL_REASON_REQUIRED" } });
    await expect(orders.returnOrder(context, orderId, "", await shownCycle("procurement", orderId))).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "APPROVAL_REASON_REQUIRED" } });
    expect(await request.status(requestId)).toBe("PENDING_APPROVAL");
    expect(await order.status(orderId)).toBe("PENDING_APPROVAL");
    await requests.rejectRequest(context, requestId, `${PREFIX}not this quarter`, await shownCycle("procurement", requestId));
    expect(await request.status(requestId)).toBe("REJECTED");
  });
});

describe("one pending cycle, decided deterministically (AUD-10 §4, A6)", () => {
  it("refuses a record carrying two pending cycles instead of deciding whichever the planner returned", async () => {
    const id = await request.createSubmitted();
    const pending = await prisma.procurementApproval.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });
    let extraId: string;
    try {
      extraId = (
        await prisma.procurementApproval.create({
          data: { companyId: pending.companyId, recordType: "PURCHASE_REQUEST", recordId: id, status: "PENDING", submittedByMemberId: pending.submittedByMemberId },
        })
      ).id;
    } catch (error) {
      // The one-pending-cycle index (AUD-10 A6) forbids the state outright where it is applied.
      expect((error as { code?: string }).code).toBe("P2002");
      return;
    }
    const before = await snapshot(request, id);
    for (const approvalId of [pending.id, extraId]) {
      expect(await request.approve(id, { approvalId })).toMatchObject({ ok: false, code: "APPROVAL_CYCLE_AMBIGUOUS" });
    }
    expect(await snapshot(request, id)).toEqual(before);
  });
});
