import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as contractActions from "@/lib/actions/contracts";
import * as salesActions from "@/lib/actions/sales";
import { amendmentSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import { convertLeadSchema } from "@/lib/modules/sales/leads/lead.schema";
import { createOpportunitySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { routeHandlers } from "../../security/harness/mutations";
import { callRoute } from "../../security/harness/routes";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * AUD-09 — Sales and Contracts forms (FV-04, FV-05, FV-06, FV-07, FV-16).
 * The real actions and routes as the seeded Sales and Legal accounts;
 * persisted state asserted; refusals paired with positive controls.
 */

const PREFIX = "aud09c_";
const made = { leads: new Set<string>(), proposals: new Set<string>(), contracts: new Set<string>() };

afterEach(async () => {
  const all = [...made.leads, ...made.proposals, ...made.contracts];
  if (all.length > 0) {
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: all } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: all } } });
  }
  if (made.proposals.size > 0) await prisma.proposal.deleteMany({ where: { id: { in: [...made.proposals] } } });
  if (made.leads.size > 0) await prisma.lead.deleteMany({ where: { id: { in: [...made.leads] } } });
  if (made.contracts.size > 0) await prisma.contract.deleteMany({ where: { id: { in: [...made.contracts] } } });
  for (const set of Object.values(made)) set.clear();
});

afterAll(async () => {
  actAs(null);
  await cleanupSessions();
  await prisma.$disconnect();
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function as<T>(role: "SALES" | "LEGAL" | "OWNER", run: () => Promise<T>): Promise<T> {
  actAs(await loginAs(role));
  try {
    return await run();
  } finally {
    actAs(null);
  }
}

function idFrom(result: { ok: boolean; redirectTo?: string }): string {
  expect(result).toMatchObject({ ok: true });
  return result.redirectTo!.split("/").pop()!;
}

describe("Sales — FV-05 / FV-06", () => {
  it("an empty estimate is no estimate (null), not an estimate of 0", async () => {
    const created = await as("SALES", () => salesActions.createLeadAction(form({ name: `${PREFIX}Lead`, source: "WEBSITE", estimatedValue: "", email: "lead@example.com", notes: `${PREFIX}notes` })));
    const id = idFrom(created);
    made.leads.add(id);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id }, select: { estimatedValue: true, currency: true } })).toEqual({ estimatedValue: null, currency: null });
  });

  it("a lead PATCH keeps what it leaves out and clears what it sends empty", async () => {
    const created = await as("SALES", () =>
      salesActions.createLeadAction(form({ name: `${PREFIX}Lead`, source: "WEBSITE", estimatedValue: "1 500,50", currency: "EUR", email: "lead@example.com", phone: "+355 1", notes: `${PREFIX}notes` })),
    );
    const id = idFrom(created);
    made.leads.add(id);
    const route = await routeHandlers("/api/sales/leads/[leadId]");
    actAs(await loginAs("SALES"));
    const patched = await callRoute(route.PATCH!, "PATCH", `/api/sales/leads/${id}`, { leadId: id }, { name: `${PREFIX}Lead renamed`, source: "WEBSITE", phone: "" });
    actAs(null);
    expect(patched.status).toBe(200);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id }, select: { name: true, email: true, phone: true, notes: true, estimatedValue: true, currency: true } });
    expect(row).toMatchObject({ name: `${PREFIX}Lead renamed`, email: "lead@example.com", phone: null, notes: `${PREFIX}notes`, currency: "EUR" });
    expect(row.estimatedValue?.toFixed(2)).toBe("1500.50");
  });

  it("conversion refuses '1e5' and '12abc' that a parseFloat test let through", () => {
    const base = { opportunityName: "Deal", ownerMemberId: "member_sales", currency: "EUR" };
    for (const estimatedValue of ["1e5", "12abc", "Infinity", "1,234"]) {
      expect(convertLeadSchema.safeParse({ ...base, estimatedValue }).error?.issues.map((issue) => issue.path.join("."))).toEqual(["estimatedValue"]);
    }
    expect(convertLeadSchema.parse({ ...base, estimatedValue: "100000", acceptDuplicate: "false" })).toMatchObject({ estimatedValue: "100000", acceptDuplicate: false });
  });

  it("an opportunity's probability is compared exactly and refused above 100", () => {
    const base = { name: "Deal", ownerMemberId: "member_sales", stage: "PROSPECTING", estimatedValue: "10", currency: "EUR" };
    expect(createOpportunitySchema.safeParse({ ...base, probabilityOverride: "100.01" }).success).toBe(false);
    expect(createOpportunitySchema.parse({ ...base, probabilityOverride: "12,5" }).probabilityOverride).toBe("12.5");
  });

  it("a proposal's line error names the row it was submitted as; a valid proposal stores exact totals", async () => {
    const entries = {
      opportunityId: "opportunity_001",
      proposalNumber: `${PREFIX}${Math.random().toString(36).slice(2, 8)}`,
      title: `${PREFIX}Proposal`,
      currency: "EUR",
      issueDate: "2026-03-01",
      validUntil: "2026-03-31",
      "lineItems.0.description": "Design",
      "lineItems.0.quantity": "1",
      "lineItems.0.unitPrice": "1000",
      "lineItems.0.taxRate": "20",
      "lineItems.1.description": "Survey",
      "lineItems.1.quantity": "2",
      "lineItems.1.unitPrice": "12.345678",
      "lineItems.1.taxRate": "20",
    };
    const refused = await as("SALES", () => salesActions.createProposalAction(form(entries)));
    expect(refused.ok ? null : Object.keys(refused.fieldErrors ?? {})).toEqual(["lineItems.1.unitPrice"]);
    expect(await prisma.proposal.count({ where: { title: `${PREFIX}Proposal` } })).toBe(0);

    const ok = await as("SALES", () => salesActions.createProposalAction(form({ ...entries, "lineItems.1.unitPrice": "12,3456" })));
    const id = idFrom(ok);
    made.proposals.add(id);
    const row = await prisma.proposal.findUniqueOrThrow({ where: { id }, select: { subtotal: true, taxAmount: true, totalAmount: true } });
    // 1000.00 + (2 × 12.3456 = 24.6912 → 24.69); tax 200.00 + 4.94 (4.938 → 4.94).
    expect([row.subtotal.toFixed(2), row.taxAmount.toFixed(2), row.totalAmount.toFixed(2)]).toEqual(["1024.69", "204.94", "1229.63"]);
  });
});

describe("Contracts — FV-05 / FV-06 / FV-07", () => {
  const contractForm = (extra: Record<string, string>) =>
    form({
      contractNumber: `${PREFIX}${Math.random().toString(36).slice(2, 8)}`,
      title: `${PREFIX}Contract`,
      contractType: "SERVICE_AGREEMENT",
      ownerMemberId: "member_legal",
      renewalType: "MANUAL",
      ...extra,
    });

  it("an empty notice period is 'not set', not 0 days; '1e3' is refused", async () => {
    const refused = await as("LEGAL", () => contractActions.createContractAction(contractForm({ renewalNoticeDays: "1e3" })));
    expect(refused.ok ? null : Object.keys(refused.fieldErrors ?? {})).toEqual(["renewalNoticeDays"]);
    const created = await as("LEGAL", () => contractActions.createContractAction(contractForm({ renewalNoticeDays: "", summary: `${PREFIX}summary`, contractValue: "1 234,50", currency: "EUR" })));
    const id = idFrom(created);
    made.contracts.add(id);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id }, select: { renewalNoticeDays: true, contractValue: true } });
    expect(row.renewalNoticeDays).toBeNull();
    expect(row.contractValue?.toFixed(2)).toBe("1234.50");
  });

  it("a contract value of '1,234' is refused as ambiguous", async () => {
    const refused = await as("LEGAL", () => contractActions.createContractAction(contractForm({ contractValue: "1,234", currency: "EUR" })));
    expect(refused.ok ? null : refused.fieldErrors?.contractValue?.[0]).toContain("ambiguous");
  });

  it("a metadata correction that leaves the summary out keeps it", async () => {
    const created = await as("LEGAL", () => contractActions.createContractAction(contractForm({ summary: `${PREFIX}summary` })));
    const id = idFrom(created);
    made.contracts.add(id);
    const kept = await as("LEGAL", () => contractActions.updateContractAction(id, form({ ownerMemberId: "member_legal" })));
    expect(kept.ok).toBe(true);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id }, select: { summary: true } })).summary).toBe(`${PREFIX}summary`);
    const cleared = await as("LEGAL", () => contractActions.updateContractAction(id, form({ ownerMemberId: "member_legal", summary: "" })));
    expect(cleared.ok).toBe(true);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id }, select: { summary: true } })).summary).toBeNull();
  });

  it("an amendment's new expiry cannot come before it takes effect; 'false' is false", () => {
    const base = { amendmentNumber: "A-1", title: "Change", summary: "Scope change", effectiveDate: "2026-04-01" };
    expect(amendmentSchema.safeParse({ ...base, newExpiryDate: "2026-03-31" }).error?.issues.map((issue) => issue.path.join("."))).toEqual(["newExpiryDate"]);
    expect(amendmentSchema.parse({ ...base, newExpiryDate: "2026-04-01", acknowledgeReduction: "false" }).acknowledgeReduction).toBe(false);
  });
});
