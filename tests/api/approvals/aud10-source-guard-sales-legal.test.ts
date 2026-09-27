import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as contractActions from "@/lib/actions/contracts";
import * as salesActions from "@/lib/actions/sales";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { createOpportunitySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { createProposalSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { routeHandlers } from "../../security/harness/mutations";
import { callRoute } from "../../security/harness/routes";
import { disconnectLocker, shownCycle } from "./aud10-cycles";
import { asPerson, fromAction, snapshot, sourceGuardTests, type SourceScenario } from "./aud10-scenarios";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * Sales proposals and Legal contracts/amendments decide the cycle their page
 * shows (AUD-10 §4, CW-02, CW-04, CW-05; gaps A1, A6, A13).
 */

const PREFIX = "aud10a_";
const made = { proposals: new Set<string>(), opportunities: new Set<string>(), contracts: new Set<string>(), amendments: new Set<string>() };

afterEach(async () => {
  const records = [...made.proposals, ...made.opportunities, ...made.contracts, ...made.amendments];
  if (records.length === 0) return;
  await prisma.notification.deleteMany({ where: { entityId: { in: records } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: records } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: records } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: records } } });
  await prisma.salesApproval.deleteMany({ where: { recordId: { in: [...made.proposals] } } });
  await prisma.proposal.deleteMany({ where: { id: { in: [...made.proposals] } } });
  await prisma.opportunity.deleteMany({ where: { id: { in: [...made.opportunities] } } });
  await prisma.contractApproval.deleteMany({ where: { recordId: { in: [...made.amendments, ...made.contracts] } } });
  await prisma.contractAmendment.deleteMany({ where: { contractId: { in: [...made.contracts] } } });
  await prisma.contractObligation.deleteMany({ where: { contractId: { in: [...made.contracts] } } });
  await prisma.contractParty.deleteMany({ where: { contractId: { in: [...made.contracts] } } });
  await prisma.contract.deleteMany({ where: { id: { in: [...made.contracts] } } });
  for (const set of Object.values(made)) set.clear();
});

afterAll(async () => {
  await disconnectLocker();
  await cleanupSessions();
  await prisma.$disconnect();
});

const ceo = () => loginAs("CEO");
const sales = () => loginAs("SALES");
const legal = () => loginAs("LEGAL");
const tag = () => Math.random().toString(36).slice(2, 8);

const proposal: SourceScenario = {
  label: "sales proposal",
  module: "sales",
  providerKey: "sales",
  sourceTable: "proposals",
  approver: ceo,
  async createSubmitted() {
    const context = await sales();
    const opportunity = await opportunities.createOpportunity(
      context,
      createOpportunitySchema.parse({ name: `${PREFIX}opportunity`, ownerMemberId: context.membershipId, stage: "QUALIFIED", estimatedValue: "100000", currency: "EUR", clientId: "client_acme" }),
    );
    made.opportunities.add(opportunity.id);
    const created = await proposals.createProposal(
      context,
      createProposalSchema.parse({
        opportunityId: opportunity.id,
        proposalNumber: `${PREFIX}${tag()}`,
        title: `${PREFIX}proposal`,
        currency: "EUR",
        issueDate: "2026-01-15",
        lineItems: [{ description: "Works", quantity: "1", unitPrice: "10000", taxRate: "20" }],
      }),
    );
    made.proposals.add(created.id);
    await proposals.submitProposal(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await ceo(), () => salesActions.proposalLifecycleAction(id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await ceo(), () => salesActions.rejectProposalAction(id, `${PREFIX}too far above their budget`, cycle))),
  resubmit: async (id) => proposals.submitProposal(await sales(), id),
  status: async (id) => (await prisma.proposal.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "SALES_PROPOSAL_APPROVED",
};

async function draftContract(): Promise<string> {
  const context = await legal();
  const created = await contracts.createContract(context, {
    contractNumber: `${PREFIX}${tag()}`,
    title: `${PREFIX}agreement`,
    contractType: "SERVICE_AGREEMENT",
    ownerMemberId: context.membershipId,
    renewalType: "NONE",
  } as Parameters<typeof contracts.createContract>[1]);
  made.contracts.add(created.id);
  return created.id;
}

const contract: SourceScenario = {
  label: "legal contract",
  module: "contracts",
  providerKey: "legal",
  sourceTable: "contracts",
  approver: ceo,
  async createSubmitted() {
    const id = await draftContract();
    const context = await legal();
    await contracts.submitForReview(context, id);
    await contracts.submitForApproval(context, id);
    return id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await ceo(), () => contractActions.contractLifecycleAction(id, "approve", undefined, cycle))),
  // A rejected contract goes back to review, with the reviewer's work kept (PRD #18 §114).
  sendBack: async (id, cycle) => fromAction(await asPerson(await ceo(), () => contractActions.rejectContractAction(id, `${PREFIX}liability cap is unacceptable`, cycle))),
  resubmit: async (id) => contracts.submitForApproval(await legal(), id),
  status: async (id) => (await prisma.contract.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "LEGAL_CONTRACT_APPROVED",
};

/** The contract an amendment belongs to, by amendment id. */
const amendmentContract = new Map<string, string>();

const amendment: SourceScenario = {
  label: "legal amendment",
  module: "contracts",
  providerKey: "legal",
  sourceTable: "contract_amendments",
  approver: ceo,
  async createSubmitted() {
    // An approved contract of the test's own, so nothing seeded is amended.
    const contractId = await contract.createSubmitted();
    await contracts.approveContract(await ceo(), contractId, null, await shownCycle("contracts", contractId));
    const context = await legal();
    const created = await amendments.createAmendment(context, contractId, {
      amendmentNumber: `${PREFIX}${tag()}`,
      title: `${PREFIX}scope change`,
      summary: "Additional works agreed.",
      acknowledgeReduction: false,
    } as Parameters<typeof amendments.createAmendment>[2]);
    made.amendments.add(created.id);
    amendmentContract.set(created.id, contractId);
    await amendments.submitAmendment(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await ceo(), () => contractActions.amendmentLifecycleAction(amendmentContract.get(id)!, id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await ceo(), () => contractActions.rejectAmendmentAction(amendmentContract.get(id)!, id, `${PREFIX}not agreed`, cycle))),
  resubmit: async (id) => amendments.submitAmendment(await legal(), id),
  status: async (id) => (await prisma.contractAmendment.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "LEGAL_AMENDMENT_APPROVED",
  // Amendment activity is written on its contract, naming the amendment (PRD #18 §170).
  activityWhere: async (id) => ({ entityId: amendmentContract.get(id)!, metadata: { path: ["amendmentId"], equals: id } }),
};

const tracker = { track: () => undefined };

for (const scenario of [proposal, contract, amendment]) {
  describe(`${scenario.label} (AUD-10 §4)`, () => {
    sourceGuardTests(scenario, tracker);
  });
}

describe("sales and legal API routes name the cycle (AUD-10 §4, CW-02, CW-05)", () => {
  it("CW-05 the proposal approve route refuses a missing (428) or replaced (409) cycle, then approves the named one", async () => {
    const id = await proposal.createSubmitted();
    const first = await shownCycle("sales", id);
    await proposals.rejectProposal(await ceo(), id, `${PREFIX}send back`, first);
    await proposal.resubmit(id);
    const second = await shownCycle("sales", id);

    const approve = await routeHandlers("/api/sales/proposals/[proposalId]/approve");
    const path = `/api/sales/proposals/${id}/approve`;
    actAs(await ceo());
    try {
      const before = await snapshot(proposal, id);
      expect((await callRoute(approve.POST!, "POST", path, { proposalId: id }, {})).status).toBe(428);
      const stale = await callRoute(approve.POST!, "POST", path, { proposalId: id }, { approvalId: first.approvalId });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ error: { details: { code: "APPROVAL_SOURCE_CHANGED" } } });
      expect(await snapshot(proposal, id)).toEqual(before);
      expect((await callRoute(approve.POST!, "POST", path, { proposalId: id }, { approvalId: second.approvalId })).status).toBe(204);
      expect(await proposal.status(id)).toBe("APPROVED");
    } finally {
      actAs(null);
    }
  });

  it("CW-05 the contract reject route needs the cycle it rejects", async () => {
    const id = await contract.createSubmitted();
    const reject = await routeHandlers("/api/contracts/[contractId]/reject");
    const path = `/api/contracts/${id}/reject`;
    actAs(await ceo());
    try {
      expect((await callRoute(reject.POST!, "POST", path, { contractId: id }, { note: `${PREFIX}no cycle` })).status).toBe(428);
      expect(await contract.status(id)).toBe("PENDING_APPROVAL");
      const named = await callRoute(reject.POST!, "POST", path, { contractId: id }, { note: `${PREFIX}cap too high`, approvalId: (await shownCycle("contracts", id)).approvalId });
      expect(named.status).toBeLessThan(300);
      expect(await contract.status(id)).toBe("IN_REVIEW");
    } finally {
      actAs(null);
    }
  });
});

describe("saying no needs a reason at the service (AUD-10 §4, A13)", () => {
  it("refuses a proposal rejection or return with a blank reason", async () => {
    const id = await proposal.createSubmitted();
    const cycle = await shownCycle("sales", id);
    await expect(proposals.rejectProposal(await ceo(), id, " ", cycle)).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "APPROVAL_REASON_REQUIRED" } });
    await expect(proposals.returnProposal(await ceo(), id, "", cycle)).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "APPROVAL_REASON_REQUIRED" } });
    expect(await proposal.status(id)).toBe("PENDING_APPROVAL");
  });
});
