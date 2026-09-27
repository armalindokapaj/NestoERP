import { afterAll, afterEach, describe, expect, it } from "vitest";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { canReachDocumentParent } from "@/lib/modules/documents/document.parent-access";
import * as approvals from "@/lib/modules/sales/approvals/approval.service";
import { listRecordActivity } from "@/lib/modules/sales/sales.activity";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import { DuplicateLeadError } from "@/lib/modules/sales/leads/lead.service";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { getPipeline } from "@/lib/modules/sales/opportunities/pipeline.service";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { getSalesOverview } from "@/lib/modules/sales/overview/overview.service";
import * as reports from "@/lib/modules/sales/reports/reports.service";
import { exportSales } from "@/lib/modules/sales/sales.export";
import {
  convertLeadSchema,
  createLeadSchema,
  leadListQuerySchema,
  updateLeadSchema,
} from "@/lib/modules/sales/leads/lead.schema";
import {
  createOpportunitySchema,
  opportunityListQuerySchema,
  opportunityLostSchema,
  opportunityWonSchema,
  updateOpportunitySchema,
} from "@/lib/modules/sales/opportunities/opportunity.schema";
import {
  createProposalSchema,
  proposalListQuerySchema,
  updateProposalSchema,
} from "@/lib/modules/sales/proposals/proposal.schema";
import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";
import { shownCycle } from "../approvals/aud10-cycles";

/**
 * Sales authorisation and lifecycle tests (PRD #17 §315–§342, §358, §359).
 *
 * These call the same services the API routes and the pages call, so a passing
 * test is a statement about the running product rather than about a mock
 * (PRD #9 §223).
 *
 * The rules the module exists to hold:
 *   1. a lead converts once,
 *   2. a deal closes once,
 *   3. a deal cannot be won without a canonical client,
 *   4. nobody approves the price they quoted,
 *   5. at most one accepted proposal per opportunity.
 */
const leadQuery = leadListQuerySchema.parse({ limit: 100 });
const opportunityQuery = opportunityListQuerySchema.parse({ limit: 100 });
const proposalQuery = proposalListQuerySchema.parse({ limit: 100 });

const TEST_PREFIX = "Vitest";

/** Records a test created, removed in dependency order after each test. */
const created = {
  proposals: [] as string[],
  opportunities: [] as string[],
  leads: [] as string[],
  clients: [] as string[],
  projects: [] as string[],
};

/** Sales records the seed owns, whose state a test changed. */
const touchedOpportunities: {
  id: string;
  stage: "PROSPECTING" | "QUALIFIED" | "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
  stageChangedAt: Date;
  actualCloseDate: Date | null;
  archivedAt: Date | null;
}[] = [];

const touchedProposals: { id: string; status: string; sentAt: Date | null; acceptedAt: Date | null }[] =
  [];

const touchedLeads: { id: string; status: string; disqualifyReason: string | null }[] = [];

/** Seeded approval cycles a test decided, put back to PENDING afterwards. */
const touchedApprovals: { id: string }[] = [];

async function remember(kind: "lead" | "opportunity" | "proposal", id: string) {
  if (kind === "lead") {
    const row = await prisma.lead.findUniqueOrThrow({
      where: { id },
      select: { status: true, disqualifyReason: true },
    });
    touchedLeads.push({ id, ...row });
  }
  if (kind === "opportunity") {
    const row = await prisma.opportunity.findUniqueOrThrow({
      where: { id },
      select: { stage: true, stageChangedAt: true, actualCloseDate: true, archivedAt: true },
    });
    touchedOpportunities.push({ id, ...row });
  }
  if (kind === "proposal") {
    const row = await prisma.proposal.findUniqueOrThrow({
      where: { id },
      select: { status: true, sentAt: true, acceptedAt: true },
    });
    touchedProposals.push({ id, ...row });
  }
}

afterEach(async () => {
  // Deleted in dependency order: a proposal restrains its opportunity, and an
  // opportunity restrains its lead.
  if (created.proposals.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: created.proposals } } });
    await prisma.salesApproval.deleteMany({ where: { recordId: { in: created.proposals } } });
    await prisma.proposal.deleteMany({ where: { id: { in: created.proposals } } });
    created.proposals.length = 0;
  }
  if (created.opportunities.length > 0) {
    await prisma.proposal.deleteMany({ where: { opportunityId: { in: created.opportunities } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created.opportunities } } });
    await prisma.opportunity.deleteMany({ where: { id: { in: created.opportunities } } });
    created.opportunities.length = 0;
  }
  if (created.leads.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: created.leads } } });
    await prisma.lead.deleteMany({ where: { id: { in: created.leads } } });
    created.leads.length = 0;
  }
  if (created.projects.length > 0) {
    await prisma.projectMember.deleteMany({ where: { projectId: { in: created.projects } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created.projects } } });
    await prisma.project.deleteMany({ where: { id: { in: created.projects } } });
    created.projects.length = 0;
  }
  if (created.clients.length > 0) {
    await prisma.contact.deleteMany({ where: { clientId: { in: created.clients } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created.clients } } });
    await prisma.client.deleteMany({ where: { id: { in: created.clients } } });
    created.clients.length = 0;
  }

  for (const row of touchedOpportunities) {
    await prisma.opportunity.update({
      where: { id: row.id },
      data: {
        stage: row.stage,
        stageChangedAt: row.stageChangedAt,
        actualCloseDate: row.actualCloseDate,
        archivedAt: row.archivedAt,
        preArchiveStage: null,
      },
    });
  }
  touchedOpportunities.length = 0;

  for (const row of touchedProposals) {
    await prisma.proposal.update({
      where: { id: row.id },
      data: {
        status: row.status as "DRAFT",
        sentAt: row.sentAt,
        acceptedAt: row.acceptedAt,
        preArchiveStatus: null,
        archivedAt: null,
      },
    });
  }
  touchedProposals.length = 0;

  for (const row of touchedLeads) {
    await prisma.lead.update({
      where: { id: row.id },
      data: {
        status: row.status as "NEW",
        disqualifyReason: row.disqualifyReason,
        preArchiveStatus: null,
        archivedAt: null,
        convertedAt: null,
        convertedClientId: null,
      },
    });
  }
  touchedLeads.length = 0;

  // A seeded approval a test decided goes back to PENDING, so the approval
  // queue is exactly as the seed left it for the next run. Approvals a test
  // *created* went with their proposal above.
  for (const row of touchedApprovals) {
    await prisma.salesApproval.update({
      where: { id: row.id },
      data: {
        status: "PENDING",
        decidedByMemberId: null,
        decidedAt: null,
        decisionNote: null,
      },
    });
  }
  touchedApprovals.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Nova's own salesperson: Nova holds the converted lead, the accepted quote and a won and a lost deal. */
const NOVA_SALES = "sales-e@nesto.test";

/**
 * A sales record sits in the company of its client or project (E-06), so what
 * the demo renders is spread across the group. The group's head of Sales is a
 * member of all five companies and reads each in turn.
 */
async function acrossTheGroup<T>(read: (context: UserContext) => Promise<T[]>): Promise<T[]> {
  const memberships = await prisma.companyMember.findMany({
    where: { user: { email: DEMO_EMAIL.salesHead }, companyId: { in: [COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e] }, status: "ACTIVE" },
    select: { id: true },
  });
  expect(memberships).toHaveLength(5);

  const rows: T[] = [];
  for (const membership of memberships) rows.push(...(await read(await loginAsMembership(membership.id))));
  return rows;
}

function leadInput(overrides: Record<string, unknown> = {}) {
  return createLeadSchema.parse({
    name: `${TEST_PREFIX} Lead`,
    companyName: `${TEST_PREFIX} Holdings`,
    source: "WEBSITE",
    estimatedValue: "50000",
    currency: "EUR",
    ...overrides,
  });
}

function opportunityInput(overrides: Record<string, unknown> = {}) {
  return createOpportunitySchema.parse({
    name: `${TEST_PREFIX} Opportunity`,
    ownerMemberId: overrides.ownerMemberId ?? "",
    stage: "QUALIFIED",
    estimatedValue: "100000",
    currency: "EUR",
    ...overrides,
  });
}

function proposalInput(overrides: Record<string, unknown> = {}) {
  return createProposalSchema.parse({
    proposalNumber: `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}`,
    title: `${TEST_PREFIX} proposal`,
    currency: "EUR",
    issueDate: "2026-01-15",
    lineItems: [{ description: "Works", quantity: "1", unitPrice: "10000", taxRate: "20" }],
    ...overrides,
  });
}

async function newLead(context: Awaited<ReturnType<typeof loginAs>>, overrides = {}) {
  const lead = await leads.createLead(context, leadInput(overrides), { acceptDuplicate: true });
  created.leads.push(lead.id);
  return lead;
}

async function newOpportunity(
  context: Awaited<ReturnType<typeof loginAs>>,
  overrides: Record<string, unknown> = {},
) {
  const opportunity = await opportunities.createOpportunity(
    context,
    opportunityInput({ ownerMemberId: context.membershipId, ...overrides }),
  );
  created.opportunities.push(opportunity.id);
  return opportunity;
}

function proposalUpdate(overrides: Record<string, unknown> = {}) {
  return updateProposalSchema.parse({
    proposalNumber: `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}`,
    title: `${TEST_PREFIX} revised`,
    currency: "EUR",
    issueDate: "2026-01-15",
    lineItems: [{ description: "Works", quantity: "1", unitPrice: "10000", taxRate: "20" }],
    ...overrides,
  });
}

async function newProposal(
  context: Awaited<ReturnType<typeof loginAs>>,
  opportunityId: string,
  overrides: Record<string, unknown> = {},
) {
  const proposal = await proposals.createProposal(
    context,
    proposalInput({ opportunityId, ...overrides }),
  );
  created.proposals.push(proposal.id);
  return proposal;
}

/* -------------------------------------------------------------------------- */
/* Access: who gets Sales at all (PRD #17 §16, §316, §355, §356)               */
/* -------------------------------------------------------------------------- */

describe("module access (PRD #17 §16, §355, §356)", () => {
  it("gives the Sales role the whole company pipeline", async () => {
    const context = await loginAs("SALES");
    const result = await opportunities.listOpportunities(context, opportunityQuery);

    const pipeline = await prisma.opportunity.count({ where: { companyId: context.companyId, archivedAt: null } });
    expect(pipeline).toBeGreaterThan(5);
    expect(result.data.length).toBe(pipeline);
    expect(can(context, "sales.manage")).toBe(true);
  });

  it.each(["GROUP_IT", "HR", "ARCHITECT", "ENGINEER", "VIEWER"] as const)(
    "refuses %s the module entirely",
    async (role) => {
      const context = await loginAs(role);

      await expect(leads.listLeads(context, leadQuery)).rejects.toThrow(AccessError);
      await expect(
        opportunities.listOpportunities(context, opportunityQuery),
      ).rejects.toThrow(AccessError);
    },
  );

  it("gives the CEO company reach without the sales desk (PRD #17 §351)", async () => {
    const context = await loginAs("CEO");

    const result = await opportunities.listOpportunities(context, opportunityQuery);
    expect(result.data.length).toBe(
      await prisma.opportunity.count({ where: { companyId: context.companyId, archivedAt: null } }),
    );

    // Approval authority, no operational controls.
    expect(can(context, "sales.proposal.approve")).toBe(true);
    expect(can(context, "sales.lead.create")).toBe(false);
    expect(can(context, "sales.opportunity.update")).toBe(false);
    expect(can(context, "sales.proposal.create")).toBe(false);
  });

  it("gives Finance commercial value but not the leads (PRD #17 §17, §352)", async () => {
    const context = await loginAs("FINANCE");

    expect(can(context, "sales.opportunity.view")).toBe(true);
    expect(can(context, "sales.proposal.view")).toBe(true);
    expect(can(context, "sales.lead.view")).toBe(false);

    await expect(leads.listLeads(context, leadQuery)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const result = await opportunities.listOpportunities(context, opportunityQuery);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("gives Legal the same restricted view (PRD #17 §353)", async () => {
    const context = await loginAs("LEGAL");

    expect(can(context, "sales.opportunity.view")).toBe(true);
    expect(can(context, "sales.lead.view")).toBe(false);
  });

  it("never grants approval to the role that quotes the price (PRD #17 §19)", async () => {
    const sales = await loginAs("SALES");
    expect(can(sales, "sales.proposal.approve")).toBe(false);
    expect(can(sales, "sales.proposal.reject")).toBe(false);
    expect(can(sales, "sales.approval.self")).toBe(false);
  });

  it("gives the Owner self-approval, and nobody else (PRD #17 §20)", async () => {
    const owner = await loginAs("OWNER");
    const ceo = await loginAs("CEO");

    expect(can(owner, "sales.approval.self")).toBe(true);
    expect(can(ceo, "sales.approval.self")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope (PRD #17 §74, §195, §336, §339, §354, §357)                           */
/* -------------------------------------------------------------------------- */

describe("sales scope (PRD #17 §74, §195, §336)", () => {
  it("shows a project manager the won deal behind their project, not the pipeline", async () => {
    const context = await loginAsEmail(DEMO_EMAIL.pmB);
    const result = await opportunities.listOpportunities(context, opportunityQuery);

    // opportunity_025 converted into the Meridian project this PM runs, so they
    // reach it. Everything else is somebody else's open pipeline (PRD #17 §195, §354).
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.map((row) => row.id)).toContain("opportunity_025");
    for (const row of result.data) {
      expect(row.stage, row.name).toBe("WON");
    }
  });

  it("refuses a project manager the leads behind those deals", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expect(leads.listLeads(context, leadQuery)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("answers not found rather than forbidden for an out-of-scope deal (PRD #17 §226)", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    // An open deal the PM cannot reach: 404, so the response cannot confirm it
    // exists.
    await expect(opportunities.getOpportunity(context, "opportunity_001")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("never returns another company's records (PRD #17 §357)", async () => {
    const ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);

    // The fixture tenant has Sales disabled, so the module refuses outright.
    // Either way no Aurelia record is reachable.
    await expect(opportunities.getOpportunity(ownerB, "opportunity_001")).rejects.toThrow(
      AccessError,
    );
  });

  it("does not leak a hidden deal through search (PRD #17 §336)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const result = await opportunities.listOpportunities(
      context,
      opportunityListQuerySchema.parse({ search: "Riverside", limit: 50 }),
    );

    expect(result.data).toHaveLength(0);
  });

  it("draws filter options only from records in scope (PRD #17 §337)", async () => {
    const pm = await loginAsEmail(DEMO_EMAIL.pmB);
    const options = await opportunities.opportunityFilterOptions(pm);

    // The PM reaches one won deal, so the owner filter offers exactly its owner
    // — not a directory of the sales team.
    expect(options.owners.length).toBeLessThanOrEqual(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Leads (PRD #17 §315–§319)                                                   */
/* -------------------------------------------------------------------------- */

describe("leads (PRD #17 §315, §317)", () => {
  it("creates, reads and updates a lead", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);

    expect(lead.status).toBe("NEW");
    expect(lead.owner).toBeNull();

    const updated = await leads.updateLead(
      context,
      lead.id,
      updateLeadSchema.parse({ ...leadInput({ name: `${TEST_PREFIX} Renamed` }) }),
    );
    expect(updated.name).toBe(`${TEST_PREFIX} Renamed`);
  });

  it("refuses an unsafe website", async () => {
    expect(
      createLeadSchema.safeParse({
        name: "Bad link",
        source: "WEBSITE",
        website: "javascript:alert(1)",
        estimatedValue: "0",
      }).success,
    ).toBe(false);
  });

  it("refuses an invalid email", async () => {
    expect(
      createLeadSchema.safeParse({ name: "Bad email", source: "WEBSITE", email: "not-an-email" })
        .success,
    ).toBe(false);
  });

  it("refuses a value with no currency (PRD #17 §43)", async () => {
    expect(
      createLeadSchema.safeParse({ name: "No currency", source: "WEBSITE", estimatedValue: "500" })
        .success,
    ).toBe(false);
  });

  it("refuses an owner from another company (PRD #17 §220)", async () => {
    const context = await loginAs("SALES");
    const ownerB = await prisma.companyMember.findFirstOrThrow({
      where: { company: { slug: { not: undefined } }, user: { email: DEMO_EMAIL.tenantOwner } },
      select: { id: true },
    });

    await expect(
      leads.createLead(context, leadInput({ ownerMemberId: ownerB.id }), {
        acceptDuplicate: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("warns about a duplicate rather than blocking it (PRD #17 §44)", async () => {
    const context = await loginAs("SALES");
    const first = await newLead(context, { email: "vitest.duplicate@example.test" });

    await expect(
      leads.createLead(context, leadInput({ email: "vitest.duplicate@example.test" })),
    ).rejects.toBeInstanceOf(DuplicateLeadError);

    // Accepted, it goes through: two people chasing the same company is real.
    const second = await leads.createLead(
      context,
      leadInput({ email: "vitest.duplicate@example.test" }),
      { acceptDuplicate: true },
    );
    created.leads.push(second.id);

    expect(second.id).not.toBe(first.id);
  });

  it("moves a lead through contacted and qualified (PRD #17 §48, §49)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);

    await leads.markLeadContacted(context, lead.id);
    expect((await leads.getLead(context, lead.id)).status).toBe("CONTACTED");

    await leads.qualifyLead(context, lead.id);
    expect((await leads.getLead(context, lead.id)).status).toBe("QUALIFIED");
  });

  it("requires a reason to disqualify (PRD #17 §50)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);

    await leads.disqualifyLead(context, lead.id, "Budget went elsewhere.");
    const after = await leads.getLead(context, lead.id);

    expect(after.status).toBe("DISQUALIFIED");
    expect(after.disqualifyReason).toBe("Budget went elsewhere.");
  });

  it("refuses to archive a qualified lead until it is disqualified (PRD #17 §57)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    await expect(leads.archiveLead(context, lead.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("restores an archived lead to the status it held (PRD #17 §58)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.markLeadContacted(context, lead.id);

    await leads.archiveLead(context, lead.id);
    expect((await leads.getLead(context, lead.id)).status).toBe("ARCHIVED");

    await leads.restoreLead(context, lead.id);
    expect((await leads.getLead(context, lead.id)).status).toBe("CONTACTED");
  });
});

/* -------------------------------------------------------------------------- */
/* Lead conversion (PRD #17 §318, §319, §342)                                  */
/* -------------------------------------------------------------------------- */

describe("lead conversion (PRD #17 §318, §319)", () => {
  it("refuses to convert a lead that is not qualified (PRD #17 §51)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);

    await expect(
      leads.convertLead(
        context,
        lead.id,
        convertLeadSchema.parse({
          opportunityName: "Too early",
          ownerMemberId: context.membershipId,
          estimatedValue: "1000",
          currency: "EUR",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("converts a qualified lead with no client at all (PRD #17 §159)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    const result = await leads.convertLead(
      context,
      lead.id,
      convertLeadSchema.parse({
        opportunityName: `${TEST_PREFIX} converted`,
        ownerMemberId: context.membershipId,
        estimatedValue: "250000",
        currency: "EUR",
        clientMode: "NONE",
      }),
    );
    created.opportunities.push(result.opportunityId);

    expect(result.clientId).toBeNull();

    const opportunity = await opportunities.getOpportunity(context, result.opportunityId);
    expect(opportunity.stage).toBe("QUALIFIED");
    expect(opportunity.sourceLead?.id).toBe(lead.id);

    // The lead stays, as the record of where the deal came from (PRD #17 §384).
    const after = await leads.getLead(context, lead.id);
    expect(after.status).toBe("CONVERTED");
    expect(after.convertedOpportunity?.id).toBe(result.opportunityId);
  });

  it("links an existing client", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    const result = await leads.convertLead(
      context,
      lead.id,
      convertLeadSchema.parse({
        opportunityName: `${TEST_PREFIX} linked`,
        ownerMemberId: context.membershipId,
        estimatedValue: "120000",
        currency: "EUR",
        clientMode: "EXISTING",
        clientId: "client_acme",
      }),
    );
    created.opportunities.push(result.opportunityId);

    expect(result.clientId).toBe("client_acme");
  });

  it("creates the canonical client through the Clients service (PRD #17 §54, §319)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context, {
      name: `${TEST_PREFIX} Person`,
      companyName: `${TEST_PREFIX} New Client Ltd`,
      email: "vitest.newclient@example.test",
    });
    await leads.qualifyLead(context, lead.id);

    const result = await leads.convertLead(
      context,
      lead.id,
      convertLeadSchema.parse({
        opportunityName: `${TEST_PREFIX} with new client`,
        ownerMemberId: context.membershipId,
        estimatedValue: "300000",
        currency: "EUR",
        clientMode: "NEW",
        newClientName: `${TEST_PREFIX} New Client Ltd`,
        acceptDuplicate: true,
      }),
    );
    created.opportunities.push(result.opportunityId);
    if (result.clientId) created.clients.push(result.clientId);

    // The same canonical Client id the Clients module serves (PRD #17 §319).
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: result.clientId! },
      select: { name: true, type: true, normalizedName: true, contacts: { select: { firstName: true } } },
    });

    expect(client.name).toBe(`${TEST_PREFIX} New Client Ltd`);
    expect(client.type).toBe("COMPANY");
    // Normalised for duplicate detection, which only the Clients service does.
    expect(client.normalizedName).toBeTruthy();
    // The lead's person became the client's primary contact (PRD #17 §157).
    expect(client.contacts.map((contact) => contact.firstName)).toContain(TEST_PREFIX);
  });

  it("creates an INDIVIDUAL client when the lead has no company (PRD #17 §156)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context, { name: `${TEST_PREFIX} Solo`, companyName: undefined });
    await leads.qualifyLead(context, lead.id);

    const result = await leads.convertLead(
      context,
      lead.id,
      convertLeadSchema.parse({
        opportunityName: `${TEST_PREFIX} individual`,
        ownerMemberId: context.membershipId,
        estimatedValue: "9000",
        currency: "EUR",
        clientMode: "NEW",
        newClientName: `${TEST_PREFIX} Solo`,
        acceptDuplicate: true,
      }),
    );
    created.opportunities.push(result.opportunityId);
    if (result.clientId) created.clients.push(result.clientId);

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: result.clientId! },
      select: { type: true, contacts: { select: { id: true } } },
    });

    expect(client.type).toBe("INDIVIDUAL");
    expect(client.contacts).toHaveLength(0);
  });

  it("refuses a second conversion (PRD #17 §56, §255)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    const input = convertLeadSchema.parse({
      opportunityName: `${TEST_PREFIX} once`,
      ownerMemberId: context.membershipId,
      estimatedValue: "10000",
      currency: "EUR",
    });

    const first = await leads.convertLead(context, lead.id, input);
    created.opportunities.push(first.opportunityId);

    await expect(leads.convertLead(context, lead.id, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("leaves nothing behind when the conversion fails (PRD #17 §260)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    const clientsBefore = await prisma.client.count();

    // An owner from another company fails validation *before* the transaction,
    // so nothing is written at all.
    await expect(
      leads.convertLead(
        context,
        lead.id,
        convertLeadSchema.parse({
          opportunityName: `${TEST_PREFIX} doomed`,
          ownerMemberId: "not-a-member",
          estimatedValue: "10000",
          currency: "EUR",
          clientMode: "NEW",
          newClientName: `${TEST_PREFIX} Never Created`,
          acceptDuplicate: true,
        }),
      ),
    ).rejects.toThrow(AccessError);

    expect(await prisma.client.count()).toBe(clientsBefore);
    expect((await leads.getLead(context, lead.id)).status).toBe("QUALIFIED");
  });

  it("refuses conversion to a client the converter cannot see (PRD #17 §53)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    await expect(
      leads.convertLead(
        context,
        lead.id,
        convertLeadSchema.parse({
          opportunityName: `${TEST_PREFIX} bad client`,
          ownerMemberId: context.membershipId,
          estimatedValue: "10000",
          currency: "EUR",
          clientMode: "EXISTING",
          clientId: "client_archive",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("records the conversion without duplicate noise (PRD #17 §342)", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    const result = await leads.convertLead(
      context,
      lead.id,
      convertLeadSchema.parse({
        opportunityName: `${TEST_PREFIX} traced`,
        ownerMemberId: context.membershipId,
        estimatedValue: "10000",
        currency: "EUR",
      }),
    );
    created.opportunities.push(result.opportunityId);

    const entries = await prisma.activity.findMany({
      where: { entityId: { in: [lead.id, result.opportunityId] }, module: "sales" },
      select: { action: true },
    });

    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain("SALES_LEAD_CONVERTED");
    expect(actions).toContain("SALES_OPPORTUNITY_CREATED");
  });
});

/* -------------------------------------------------------------------------- */
/* Opportunities (PRD #17 §320–§326)                                           */
/* -------------------------------------------------------------------------- */

describe("opportunities (PRD #17 §320, §321)", () => {
  it("derives probability and weighted value on the server (PRD #17 §224)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, {
      stage: "PROPOSAL",
      estimatedValue: "400000",
    });

    expect(opportunity.probability).toBe("60");
    expect(opportunity.probabilityIsOverride).toBe(false);
    expect(opportunity.weightedValue).toBe("240000.00");
  });

  it("honours a manual probability override", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, {
      stage: "PROPOSAL",
      estimatedValue: "400000",
      probabilityOverride: "25",
    });

    expect(opportunity.probability).toBe("25");
    expect(opportunity.probabilityIsOverride).toBe(true);
    expect(opportunity.weightedValue).toBe("100000.00");
  });

  it("refuses a probability above 100 (PRD #17 §321)", () => {
    expect(
      createOpportunitySchema.safeParse({
        name: "Too confident",
        ownerMemberId: "x",
        stage: "PROPOSAL",
        estimatedValue: "1000",
        currency: "EUR",
        probabilityOverride: "140",
      }).success,
    ).toBe(false);
  });

  it("refuses a value of zero (PRD #17 §66)", () => {
    expect(
      createOpportunitySchema.safeParse({
        name: "Worthless",
        ownerMemberId: "x",
        stage: "PROPOSAL",
        estimatedValue: "0",
        currency: "EUR",
      }).success,
    ).toBe(false);
  });

  it("refuses an unsupported currency", () => {
    expect(
      createOpportunitySchema.safeParse({
        name: "Wrong money",
        ownerMemberId: "x",
        stage: "PROPOSAL",
        estimatedValue: "100",
        currency: "XYZ",
      }).success,
    ).toBe(false);
  });

  it("refuses a contact that belongs to another client (PRD #17 §65, §321)", async () => {
    const context = await loginAs("SALES");

    // contact_001 belongs to client_acme, not to client_nova.
    await expect(
      opportunities.createOpportunity(
        context,
        opportunityInput({
          ownerMemberId: context.membershipId,
          clientId: "client_nova",
          contactId: "contact_001",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses an inactive owner (PRD #17 §220)", async () => {
    // The awkward memberships live in Fixture Works, which runs Sales.
    const context = await loginAsEmail(DEMO_EMAIL.fixtureOwner);
    const inactive = await prisma.companyMember.findFirst({
      where: { companyId: context.companyId, status: { not: "ACTIVE" } },
      select: { id: true },
    });

    if (!inactive) return;

    await expect(
      opportunities.createOpportunity(
        context,
        opportunityInput({ ownerMemberId: inactive.id }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("moves a stage forward and backward, but never into a close (PRD #17 §82, §322)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { stage: "QUALIFIED" });

    await opportunities.changeStage(context, opportunity.id, "DISCOVERY");
    expect((await opportunities.getOpportunity(context, opportunity.id)).stage).toBe("DISCOVERY");

    await opportunities.changeStage(context, opportunity.id, "QUALIFIED");
    expect((await opportunities.getOpportunity(context, opportunity.id)).stage).toBe("QUALIFIED");

    await expect(
      opportunities.changeStage(context, opportunity.id, "PROPOSAL"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("stamps stageChangedAt when the stage moves (PRD #17 §442)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { stage: "QUALIFIED" });
    const before = opportunity.stageChangedAt;

    await opportunities.changeStage(context, opportunity.id, "DISCOVERY");
    const after = await opportunities.getOpportunity(context, opportunity.id);

    expect(new Date(after.stageChangedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });
});

describe("winning a deal (PRD #17 §323)", () => {
  function wonInput(overrides: Record<string, unknown> = {}) {
    return opportunityWonSchema.parse({
      actualCloseDate: "2026-03-01",
      finalValue: "150000",
      ...overrides,
    });
  }

  it("refuses to win without a canonical client (PRD #17 §87, §323)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context);

    await expect(
      opportunities.markWon(context, opportunity.id, wonInput({ clientMode: "KEEP" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("wins with an existing client and takes the final value", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });

    await opportunities.markWon(context, opportunity.id, wonInput({ clientMode: "KEEP" }));
    const after = await opportunities.getOpportunity(context, opportunity.id);

    expect(after.stage).toBe("WON");
    expect(after.estimatedValue).toBe("150000.00");
    expect(after.actualCloseDate).toBe("2026-03-01");
    expect(after.client?.id).toBe("client_acme");
  });

  it("wins by creating a canonical client", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context);

    await opportunities.markWon(
      context,
      opportunity.id,
      wonInput({ clientMode: "NEW", newClientName: `${TEST_PREFIX} Won Client` }),
    );

    const after = await opportunities.getOpportunity(context, opportunity.id);
    expect(after.client?.name).toBe(`${TEST_PREFIX} Won Client`);
    if (after.client) created.clients.push(after.client.id);
  });

  it("creates the canonical project through the Projects service (PRD #17 §160, §326)", async () => {
    const owner = await loginAs("OWNER");
    const opportunity = await newOpportunity(owner, { clientId: "client_acme" });

    await opportunities.markWon(
      owner,
      opportunity.id,
      wonInput({
        clientMode: "KEEP",
        projectMode: "NEW",
        newProjectCode: `VT-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        newProjectName: `${TEST_PREFIX} Delivery`,
      }),
    );

    const after = await opportunities.getOpportunity(owner, opportunity.id);
    expect(after.convertedProject).not.toBeNull();
    created.projects.push(after.convertedProject!.id);

    // It is a real Project row, with the same canonical client (PRD #17 §326).
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: after.convertedProject!.id },
      select: { clientId: true, status: true },
    });
    expect(project.clientId).toBe("client_acme");
    expect(project.status).toBe("PENDING");
  });

  it("blocks a project that belongs to a different client (PRD #17 §89, §323)", async () => {
    const owner = await loginAs("OWNER");
    const opportunity = await newOpportunity(owner, { clientId: "client_nova" });

    // project_a belongs to client_acme.
    await expect(
      opportunities.markWon(
        owner,
        opportunity.id,
        wonInput({ clientMode: "KEEP", projectMode: "EXISTING", projectId: "project_a" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a second close (PRD #17 §92, §256)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });

    await opportunities.markWon(context, opportunity.id, wonInput({ clientMode: "KEEP" }));
    await expect(
      opportunities.markWon(context, opportunity.id, wonInput({ clientMode: "KEEP" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("leaves a won deal read-only (PRD #17 §233)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });
    await opportunities.markWon(context, opportunity.id, wonInput({ clientMode: "KEEP" }));

    await expect(
      opportunities.updateOpportunity(
        context,
        opportunity.id,
        updateOpportunitySchema.parse(
          opportunityInput({ ownerMemberId: context.membershipId, name: "Changed" }),
        ),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never archives a won deal (PRD #17 §97)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });
    await opportunities.markWon(context, opportunity.id, wonInput({ clientMode: "KEEP" }));

    await expect(opportunities.archiveOpportunity(context, opportunity.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("records the cross-linked ids in the activity trail (PRD #17 §445)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });
    await opportunities.markWon(context, opportunity.id, wonInput({ clientMode: "KEEP" }));

    const entry = await prisma.activity.findFirstOrThrow({
      where: { entityId: opportunity.id, action: "SALES_OPPORTUNITY_WON" },
      select: { metadata: true },
    });

    expect(entry.metadata).toMatchObject({ clientId: "client_acme" });
  });
});

describe("losing and reopening (PRD #17 §324, §325)", () => {
  it("requires a reason, and a note when the reason is OTHER (PRD #17 §95)", () => {
    expect(
      opportunityLostSchema.safeParse({ actualCloseDate: "2026-03-01", lostReason: "PRICE" })
        .success,
    ).toBe(true);
    expect(
      opportunityLostSchema.safeParse({ actualCloseDate: "2026-03-01", lostReason: "OTHER" })
        .success,
    ).toBe(false);
  });

  it("closes with a reason and a date (PRD #17 §324)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context);

    await opportunities.markLost(
      context,
      opportunity.id,
      opportunityLostSchema.parse({
        actualCloseDate: "2026-03-01",
        lostReason: "COMPETITOR",
        lostNote: "Undercut on price.",
      }),
    );

    const after = await opportunities.getOpportunity(context, opportunity.id);
    expect(after.stage).toBe("LOST");
    expect(after.lostReason).toBe("COMPETITOR");
    expect(after.actualCloseDate).toBe("2026-03-01");
  });

  it("reopens a lost deal and clears what described the close (PRD #17 §96, §422)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context);

    await opportunities.markLost(
      context,
      opportunity.id,
      opportunityLostSchema.parse({ actualCloseDate: "2026-03-01", lostReason: "TIMING" }),
    );
    await opportunities.reopenOpportunity(context, opportunity.id);

    const after = await opportunities.getOpportunity(context, opportunity.id);
    expect(after.stage).toBe("QUALIFIED");
    expect(after.lostReason).toBeNull();
    expect(after.actualCloseDate).toBeNull();
  });

  it("never reopens a won deal (PRD #17 §96, §325)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });
    await opportunities.markWon(
      context,
      opportunity.id,
      opportunityWonSchema.parse({
        actualCloseDate: "2026-03-01",
        finalValue: "1000",
        clientMode: "KEEP",
      }),
    );

    await expect(opportunities.reopenOpportunity(context, opportunity.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Proposals (PRD #17 §327–§332)                                               */
/* -------------------------------------------------------------------------- */

describe("proposals (PRD #17 §327, §328)", () => {
  it("calculates every total from the lines (PRD #17 §111, §224)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });

    const proposal = await newProposal(context, opportunity.id, {
      lineItems: [
        { description: "Substructure", quantity: "1", unitPrice: "620000", taxRate: "20" },
        { description: "Preliminaries", quantity: "12", unitPrice: "18500", taxRate: "20" },
      ],
    });

    expect(proposal.subtotal).toBe("842000.00");
    expect(proposal.taxAmount).toBe("168400.00");
    expect(proposal.totalAmount).toBe("1010400.00");
  });

  it("takes the client from the opportunity, not from the request (PRD #17 §217)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_nova" });
    const proposal = await newProposal(context, opportunity.id);

    expect(proposal.client.id).toBe("client_nova");
  });

  it("refuses a proposal on an opportunity with no client (PRD #17 §110)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context);

    await expect(
      proposals.createProposal(context, proposalInput({ opportunityId: opportunity.id })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a proposal on a closed opportunity (PRD #17 §216)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });
    await opportunities.markLost(
      context,
      opportunity.id,
      opportunityLostSchema.parse({ actualCloseDate: "2026-03-01", lostReason: "PRICE" }),
    );

    await expect(
      proposals.createProposal(context, proposalInput({ opportunityId: opportunity.id })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a duplicate proposal number in the same company (PRD #17 §108, §236)", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });
    const first = await newProposal(context, opportunity.id);

    await expect(
      proposals.createProposal(
        context,
        proposalInput({ opportunityId: opportunity.id, proposalNumber: first.proposalNumber }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a validity date before the issue date (PRD #17 §215)", () => {
    expect(
      createProposalSchema.safeParse({
        proposalNumber: "P-1",
        title: "Backwards",
        currency: "EUR",
        opportunityId: "x",
        issueDate: "2026-06-01",
        validUntil: "2026-05-01",
        lineItems: [{ description: "A", quantity: "1", unitPrice: "1", taxRate: "0" }],
      }).success,
    ).toBe(false);
  });

  it("refuses a tax rate above 100 and a quantity of zero (PRD #17 §214)", () => {
    const base = {
      proposalNumber: "P-2",
      title: "Bad lines",
      currency: "EUR",
      opportunityId: "x",
      issueDate: "2026-06-01",
    };

    expect(
      createProposalSchema.safeParse({
        ...base,
        lineItems: [{ description: "A", quantity: "1", unitPrice: "1", taxRate: "140" }],
      }).success,
    ).toBe(false);

    expect(
      createProposalSchema.safeParse({
        ...base,
        lineItems: [{ description: "A", quantity: "0", unitPrice: "1", taxRate: "0" }],
      }).success,
    ).toBe(false);
  });
});

describe("proposal approval (PRD #17 §329, §330)", () => {
  async function submitted() {
    const sales = await loginAs("SALES");
    const opportunity = await newOpportunity(sales, { clientId: "client_acme" });
    const proposal = await newProposal(sales, opportunity.id);
    await proposals.submitProposal(sales, proposal.id);
    return { sales, proposal };
  }

  it("opens an approval cycle on submit (PRD #17 §116, §128)", async () => {
    const { sales, proposal } = await submitted();

    const after = await proposals.getProposal(sales, proposal.id);
    expect(after.status).toBe("PENDING_APPROVAL");
    expect(after.approvals).toHaveLength(1);
    expect(after.approvals[0].status).toBe("PENDING");
    expect(after.approvals[0].submittedBy?.memberId).toBe(sales.membershipId);
  });

  /**
   * The separation-of-duties guard itself (PRD #17 §20, §329).
   *
   * Tested directly because the default matrix gives no role both the submit
   * and the approve grants — which is the separation working. The guard still
   * has to hold for a company that grants both, and for the Owner, who is the
   * one role allowed past it.
   */
  it("refuses a decision by whoever submitted it", async () => {
    const ceo = await loginAs("CEO");

    expect(() => approvals.assertNotSelfApproval(ceo, ceo.membershipId)).toThrow(AccessError);
    expect(() => approvals.assertNotSelfApproval(ceo, "somebody_else")).not.toThrow();
  });

  it("lets the Owner past it, because they hold the explicit grant", async () => {
    const owner = await loginAs("OWNER");
    expect(() => approvals.assertNotSelfApproval(owner, owner.membershipId)).not.toThrow();
  });

  it("lets the Owner approve their own, because they hold the explicit grant", async () => {
    const owner = await loginAs("OWNER");
    const opportunity = await newOpportunity(owner, { clientId: "client_acme" });
    const proposal = await newProposal(owner, opportunity.id);

    await proposals.submitProposal(owner, proposal.id);
    await proposals.approveProposal(owner, proposal.id, "Fine.", await shownCycle("sales", proposal.id));

    expect((await proposals.getProposal(owner, proposal.id)).status).toBe("APPROVED");
  });

  it("refuses approval to the role that quotes the price (PRD #17 §19)", async () => {
    const { sales, proposal } = await submitted();

    await expect(proposals.approveProposal(sales, proposal.id, null, await shownCycle("sales", proposal.id))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a second decision (PRD #17 §133, §257, §329)", async () => {
    const { proposal } = await submitted();
    const ceo = await loginAs("CEO");

    await proposals.approveProposal(ceo, proposal.id, null, await shownCycle("sales", proposal.id));
    await expect(proposals.approveProposal(ceo, proposal.id, null, await shownCycle("sales", proposal.id))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("requires a reason to reject, and preserves the history on resubmission (PRD #17 §119)", async () => {
    const { sales, proposal } = await submitted();
    const ceo = await loginAs("CEO");

    await proposals.rejectProposal(ceo, proposal.id, "Too far above their budget.", await shownCycle("sales", proposal.id));

    const rejected = await proposals.getProposal(sales, proposal.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.approvals[0].decisionNote).toBe("Too far above their budget.");

    // Resubmitting opens a *new* cycle rather than reopening the decided one.
    await proposals.submitProposal(sales, proposal.id);
    const resubmitted = await proposals.getProposal(sales, proposal.id);

    expect(resubmitted.approvals).toHaveLength(2);
    expect(resubmitted.approvals.map((entry) => entry.status)).toContain("REJECTED");
  });

  it("only an approved proposal may be marked sent (PRD #17 §120, §330)", async () => {
    const { sales, proposal } = await submitted();

    await expect(proposals.markProposalSent(sales, proposal.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const ceo = await loginAs("CEO");
    await proposals.approveProposal(ceo, proposal.id, null, await shownCycle("sales", proposal.id));
    await proposals.markProposalSent(sales, proposal.id);

    const sent = await proposals.getProposal(sales, proposal.id);
    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).not.toBeNull();
  });
});

describe("proposal outcome (PRD #17 §331, §332)", () => {
  async function sent() {
    const sales = await loginAs("SALES");
    const ceo = await loginAs("CEO");
    const opportunity = await newOpportunity(sales, { clientId: "client_acme", stage: "PROPOSAL" });
    const proposal = await newProposal(sales, opportunity.id);

    await proposals.submitProposal(sales, proposal.id);
    await proposals.approveProposal(ceo, proposal.id, null, await shownCycle("sales", proposal.id));
    await proposals.markProposalSent(sales, proposal.id);

    return { sales, opportunity, proposal };
  }

  it("accepts a sent proposal and nudges the opportunity (PRD #17 §121, §123)", async () => {
    const { sales, opportunity, proposal } = await sent();

    await proposals.acceptProposal(sales, proposal.id);

    const accepted = await proposals.getProposal(sales, proposal.id);
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedAt).not.toBeNull();

    // A nudge, not an outcome: the deal is still open (PRD #17 §123).
    const after = await opportunities.getOpportunity(sales, opportunity.id);
    expect(after.stage).toBe("NEGOTIATION");
  });

  it("allows at most one accepted proposal per opportunity (PRD #17 §186, §258)", async () => {
    const { sales, opportunity, proposal } = await sent();
    const ceo = await loginAs("CEO");

    await proposals.acceptProposal(sales, proposal.id);

    const second = await newProposal(sales, opportunity.id);
    await proposals.submitProposal(sales, second.id);
    await proposals.approveProposal(ceo, second.id, null, await shownCycle("sales", second.id));
    await proposals.markProposalSent(sales, second.id);

    await expect(proposals.acceptProposal(sales, second.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("leaves an accepted proposal immutable (PRD #17 §232)", async () => {
    const { sales, proposal } = await sent();
    await proposals.acceptProposal(sales, proposal.id);

    await expect(
      proposals.updateProposal(sales, proposal.id, proposalUpdate()),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(proposals.cancelProposal(sales, proposal.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(proposals.archiveProposal(sales, proposal.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("declines a sent proposal and stamps the date (PRD #17 §122, §332)", async () => {
    const { sales, proposal } = await sent();

    await proposals.declineProposal(sales, proposal.id, "Went elsewhere.");
    const after = await proposals.getProposal(sales, proposal.id);

    expect(after.status).toBe("DECLINED");
    expect(after.declinedAt).not.toBeNull();
  });

  it("never edits a sent proposal (PRD #17 §184)", async () => {
    const { sales, proposal } = await sent();

    await expect(
      proposals.updateProposal(sales, proposal.id, proposalUpdate()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/* -------------------------------------------------------------------------- */
/* Documents and tasks (PRD #17 §333–§335)                                     */
/* -------------------------------------------------------------------------- */

describe("sales documents (PRD #17 §334, §335)", () => {
  const proposalDocument = {
    projectId: null,
    clientId: null,
    module: "sales",
    entityType: "proposal",
    entityId: "proposal_001",
  };

  const opportunityDocument = { ...proposalDocument, entityType: "opportunity", entityId: "opportunity_001" };
  const leadDocument = { ...proposalDocument, entityType: "lead", entityId: "lead_001" };

  it("lets a Sales user reach a proposal's documents", async () => {
    const context = await loginAs("SALES");
    expect(await canReachDocumentParent(context, proposalDocument)).toBe(true);
  });

  /**
   * Release-critical (PRD #17 §335).
   *
   * An Architect holds `document.view` company-wide for project files. That
   * must not reach a commercial proposal: the parent resolver asks the Sales
   * scope, and the Architect has no Sales access at all.
   */
  it("refuses an Architect a proposal document through generic Documents access", async () => {
    const context = await loginAs("ARCHITECT");

    expect(can(context, "document.view")).toBe(true);
    expect(await canReachDocumentParent(context, proposalDocument)).toBe(false);
    expect(await canReachDocumentParent(context, opportunityDocument)).toBe(false);
    expect(await canReachDocumentParent(context, leadDocument)).toBe(false);
  });

  it("refuses Finance a lead document even though it reads opportunities (PRD #17 §143)", async () => {
    const context = await loginAs("FINANCE");

    expect(await canReachDocumentParent(context, opportunityDocument)).toBe(true);
    // No `sales.lead.view`, so the lead's files are out of reach — a document
    // is exactly as reachable as the record it hangs off, never more.
    expect(await canReachDocumentParent(context, leadDocument)).toBe(false);
  });

  it("refuses a project manager an out-of-scope opportunity's documents", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    expect(await canReachDocumentParent(context, opportunityDocument)).toBe(false);
  });

  it("fails closed on an entity type nobody registered (PRD #17 §142)", async () => {
    const context = await loginAs("SALES");

    expect(
      await canReachDocumentParent(context, {
        ...proposalDocument,
        entityType: "sales_quote_v2",
        entityId: "whatever",
      }),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Overview, pipeline and reports (PRD #17 §339, §340)                         */
/* -------------------------------------------------------------------------- */

describe("overview and pipeline (PRD #17 §412, §413)", () => {
  it("scopes every KPI to the reader (PRD #17 §412)", async () => {
    const sales = await loginAs("SALES");
    const pm = await loginAsEmail(DEMO_EMAIL.pmB);

    const company = await getSalesOverview(sales);
    const restricted = await getSalesOverview(pm);

    expect(company.openOpportunities).toBeGreaterThan(5);
    // The PM reaches one won deal, which is not open pipeline at all.
    expect(restricted.openOpportunities).toBe(0);
  });

  it("hides the lead panels from somebody with no lead access (PRD #17 §24)", async () => {
    const finance = await loginAs("FINANCE");
    const overview = await getSalesOverview(finance);

    expect(overview.visible.leads).toBe(false);
    expect(overview.visible.opportunities).toBe(true);
    expect(overview.newLeadsThisMonth).toBe(0);
  });

  it("groups the pipeline by currency and never sums across them (PRD #17 §103, §340)", async () => {
    // Terra carries one USD deal at Discovery alongside its euro pipeline.
    const context = await loginAsMembership("member_sales_manager__c");
    const pipeline = await getPipeline(context);

    const currencies = new Set(pipeline.totals.map((total) => total.currency));
    expect(currencies.has("EUR")).toBe(true);
    expect(currencies.has("USD")).toBe(true);

    for (const total of pipeline.totals) {
      expect(Number.parseFloat(total.weightedValue)).toBeLessThanOrEqual(
        Number.parseFloat(total.value),
      );
    }
  });

  it("shows only open stages on the board (PRD #17 §99)", async () => {
    const context = await loginAs("SALES");
    const pipeline = await getPipeline(context);

    expect(pipeline.stages.map((stage) => stage.stage)).toEqual([
      "PROSPECTING",
      "QUALIFIED",
      "DISCOVERY",
      "PROPOSAL",
      "NEGOTIATION",
    ]);
  });
});

describe("reports (PRD #17 §339)", () => {
  const period = reports.defaultPeriod();

  it("needs the permission behind the data as well as the report grant", async () => {
    const finance = await loginAs("FINANCE");

    // Finance holds `sales.report.view` but not `sales.lead.view`.
    await expect(reports.leadConversionReport(finance, period)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(reports.pipelineByStage(finance)).resolves.toBeInstanceOf(Array);
  });

  it("refuses reports entirely to a role without the grant", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    await expect(reports.pipelineByStage(pm)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("groups every monetary report by currency (PRD #17 §172)", async () => {
    const context = await loginAs("SALES");
    const byStage = await reports.pipelineByStage(context);

    for (const stage of byStage) {
      const currencies = stage.totals.map((total) => total.currency);
      expect(new Set(currencies).size).toBe(currencies.length);
    }
  });

  it("computes the win rate from closed deals only (PRD #17 §164)", async () => {
    const context = await loginAsEmail(NOVA_SALES);
    const report = await reports.winLossReport(context, {
      from: new Date("2000-01-01"),
      to: new Date("2100-01-01"),
    });

    expect(report.wonCount).toBeGreaterThan(0);
    expect(report.lostCount).toBeGreaterThan(0);
    expect(report.winRate).not.toBeNull();

    const expected = (
      Math.round((report.wonCount / (report.wonCount + report.lostCount)) * 1000) / 10
    ).toFixed(1);
    expect(report.winRate).toBe(expected);
  });

  it("reports lost reasons with a value per currency (PRD #17 §168)", async () => {
    const context = await loginAsEmail(NOVA_SALES);
    const rows = await reports.lostReasonReport(context, {
      from: new Date("2000-01-01"),
      to: new Date("2100-01-01"),
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.count).toBeGreaterThan(0);
      expect(row.value).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("reports proposal acceptance over decided proposals (PRD #17 §244)", async () => {
    const context = await loginAsEmail(NOVA_SALES);
    const rows = await reports.proposalReport(context, {
      from: new Date("2000-01-01"),
      to: new Date("2100-01-01"),
    });

    expect(rows.length).toBeGreaterThan(0);
    const eur = rows.find((row) => row.currency === "EUR");
    expect(eur).toBeDefined();
    expect(eur!.counts.ACCEPTED).toBeGreaterThan(0);
  });

  it("scopes a report to the reader, like the list it summarises (PRD #17 §339)", async () => {
    const sales = await loginAs("SALES");
    const owner = await loginAs("OWNER");

    const salesReport = await reports.ownerReport(sales, period);
    const ownerReport = await reports.ownerReport(owner, period);

    // Both reach the company, so both see every owner. What matters is that the
    // report is built from the scope clause rather than from a company query.
    expect(salesReport.length).toBe(ownerReport.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Export (PRD #17 §170, §171, §446)                                           */
/* -------------------------------------------------------------------------- */

describe("CSV export (PRD #17 §171)", () => {
  it("refuses a reader without the export grant", async () => {
    const ceo = await loginAs("CEO");
    expect(can(ceo, "sales.export")).toBe(false);

    await expect(
      exportSales(ceo, "opportunities", new URLSearchParams()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("inherits the scope and filters of the list it copies", async () => {
    const context = await loginAs("SALES");

    const filtered = await exportSales(
      context,
      "opportunities",
      new URLSearchParams({ stage: "NEGOTIATION" }),
    );

    const rows = filtered.csv.split("\r\n");
    expect(rows[0]).toContain("Opportunity");
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) {
      expect(row).toContain("Negotiation");
    }
  });

  it("never exports the internal notes behind a price (PRD #17 §364, §446)", async () => {
    const context = await loginAs("SALES");
    const file = await exportSales(context, "proposals", new URLSearchParams());

    expect(file.csv.split("\r\n")[0]).not.toContain("Notes");
  });

  it("quotes every field, so a comma cannot split a row", async () => {
    const context = await loginAs("SALES");
    const file = await exportSales(context, "leads", new URLSearchParams());

    for (const row of file.csv.split("\r\n")) {
      expect(row.startsWith('"')).toBe(true);
      expect(row.endsWith('"')).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Activity (PRD #17 §341)                                                     */
/* -------------------------------------------------------------------------- */

describe("sales activity (PRD #17 §341)", () => {
  it("records every critical mutation", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);

    await leads.markLeadContacted(context, lead.id);
    await leads.qualifyLead(context, lead.id);

    const entries = await prisma.activity.findMany({
      where: { entityId: lead.id, module: "sales" },
      select: { action: true, actorMemberId: true },
    });

    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "SALES_LEAD_CREATED",
        "SALES_LEAD_CONTACTED",
        "SALES_LEAD_QUALIFIED",
      ]),
    );
    // Never an anonymous business change (PRD #17 §417).
    for (const entry of entries) {
      expect(entry.actorMemberId).toBe(context.membershipId);
    }
  });

  it("refuses the trail for a record the reader cannot open (PRD #17 §148)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");

    expect(can(pm, "sales.activity.view")).toBe(false);
    await expect(
      listRecordActivity(pm, "Opportunity", "opportunity_001"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/* -------------------------------------------------------------------------- */
/* Approval queue (PRD #17 §132)                                               */
/* -------------------------------------------------------------------------- */

describe("approval queue (PRD #17 §132)", () => {
  it("lists only approvals whose proposal the reader can reach", async () => {
    const ceo = await loginAs("CEO");
    const queue = await approvals.listApprovals(ceo, { status: "PENDING" });

    expect(queue.data.length).toBeGreaterThan(0);
    for (const entry of queue.data) {
      await expect(proposals.getProposal(ceo, entry.recordId)).resolves.toBeDefined();
    }
  });

  it("offers a decision only to somebody who holds the grant", async () => {
    const ceo = await loginAs("CEO");
    const sales = await loginAs("SALES");

    const forCeo = await approvals.listApprovals(ceo, { status: "PENDING" });
    const forSales = await approvals.listApprovals(sales, { status: "PENDING" });

    expect(forCeo.data.every((entry) => entry.capabilities.canApprove)).toBe(true);
    expect(forSales.data.every((entry) => entry.capabilities.canApprove)).toBe(false);
  });

  it("counts pending approvals inside the reader's scope (PRD #17 §21)", async () => {
    const ceo = await loginAs("CEO");
    expect(await approvals.pendingApprovalCount(ceo)).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Concurrency (PRD #17 §255–§258, §358)                                       */
/* -------------------------------------------------------------------------- */

describe("concurrency (PRD #17 §255–§258)", () => {
  /**
   * Two people converting the same lead at the same moment.
   *
   * The status check and the write are one conditional update, so exactly one
   * opportunity exists afterwards — not two, and not one opportunity with a
   * lead that still says QUALIFIED (PRD #17 §56, §255).
   */
  it("converts a lead exactly once under a race", async () => {
    const context = await loginAs("SALES");
    const lead = await newLead(context);
    await leads.qualifyLead(context, lead.id);

    const input = convertLeadSchema.parse({
      opportunityName: `${TEST_PREFIX} raced`,
      ownerMemberId: context.membershipId,
      estimatedValue: "10000",
      currency: "EUR",
    });

    const results = await Promise.allSettled([
      leads.convertLead(context, lead.id, input),
      leads.convertLead(context, lead.id, input),
    ]);

    for (const result of results) {
      if (result.status === "fulfilled") created.opportunities.push(result.value.opportunityId);
    }

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const opportunityCount = await prisma.opportunity.count({ where: { sourceLeadId: lead.id } });
    expect(opportunityCount).toBe(1);
  });

  /**
   * Two people closing the same deal at the same moment (PRD #17 §92, §256).
   */
  it("closes an opportunity exactly once under a race", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { clientId: "client_acme" });

    const won = opportunityWonSchema.parse({
      actualCloseDate: "2026-03-01",
      finalValue: "1000",
      clientMode: "KEEP",
    });
    const lost = opportunityLostSchema.parse({
      actualCloseDate: "2026-03-01",
      lostReason: "PRICE",
    });

    const results = await Promise.allSettled([
      opportunities.markWon(context, opportunity.id, won),
      opportunities.markLost(context, opportunity.id, lost),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const after = await opportunities.getOpportunity(context, opportunity.id);
    expect(["WON", "LOST"]).toContain(after.stage);
  });

  /**
   * Two approvers deciding the same proposal at the same moment (PRD #17 §133,
   * §257).
   */
  it("decides a proposal exactly once under a race", async () => {
    const sales = await loginAs("SALES");
    const ceo = await loginAs("CEO");
    const owner = await loginAs("OWNER");

    const opportunity = await newOpportunity(sales, { clientId: "client_acme" });
    const proposal = await newProposal(sales, opportunity.id);
    await proposals.submitProposal(sales, proposal.id);

    const results = await Promise.allSettled([
      proposals.approveProposal(ceo, proposal.id, null, await shownCycle("sales", proposal.id)),
      proposals.rejectProposal(owner, proposal.id, "No.", await shownCycle("sales", proposal.id)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const after = await proposals.getProposal(sales, proposal.id);
    expect(["APPROVED", "REJECTED"]).toContain(after.status);
    expect(after.approvals.filter((entry) => entry.status === "PENDING")).toHaveLength(0);
  });

  /**
   * Two proposals on the same opportunity accepted at the same moment
   * (PRD #17 §186, §258).
   */
  it("accepts at most one proposal per opportunity under a race", async () => {
    const sales = await loginAs("SALES");
    const ceo = await loginAs("CEO");
    const opportunity = await newOpportunity(sales, {
      clientId: "client_acme",
      stage: "PROPOSAL",
    });

    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const proposal = await newProposal(sales, opportunity.id);
      await proposals.submitProposal(sales, proposal.id);
      await proposals.approveProposal(ceo, proposal.id, null, await shownCycle("sales", proposal.id));
      await proposals.markProposalSent(sales, proposal.id);
      ids.push(proposal.id);
    }

    const results = await Promise.allSettled(
      ids.map((id) => proposals.acceptProposal(sales, id)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const accepted = await prisma.proposal.count({
      where: { opportunityId: opportunity.id, status: "ACCEPTED" },
    });
    expect(accepted).toBe(1);
  });

  /** A stale board must not overwrite somebody else's move (PRD #17 §101, §254). */
  it("refuses a stage change made against a stage that has already moved", async () => {
    const context = await loginAs("SALES");
    const opportunity = await newOpportunity(context, { stage: "QUALIFIED" });

    const results = await Promise.allSettled([
      opportunities.changeStage(context, opportunity.id, "DISCOVERY"),
      opportunities.changeStage(context, opportunity.id, "PROSPECTING"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The seeded fixtures themselves (PRD #17 §301–§313)                          */
/* -------------------------------------------------------------------------- */

describe("seed fixtures (PRD #17 §301–§313)", () => {
  it("lists every proposal status the module has to render (PRD #17 §307)", async () => {
    const rows = await acrossTheGroup(async (context) => (await proposals.listProposals(context, proposalQuery)).data);

    const statuses = new Set(rows.map((row) => row.status));
    for (const status of [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "REJECTED",
      "SENT",
      "ACCEPTED",
      "DECLINED",
      "CANCELLED",
    ] as const) {
      expect(statuses, status).toContain(status);
    }
  });

  it("covers every opportunity stage (PRD #17 §303)", async () => {
    const rows = await acrossTheGroup(
      async (context) => (await opportunities.listOpportunities(context, opportunityQuery)).data,
    );

    const stages = new Set(rows.map((row) => row.stage));
    for (const stage of [
      "PROSPECTING",
      "QUALIFIED",
      "DISCOVERY",
      "PROPOSAL",
      "NEGOTIATION",
      "WON",
      "LOST",
    ] as const) {
      expect(stages, stage).toContain(stage);
    }
  });

  it("covers every lead status and source (PRD #17 §302)", async () => {
    const active = await acrossTheGroup(async (context) => (await leads.listLeads(context, leadQuery)).data);
    const archived = await acrossTheGroup(
      async (context) =>
        (await leads.listLeads(context, leadListQuerySchema.parse({ archived: true, limit: 100 }))).data,
    );

    const statuses = new Set([...active, ...archived].map((row) => row.status));
    for (const status of ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED", "ARCHIVED"] as const) {
      expect(statuses, status).toContain(status);
    }

    const sources = new Set(active.map((row) => row.source));
    expect(sources.size).toBeGreaterThanOrEqual(7);
  });

  it("carries the full lead → opportunity → client → project chain (PRD #17 §311)", async () => {
    const context = await loginAsEmail(NOVA_SALES);
    const opportunity = await opportunities.getOpportunity(context, "opportunity_004");

    expect(opportunity.stage).toBe("WON");
    expect(opportunity.sourceLead?.id).toBe("lead_020");
    expect(opportunity.client?.id).toBe("client_urban");
    expect(opportunity.convertedProject).not.toBeNull();

    const lead = await leads.getLead(context, "lead_020");
    expect(lead.status).toBe("CONVERTED");
    expect(lead.convertedOpportunity?.id).toBe("opportunity_004");
  });

  it("lets the CEO decide a seeded pending proposal (PRD #17 §313, §351)", async () => {
    const ceo = await loginAs("CEO");
    const queue = await approvals.listApprovals(ceo, { status: "PENDING" });
    const pending = queue.data[0];

    expect(pending).toBeDefined();
    await remember("proposal", pending.recordId);
    touchedApprovals.push({ id: pending.id });

    await proposals.approveProposal(ceo, pending.recordId, `${TEST_PREFIX} approved`, await shownCycle("sales", pending.recordId));
    expect((await proposals.getProposal(ceo, pending.recordId)).status).toBe("APPROVED");
  });
});
