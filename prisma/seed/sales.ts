/**
 * Sales fixtures (PRD #17 §301–§313).
 *
 * Every state the Sales module has to render is present, because a screen that
 * has never been seen with data in it has never really been built:
 *
 *   leads         every status and every source, including one converted into
 *                 the opportunity that created a client (§302)
 *   opportunities every stage, owned by three different people, with and
 *                 without a client, with and without a contact, and one won
 *                 deal linked to a canonical project (§303–§305, §311)
 *   values        small, medium and large, plus a USD deal so the multi-currency
 *                 grouping is exercised rather than assumed (§306)
 *   proposals     every status, with single-line, multi-line, zero-tax and
 *                 fractional-quantity fixtures (§307, §308)
 *   approvals     two pending, two approved and one rejected, so the approval
 *                 queue is meaningful from the first login (§313)
 *   lost reasons  six of the eight, so the lost-reason report has shape (§312)
 *   tasks         canonical Tasks parented to leads and opportunities: overdue,
 *                 due today, future and completed (§309)
 *   documents     canonical Documents on an opportunity and a proposal (§310)
 *
 * The seed is idempotent: everything is addressed by a deterministic id and
 * upserted, so re-running it on an existing database converges rather than
 * duplicating.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { COMPANY_A, COMPANY_B, COMPANY_C, COMPANY_D, COMPANY_E, DEMO_COMPANY_IDS, PROJECT_IDS, companyFor, daysFromNow, type SeedMembers } from "./constants";
import { seedStoredDocument } from "./document-objects";

type Members = SeedMembers;

const EUR = "EUR";

/**
 * An opportunity is created in its project's company, or its client's; a lead
 * in the company it was pitched to; a proposal, approval, task or file follows
 * the record it belongs to. The salesperson is each company's own — or the
 * group's head of Sales where a company has none (E-06 §105, §111).
 */
export async function seedSalesRecords(prisma: PrismaClient, members: Members) {
  await seedLeads(prisma, members);
  await seedOpportunities(prisma, members);
  await seedProposals(prisma, members);
  await seedApprovals(prisma, members);
  await seedSalesTasks(prisma, members);
  await seedSalesDocuments(prisma, members);

  const demo = { companyId: { in: DEMO_COMPANY_IDS } };
  return {
    leads: await prisma.lead.count({ where: demo }),
    opportunities: await prisma.opportunity.count({ where: demo }),
    proposals: await prisma.proposal.count({ where: demo }),
    approvals: await prisma.salesApproval.count({ where: demo }),
  };
}

/* -------------------------------------------------------------------------- */
/* Leads (PRD #17 §301, §302)                                                  */
/* -------------------------------------------------------------------------- */

type LeadFixture = {
  id: string;
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  website?: string;
  source: "WEBSITE" | "REFERRAL" | "OUTBOUND" | "EVENT" | "PARTNER" | "SOCIAL" | "DIRECT" | "OTHER";
  status: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED" | "ARCHIVED";
  value?: number;
  /** Days ago the lead arrived. */
  age: number;
  owner?: "sales" | "owner";
  disqualifyReason?: string;
};

const LEADS: LeadFixture[] = [
  { id: "lead_001", name: "Mira Kola", companyName: "Harbor Development", email: "mira.kola@harbor.test", phone: "+355 69 200 0001", website: "https://harbor.test", source: "REFERRAL", status: "QUALIFIED", value: 120000, age: 12 },
  { id: "lead_002", name: "Tomas Berg", companyName: "Northwind Logistics", email: "tomas@northwind.test", phone: "+355 69 200 0002", source: "WEBSITE", status: "NEW", value: 45000, age: 2 },
  { id: "lead_003", name: "Ilir Prifti", companyName: "Adriatic Hotels", email: "ilir@adriatic.test", source: "EVENT", status: "CONTACTED", value: 380000, age: 9 },
  { id: "lead_004", name: "Sara Lund", companyName: "Baltic Retail", email: "sara@baltic.test", source: "OUTBOUND", status: "QUALIFIED", value: 260000, age: 20 },
  { id: "lead_005", name: "Redi Shehu", source: "SOCIAL", status: "NEW", value: 18000, age: 1 },
  { id: "lead_006", name: "Ana Ferri", companyName: "Ferri Costruzioni", email: "ana@ferri.test", source: "PARTNER", status: "CONTACTED", value: 540000, age: 30 },
  { id: "lead_007", name: "Blerim Gashi", companyName: "Gashi Group", email: "blerim@gashi.test", source: "DIRECT", status: "DISQUALIFIED", value: 90000, age: 44, disqualifyReason: "No budget this financial year." },
  { id: "lead_008", name: "Nora Bianchi", companyName: "Bianchi Studio", email: "nora@bianchi.test", source: "REFERRAL", status: "DISQUALIFIED", value: 30000, age: 60, disqualifyReason: "Duplicate of an existing client enquiry." },
  { id: "lead_009", name: "Petar Novak", companyName: "Novak Industries", email: "petar@novak.test", source: "OTHER", status: "ARCHIVED", value: 75000, age: 90 },
  { id: "lead_010", name: "Lea Marku", companyName: "Marku Retail", email: "lea@marku.test", source: "WEBSITE", status: "NEW", value: 62000, age: 4, owner: "owner" },
  { id: "lead_011", name: "Gent Hoxha", companyName: "Hoxha Transport", email: "gent@hoxha.test", source: "OUTBOUND", status: "CONTACTED", value: 210000, age: 16 },
  { id: "lead_012", name: "Julia Sanz", companyName: "Sanz Arquitectura", email: "julia@sanz.test", source: "EVENT", status: "QUALIFIED", value: 410000, age: 25 },
  { id: "lead_013", name: "Marko Ilic", companyName: "Ilic Construction", email: "marko@ilic.test", source: "PARTNER", status: "NEW", value: 155000, age: 6 },
  { id: "lead_014", name: "Elsa Duro", source: "SOCIAL", status: "CONTACTED", value: 24000, age: 11 },
  { id: "lead_015", name: "Filip Novotny", companyName: "Novotny Facilities", email: "filip@novotny.test", source: "WEBSITE", status: "QUALIFIED", value: 330000, age: 34, owner: "owner" },
  { id: "lead_016", name: "Dea Rexha", companyName: "Rexha Interiors", email: "dea@rexha.test", source: "DIRECT", status: "NEW", value: 38000, age: 3 },
  { id: "lead_017", name: "Alban Toska", companyName: "Toska Energy", email: "alban@toska.test", source: "REFERRAL", status: "CONTACTED", value: 720000, age: 22 },
  { id: "lead_018", name: "Sofia Greco", companyName: "Greco Marine", email: "sofia@greco.test", source: "EVENT", status: "QUALIFIED", value: 480000, age: 40 },
  { id: "lead_019", name: "Kreshnik Bala", companyName: "Bala Holdings", email: "kreshnik@bala.test", source: "OUTBOUND", status: "NEW", value: 96000, age: 5 },
  // The converted one: it produced `opportunity_004` and `client_urban`
  // below, which is the whole lead → opportunity → client chain (§302, §311).
  { id: "lead_020", name: "Ardit Meta", companyName: "Urban Core", email: "ardit@urbancore.test", phone: "+355 69 200 0020", source: "REFERRAL", status: "CONVERTED", value: 780000, age: 120 },
];

/**
 * The company a lead was pitched to. Most came to Aurelia; the converted one
 * became Nova's client, and a handful fit another company's line of business.
 */
const LEAD_COMPANY: Record<string, string> = {
  lead_002: COMPANY_C,
  lead_003: COMPANY_E,
  lead_004: COMPANY_B,
  lead_011: COMPANY_C,
  lead_018: COMPANY_D,
  lead_020: COMPANY_E,
};

const leadCompany = (leadId: string) => LEAD_COMPANY[leadId] ?? COMPANY_A;

async function seedLeads(prisma: PrismaClient, members: Members) {
  for (const lead of LEADS) {
    const archived = lead.status === "ARCHIVED";
    const companyId = leadCompany(lead.id);
    const sales = members.in(companyId, "user_sales");
    const owner = members.in(companyId, "user_owner");

    await prisma.lead.upsert({
      where: { id: lead.id },
      update: {},
      create: {
        id: lead.id,
        companyId,
        name: lead.name,
        companyName: lead.companyName ?? null,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        website: lead.website ?? null,
        source: lead.source,
        status: lead.status,
        // An archived lead remembers where it was, so Restore in the demo puts
        // it back rather than resetting it to New (PRD #17 §58).
        preArchiveStatus: archived ? "CONTACTED" : null,
        ownerMemberId: lead.owner === "owner" ? owner : sales,
        estimatedValue: lead.value ? new Prisma.Decimal(lead.value) : null,
        currency: lead.value ? EUR : null,
        disqualifyReason: lead.disqualifyReason ?? null,
        convertedAt: lead.status === "CONVERTED" ? daysFromNow(-90) : null,
        convertedClientId: lead.status === "CONVERTED" ? "client_urban" : null,
        createdByMemberId: sales,
        createdAt: daysFromNow(-lead.age),
        archivedAt: archived ? daysFromNow(-30) : null,
        archivedByMemberId: archived ? sales : null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Opportunities (PRD #17 §303–§306, §311, §312)                               */
/* -------------------------------------------------------------------------- */

type OpportunityFixture = {
  id: string;
  name: string;
  client: string | null;
  contact?: string;
  owner: "sales" | "owner" | "ceo";
  stage: "PROSPECTING" | "QUALIFIED" | "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
  value: number;
  currency?: string;
  /** Days from today. Negative is in the past. */
  close: number | null;
  probability?: number;
  nextStep?: string;
  sourceLead?: string;
  project?: string;
  lostReason?: "PRICE" | "COMPETITOR" | "TIMING" | "NO_BUDGET" | "NO_RESPONSE" | "SCOPE_MISMATCH" | "INTERNAL_DECISION" | "OTHER";
  lostNote?: string;
  wonReason?: string;
  archived?: boolean;
  /** Days ago the stage last moved, for pipeline aging (PRD #17 §443). */
  stageAge?: number;
};

const OPPORTUNITIES: OpportunityFixture[] = [
  { id: "opportunity_001", name: "Riverside phase 2", client: "client_acme", contact: "contact_001", owner: "sales", stage: "NEGOTIATION", value: 1850000, close: 45, nextStep: "Agree final retention terms with Ana.", stageAge: 8 },
  { id: "opportunity_002", name: "Beta head office refurb", client: "client_beta", contact: "contact_003", owner: "sales", stage: "PROPOSAL", value: 640000, close: 30, nextStep: "Send revised proposal.", stageAge: 5 },
  { id: "opportunity_003", name: "Meridian marina retail", client: "client_meridian", owner: "sales", stage: "QUALIFIED", value: 920000, close: 90, nextStep: "Book site visit.", stageAge: 14 },
  // The full canonical chain: lead → opportunity → client → project (§311).
  { id: "opportunity_004", name: "Urban Core plaza", client: "client_urban", owner: "sales", stage: "WON", value: 780000, close: -20, sourceLead: "lead_020", project: PROJECT_IDS.e, wonReason: "Existing relationship and the fastest programme.", stageAge: 20 },
  { id: "opportunity_005", name: "Atlas cold storage", client: "client_atlas", owner: "owner", stage: "PROSPECTING", value: 430000, close: 120, stageAge: 3 },
  { id: "opportunity_006", name: "Nova Living block A", client: "client_nova", contact: "contact_008", owner: "sales", stage: "PROPOSAL", value: 1200000, close: 60, nextStep: "Chase the commercial director.", stageAge: 11 },
  { id: "opportunity_007", name: "Horizon coastal villas", client: "client_horizon", owner: "sales", stage: "DISCOVERY", value: 2100000, close: 150, nextStep: "Workshop the phasing options.", stageAge: 6 },
  { id: "opportunity_008", name: "Delta workspace fitout", client: "client_delta", owner: "sales", stage: "LOST", value: 260000, close: -40, lostReason: "PRICE", lostNote: "Undercut by 14% on the fit-out package.", stageAge: 40 },
  { id: "opportunity_009", name: "Greenline villas package", client: "client_greenline", owner: "sales", stage: "NEGOTIATION", value: 1450000, close: 35, nextStep: "Legal reviewing the draft contract.", stageAge: 9 },
  { id: "opportunity_010", name: "Municipality civic hall", client: "client_municipality", owner: "ceo", stage: "QUALIFIED", value: 3300000, close: 210, nextStep: "Await the formal tender notice.", stageAge: 18 },
  { id: "opportunity_011", name: "ACME logistics annex", client: "client_acme", owner: "sales", stage: "WON", value: 540000, close: -75, wonReason: "Repeat client, no competitive tender.", stageAge: 75 },
  { id: "opportunity_012", name: "Beta parking structure", client: "client_beta", owner: "sales", stage: "PROPOSAL", value: 380000, close: 25, nextStep: "Present to the board on the 14th.", stageAge: 4 },
  // No client yet: an opportunity may mature before there is a customer record,
  // and this fixture proves the "cannot be won without one" rule (§305, §87).
  { id: "opportunity_013", name: "Unnamed industrial park", client: null, owner: "sales", stage: "PROSPECTING", value: 890000, close: 180, stageAge: 2 },
  { id: "opportunity_014", name: "Coastal resort masterplan", client: null, owner: "sales", stage: "QUALIFIED", value: 1650000, close: null, stageAge: 25 },
  // Foreign currency, so the pipeline is grouped rather than summed (§306).
  { id: "opportunity_015", name: "Atlas US distribution hub", client: "client_atlas", owner: "owner", stage: "DISCOVERY", value: 1250000, currency: "USD", close: 100, nextStep: "Confirm the US entity structure.", stageAge: 12 },
  { id: "opportunity_016", name: "Nova retail units", client: "client_nova", owner: "sales", stage: "PROSPECTING", value: 95000, close: 75, stageAge: 7 },
  { id: "opportunity_017", name: "Horizon clubhouse", client: "client_horizon", owner: "sales", stage: "LOST", value: 320000, close: -25, lostReason: "TIMING", lostNote: "Deferred to next year's capital plan.", stageAge: 25 },
  { id: "opportunity_018", name: "Meridian office refit", client: "client_meridian", owner: "owner", stage: "LOST", value: 180000, close: -55, lostReason: "COMPETITOR", stageAge: 55 },
  { id: "opportunity_019", name: "Greenline landscaping", client: "client_greenline", owner: "sales", stage: "LOST", value: 74000, close: -15, lostReason: "NO_BUDGET", stageAge: 15 },
  { id: "opportunity_020", name: "Delta signage package", client: "client_delta", owner: "sales", stage: "LOST", value: 42000, close: -8, lostReason: "NO_RESPONSE", stageAge: 8 },
  { id: "opportunity_021", name: "Municipality library annex", client: "client_municipality", owner: "ceo", stage: "LOST", value: 610000, close: -100, lostReason: "OTHER", lostNote: "Procurement was cancelled after a change of administration.", stageAge: 100 },
  // Overdue expected close, so the attention list has something in it (§405).
  { id: "opportunity_022", name: "Urban Core annex", client: "client_urban", owner: "sales", stage: "NEGOTIATION", value: 295000, close: -6, nextStep: "Client promised a decision last week.", stageAge: 30 },
  { id: "opportunity_023", name: "Nova phase 3 enabling works", client: "client_nova", owner: "sales", stage: "DISCOVERY", value: 505000, close: 65, probability: 55, nextStep: "Value-engineer the substructure.", stageAge: 10 },
  // Archived, with its stage preserved (§62).
  { id: "opportunity_024", name: "Archived pilot enquiry", client: "client_beta", owner: "sales", stage: "PROSPECTING", value: 51000, close: null, archived: true, stageAge: 70 },
  // A won deal handed to a project the *Project Manager* runs, which is the
  // fixture the PROJECT-scoped Sales experience needs: they receive this deal
  // because they are delivering it, and nothing else (PRD #17 §195, §354).
  { id: "opportunity_025", name: "Central Office Tower fit-out", client: "client_beta", owner: "sales", stage: "WON", value: 1120000, close: -110, project: PROJECT_IDS.b, wonReason: "Incumbent contractor on the shell and core.", stageAge: 110 },
];

const OPPORTUNITY_COMPANY = new Map(OPPORTUNITIES.map((opportunity) => [opportunity.id, companyFor(opportunity)]));

const opportunityCompany = (opportunityId: string) => OPPORTUNITY_COMPANY.get(opportunityId)!;

async function seedOpportunities(prisma: PrismaClient, members: Members) {
  for (const opportunity of OPPORTUNITIES) {
    const closed = opportunity.stage === "WON" || opportunity.stage === "LOST";
    const companyId = opportunityCompany(opportunity.id);
    const owners = {
      sales: members.in(companyId, "user_sales"),
      owner: members.in(companyId, "user_owner"),
      ceo: members.in(companyId, "user_ceo"),
    };

    await prisma.opportunity.upsert({
      where: { id: opportunity.id },
      update: {},
      create: {
        id: opportunity.id,
        companyId,
        name: opportunity.name,
        clientId: opportunity.client,
        contactId: opportunity.contact ?? null,
        ownerMemberId: owners[opportunity.owner],
        stage: opportunity.stage,
        preArchiveStage: opportunity.archived ? opportunity.stage : null,
        stageChangedAt: daysFromNow(-(opportunity.stageAge ?? 5)),
        estimatedValue: new Prisma.Decimal(opportunity.value),
        currency: opportunity.currency ?? EUR,
        probabilityOverride:
          opportunity.probability === undefined
            ? null
            : new Prisma.Decimal(opportunity.probability),
        expectedCloseDate: opportunity.close === null ? null : daysFromNow(opportunity.close),
        actualCloseDate: closed ? daysFromNow(opportunity.close ?? -1) : null,
        nextStep: opportunity.nextStep ?? null,
        sourceLeadId: opportunity.sourceLead ?? null,
        convertedProjectId: opportunity.project ?? null,
        wonReason: opportunity.wonReason ?? null,
        lostReason: opportunity.lostReason ?? null,
        lostNote: opportunity.lostNote ?? null,
        createdByMemberId: owners.sales,
        createdAt: daysFromNow(-(opportunity.stageAge ?? 5) - 20),
        archivedAt: opportunity.archived ? daysFromNow(-30) : null,
        archivedByMemberId: opportunity.archived ? owners.sales : null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Proposals (PRD #17 §307, §308)                                              */
/* -------------------------------------------------------------------------- */

type ProposalLine = { description: string; quantity: string; unitPrice: string; taxRate: string };

type ProposalFixture = {
  id: string;
  number: string;
  title: string;
  opportunity: string;
  client: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SENT" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "ARCHIVED";
  currency?: string;
  /** Days from today; null when the proposal carries no validity date. */
  validFor: number | null;
  lines: ProposalLine[];
};

const PROPOSALS: ProposalFixture[] = [
  { id: "proposal_001", number: "PROP-2026-001", title: "Riverside phase 2 — main works", opportunity: "opportunity_001", client: "client_acme", status: "SENT", validFor: 20, lines: [
    { description: "Substructure and piling", quantity: "1", unitPrice: "620000", taxRate: "20" },
    { description: "Superstructure frame", quantity: "1", unitPrice: "880000", taxRate: "20" },
    { description: "Preliminaries", quantity: "12", unitPrice: "18500", taxRate: "20" },
  ] },
  // Expiring inside the warning window, so the attention list has one (§402).
  { id: "proposal_002", number: "PROP-2026-002", title: "Beta head office refurb", opportunity: "opportunity_002", client: "client_beta", status: "SENT", validFor: 4, lines: [
    { description: "Strip-out and making good", quantity: "1", unitPrice: "96000", taxRate: "20" },
    { description: "Mechanical and electrical fit-out", quantity: "1", unitPrice: "412000", taxRate: "20" },
  ] },
  // Single line, zero tax (§308).
  { id: "proposal_003", number: "PROP-2026-003", title: "Meridian marina — feasibility", opportunity: "opportunity_003", client: "client_meridian", status: "DRAFT", validFor: 45, lines: [
    { description: "Feasibility study, fixed fee", quantity: "1", unitPrice: "38000", taxRate: "0" },
  ] },
  { id: "proposal_004", number: "PROP-2026-004", title: "Nova Living block A", opportunity: "opportunity_006", client: "client_nova", status: "PENDING_APPROVAL", validFor: 30, lines: [
    { description: "Design and build package", quantity: "1", unitPrice: "1080000", taxRate: "20" },
    { description: "Statutory fees", quantity: "1", unitPrice: "24000", taxRate: "0" },
  ] },
  { id: "proposal_005", number: "PROP-2026-005", title: "Beta parking structure", opportunity: "opportunity_012", client: "client_beta", status: "PENDING_APPROVAL", validFor: 21, lines: [
    { description: "Precast deck supply and erect", quantity: "1", unitPrice: "298000", taxRate: "20" },
  ] },
  { id: "proposal_006", number: "PROP-2026-006", title: "Greenline villas — package A", opportunity: "opportunity_009", client: "client_greenline", status: "APPROVED", validFor: 40, lines: [
    { description: "Villa shell, type A", quantity: "8", unitPrice: "118000", taxRate: "20" },
    { description: "External works", quantity: "1", unitPrice: "215000", taxRate: "20" },
  ] },
  // Fractional quantity (§308).
  { id: "proposal_007", number: "PROP-2026-007", title: "Horizon coastal villas — concept", opportunity: "opportunity_007", client: "client_horizon", status: "APPROVED", validFor: 60, lines: [
    { description: "Concept design, senior architect", quantity: "112.5", unitPrice: "145", taxRate: "20" },
    { description: "Concept design, technician", quantity: "86.25", unitPrice: "78", taxRate: "20" },
  ] },
  { id: "proposal_008", number: "PROP-2026-008", title: "Urban Core plaza — main works", opportunity: "opportunity_004", client: "client_urban", status: "ACCEPTED", validFor: -10, lines: [
    { description: "Plaza hard landscaping", quantity: "1", unitPrice: "465000", taxRate: "20" },
    { description: "Lighting and services", quantity: "1", unitPrice: "185000", taxRate: "20" },
  ] },
  { id: "proposal_009", number: "PROP-2026-009", title: "Delta workspace fitout", opportunity: "opportunity_008", client: "client_delta", status: "DECLINED", validFor: -30, lines: [
    { description: "Cat B fit-out", quantity: "1", unitPrice: "228000", taxRate: "20" },
  ] },
  { id: "proposal_010", number: "PROP-2026-010", title: "Nova Living block A — first offer", opportunity: "opportunity_006", client: "client_nova", status: "REJECTED", validFor: 15, lines: [
    { description: "Design and build package", quantity: "1", unitPrice: "1240000", taxRate: "20" },
  ] },
  { id: "proposal_011", number: "PROP-2026-011", title: "Riverside phase 2 — withdrawn offer", opportunity: "opportunity_001", client: "client_acme", status: "CANCELLED", validFor: -5, lines: [
    { description: "Main works, superseded pricing", quantity: "1", unitPrice: "1920000", taxRate: "20" },
  ] },
  { id: "proposal_012", number: "PROP-2026-012", title: "Atlas US distribution hub", opportunity: "opportunity_015", client: "client_atlas", status: "DRAFT", currency: "USD", validFor: 50, lines: [
    { description: "Warehouse shell, design and build", quantity: "1", unitPrice: "1050000", taxRate: "0" },
    { description: "Racking and fit-out", quantity: "1", unitPrice: "190000", taxRate: "0" },
  ] },
];

/**
 * Line arithmetic, identical to the service's (PRD #17 §111).
 *
 * The seed rounds each line to currency precision and sums the rounded lines,
 * exactly as `calculateProposal` does — so a seeded proposal's total is the
 * same total the module would have written.
 */
function calculate(lines: ProposalLine[]) {
  let subtotal = new Prisma.Decimal(0);
  let taxAmount = new Prisma.Decimal(0);
  let totalAmount = new Prisma.Decimal(0);

  const calculated = lines.map((line, index) => {
    const lineSubtotal = new Prisma.Decimal(line.quantity)
      .times(line.unitPrice)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const lineTax = lineSubtotal
      .times(line.taxRate)
      .dividedBy(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const lineTotal = lineSubtotal.plus(lineTax);

    subtotal = subtotal.plus(lineSubtotal);
    taxAmount = taxAmount.plus(lineTax);
    totalAmount = totalAmount.plus(lineTotal);

    return {
      description: line.description,
      quantity: new Prisma.Decimal(line.quantity),
      unitPrice: new Prisma.Decimal(line.unitPrice),
      taxRate: new Prisma.Decimal(line.taxRate),
      subtotal: lineSubtotal,
      taxAmount: lineTax,
      totalAmount: lineTotal,
      sortOrder: index,
    };
  });

  return { lines: calculated, subtotal, taxAmount, totalAmount };
}

const proposalCompany = (proposalId: string) =>
  opportunityCompany(PROPOSALS.find((proposal) => proposal.id === proposalId)!.opportunity);

async function seedProposals(prisma: PrismaClient, members: Members) {
  for (const proposal of PROPOSALS) {
    const totals = calculate(proposal.lines);
    const companyId = opportunityCompany(proposal.opportunity);
    const sales = members.in(companyId, "user_sales");
    const sent = ["SENT", "ACCEPTED", "DECLINED"].includes(proposal.status);

    await prisma.proposal.upsert({
      where: { id: proposal.id },
      update: {},
      create: {
        id: proposal.id,
        companyId,
        proposalNumber: proposal.number,
        opportunityId: proposal.opportunity,
        clientId: proposal.client,
        title: proposal.title,
        currency: proposal.currency ?? EUR,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        validUntil: proposal.validFor === null ? null : daysFromNow(proposal.validFor),
        status: proposal.status,
        sentAt: sent ? daysFromNow(-14) : null,
        acceptedAt: proposal.status === "ACCEPTED" ? daysFromNow(-8) : null,
        declinedAt: proposal.status === "DECLINED" ? daysFromNow(-12) : null,
        createdByMemberId: sales,
        createdAt: daysFromNow(-25),
        lineItems: { create: totals.lines },
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Approvals (PRD #17 §313)                                                    */
/* -------------------------------------------------------------------------- */

const APPROVALS = [
  { id: "sales_approval_001", proposal: "proposal_004", status: "PENDING" as const },
  { id: "sales_approval_002", proposal: "proposal_005", status: "PENDING" as const },
  { id: "sales_approval_003", proposal: "proposal_006", status: "APPROVED" as const, note: "Margin holds at this price." },
  { id: "sales_approval_004", proposal: "proposal_007", status: "APPROVED" as const, note: null },
  { id: "sales_approval_005", proposal: "proposal_010", status: "REJECTED" as const, note: "Too far above the client's stated budget — reprice." },
];

async function seedApprovals(prisma: PrismaClient, members: Members) {
  for (const approval of APPROVALS) {
    const decided = approval.status !== "PENDING";
    const companyId = proposalCompany(approval.proposal);
    const sales = members.in(companyId, "user_sales");
    const ceo = members.in(companyId, "user_ceo");

    await prisma.salesApproval.upsert({
      where: { id: approval.id },
      update: {},
      create: {
        id: approval.id,
        companyId,
        recordType: "PROPOSAL",
        recordId: approval.proposal,
        status: approval.status,
        // Submitted by Sales and decided by the CEO, which is the separation of
        // duties the module exists to enforce (PRD #17 §19, §20).
        submittedByMemberId: sales,
        submittedAt: daysFromNow(-6),
        decidedByMemberId: decided ? ceo : null,
        decidedAt: decided ? daysFromNow(-4) : null,
        decisionNote: approval.note ?? null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Sales tasks and documents (PRD #17 §309, §310)                              */
/* -------------------------------------------------------------------------- */

/**
 * Canonical Tasks, parented to sales records (PRD #17 §134, §135).
 *
 * Sales has no task table of its own: these are `Task` rows carrying
 * `module = "sales"`, so the same task appears in /tasks, in /sales/tasks and
 * on the record it belongs to — one id, three views (PRD #17 §333).
 */
const SALES_TASKS = [
  { title: "Call Mira about the harbour scheme", entityType: "lead", entityId: "lead_001", status: "TODO", due: -3 },
  { title: "Send the capability statement to Adriatic", entityType: "lead", entityId: "lead_003", status: "IN_PROGRESS", due: 0 },
  { title: "Qualify the Baltic Retail enquiry", entityType: "lead", entityId: "lead_004", status: "TODO", due: 5 },
  { title: "Log the event follow-ups", entityType: "lead", entityId: "lead_012", status: "COMPLETED", due: -10 },
  { title: "Agree retention terms with ACME", entityType: "opportunity", entityId: "opportunity_001", status: "IN_PROGRESS", due: 2 },
  { title: "Revise the Beta proposal pricing", entityType: "opportunity", entityId: "opportunity_002", status: "TODO", due: -1 },
  { title: "Book the Meridian site visit", entityType: "opportunity", entityId: "opportunity_003", status: "TODO", due: 9 },
  { title: "Prepare the Nova board presentation", entityType: "opportunity", entityId: "opportunity_006", status: "TODO", due: 14 },
  { title: "Workshop the Horizon phasing options", entityType: "opportunity", entityId: "opportunity_007", status: "IN_PROGRESS", due: 7 },
  { title: "Close out the Urban Core handover", entityType: "opportunity", entityId: "opportunity_004", status: "COMPLETED", due: -18 },
];

/** The company of the sales record a task or file hangs off. */
function recordCompany(entityType: string, entityId: string): string {
  if (entityType === "lead") return leadCompany(entityId);
  if (entityType === "proposal") return proposalCompany(entityId);
  return opportunityCompany(entityId);
}

async function seedSalesTasks(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const task of SALES_TASKS) {
    index += 1;
    const id = `task_sales_${index.toString().padStart(3, "0")}`;
    const companyId = recordCompany(task.entityType, task.entityId);
    const sales = members.in(companyId, "user_sales");

    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId,
        projectId: null,
        title: task.title,
        assigneeMemberId: sales,
        createdByMemberId: sales,
        status: task.status as "TODO" | "IN_PROGRESS" | "COMPLETED",
        priority: "MEDIUM",
        dueDate: daysFromNow(task.due),
        completedAt: task.status === "COMPLETED" ? daysFromNow(task.due - 1) : null,
        module: "sales",
        entityType: task.entityType,
        entityId: task.entityId,
        createdBy: members.userIn(companyId, "user_sales"),
      },
    });
  }
}

/**
 * Canonical Documents on sales records (PRD #17 §141, §310).
 *
 * The same rule as Tasks: `module = "sales"` with an `entityType` the Documents
 * parent-access registry knows about, so reaching one of these files requires
 * reaching the record it hangs off (PRD #17 §143).
 */
const SALES_DOCUMENTS = [
  { name: "Client Brief.pdf", entityType: "opportunity", entityId: "opportunity_001" },
  { name: "RFP.pdf", entityType: "opportunity", entityId: "opportunity_006" },
  { name: "Commercial Proposal.pdf", entityType: "proposal", entityId: "proposal_001" },
  { name: "Scope Attachment.pdf", entityType: "proposal", entityId: "proposal_006" },
  { name: "Harbor enquiry notes.pdf", entityType: "lead", entityId: "lead_001" },
];

async function seedSalesDocuments(prisma: PrismaClient, members: Members) {
  let index = 0;
  for (const document of SALES_DOCUMENTS) {
    index += 1;
    const companyId = recordCompany(document.entityType, document.entityId);
    await seedStoredDocument(prisma, {
      id: `document_sales_${index.toString().padStart(2, "0")}`,
      companyId,
      name: document.name,
      module: "sales",
      entityType: document.entityType,
      entityId: document.entityId,
      uploadedByMemberId: members.in(companyId, "user_sales"),
      createdBy: members.userIn(companyId, "user_sales"),
    });
  }
}
