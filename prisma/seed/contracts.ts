/**
 * Legal / Contracts fixtures (PRD #18 §406–§417).
 *
 * Every state the module has to render is present, because a screen that has
 * never been seen with data in it has never really been built:
 *
 *   contracts    all eleven statuses and eight of the ten types, across four
 *                projects, five clients and one with no client at all
 *                (§407–§410)
 *   sales source one contract from a won opportunity and one from the accepted
 *                proposal behind it, so the handoff is real (§411)
 *   expiry       15, 45 and 90 days ahead, one expired last month, one evergreen
 *                with no expiry date at all (§412)
 *   renewal      NONE, MANUAL, AUTO_RENEW and EVERGREEN (§413)
 *   parties      our company, clients, a guarantor and a subcontractor, with
 *                one primary counterparty each (§406)
 *   obligations  open, completed, cancelled and overdue-by-derivation, across
 *                six types (§414)
 *   amendments   draft, pending, approved, signed, active and cancelled — with
 *                one active amendment that raised a value and one that extended
 *                an expiry date (§415)
 *   approvals    pending and decided, on contracts and on an amendment (§416)
 *   documents    drafts, signed copies and an amendment (§417)
 *
 * The seed is idempotent: everything is addressed by a deterministic id and
 * upserted, so re-running it on an existing database converges rather than
 * duplicating.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { COMPANY_A, COMPANY_B, PROJECT_IDS, daysFromNow } from "./constants";
import { seedStoredDocument } from "./document-objects";

type Members = Map<string, string>;

const EUR = "EUR";

export async function seedContractRecords(prisma: PrismaClient, members: Members) {
  const legal = members.get("user_legal")!;
  const owner = members.get("user_owner")!;
  const ceo = members.get("user_ceo")!;
  const pm = members.get("user_pm")!;

  await seedContracts(prisma, { legal, owner, pm });
  await seedParties(prisma);
  // Amendments first: one obligation is sourced from an amendment, and the
  // foreign key is real (PRD #18 §337).
  await seedAmendments(prisma, legal);
  await seedObligations(prisma, { legal, pm });
  await seedApprovals(prisma, { legal, owner, ceo });
  await seedContractTasks(prisma, legal);
  await seedContractDocuments(prisma);
  await seedCompanyBContract(prisma);

  return {
    contracts: await prisma.contract.count({ where: { companyId: COMPANY_A } }),
    parties: await prisma.contractParty.count({ where: { companyId: COMPANY_A } }),
    obligations: await prisma.contractObligation.count({ where: { companyId: COMPANY_A } }),
    amendments: await prisma.contractAmendment.count({ where: { companyId: COMPANY_A } }),
    approvals: await prisma.contractApproval.count({ where: { companyId: COMPANY_A } }),
  };
}

/* -------------------------------------------------------------------------- */
/* Company B isolation (PRD #18 §418, §462)                                    */
/* -------------------------------------------------------------------------- */

/**
 * One contract belonging to the other company.
 *
 * It exists so that isolation can be tested rather than assumed: every Company A
 * list, search, filter, report and approval queue must be provably unable to
 * reach it, and a test cannot prove that against a table where the other
 * company owns nothing (PRD #18 §418).
 *
 * Deliberately given a contract number in Company A's own series. Numbers are
 * unique per company, so this also proves the uniqueness check is scoped rather
 * than global (PRD #18 §36, §239).
 */
async function seedCompanyBContract(prisma: PrismaClient) {
  const ownerB = "member_owner_b";

  await prisma.contract.upsert({
    where: { id: "contract_b_001" },
    update: {},
    create: {
      id: "contract_b_001",
      companyId: COMPANY_B,
      contractNumber: "CTR-2026-001",
      title: "Isarwerk framework — Company B record",
      contractType: "FRAMEWORK",
      status: "ACTIVE",
      clientId: "client_b_muc",
      projectId: "project_b_one",
      ownerMemberId: ownerB,
      counterpartyName: "Isarwerk Holding GmbH",
      currency: "EUR",
      contractValue: new Prisma.Decimal("450000.00"),
      effectiveDate: daysFromNow(-120),
      expiryDate: daysFromNow(240),
      signedDate: daysFromNow(-125),
      renewalType: "MANUAL",
      renewalNoticeDays: 60,
      governingLaw: "German law",
      jurisdiction: "Munich",
      summary: "Company B record. Must never appear in a Company A result.",
      commercialNotes: "Company B commercial note. Must never leak.",
      legalNotes: "Company B legal note. Must never leak.",
      createdByMemberId: ownerB,
    },
  });

  await prisma.contractParty.upsert({
    where: { id: "contract_b_party_001" },
    update: {},
    create: {
      id: "contract_b_party_001",
      companyId: COMPANY_B,
      contractId: "contract_b_001",
      partyRole: "COUNTERPARTY",
      partyType: "COMPANY",
      name: "Isarwerk Holding",
      legalName: "Isarwerk Holding GmbH",
      clientId: "client_b_muc",
      country: "Germany",
      isPrimaryCounterparty: true,
    },
  });

  await prisma.contractObligation.upsert({
    where: { id: "contract_b_obligation_001" },
    update: {},
    create: {
      id: "contract_b_obligation_001",
      companyId: COMPANY_B,
      contractId: "contract_b_001",
      title: "Company B obligation. Must never appear in a Company A result.",
      obligationType: "DELIVERABLE",
      status: "OPEN",
      dueDate: daysFromNow(-5),
      responsibleMemberId: ownerB,
      createdByMemberId: ownerB,
    },
  });

  await prisma.contractAmendment.upsert({
    where: { id: "contract_b_amendment_001" },
    update: {},
    create: {
      id: "contract_b_amendment_001",
      companyId: COMPANY_B,
      contractId: "contract_b_001",
      amendmentNumber: "AMD-001",
      title: "Company B amendment. Must never appear in a Company A result.",
      summary: "Scope extension recorded against the Company B framework.",
      status: "PENDING_APPROVAL",
      createdByMemberId: ownerB,
    },
  });

  await prisma.contractApproval.upsert({
    where: { id: "contract_b_approval_001" },
    update: {},
    create: {
      id: "contract_b_approval_001",
      companyId: COMPANY_B,
      recordType: "AMENDMENT",
      recordId: "contract_b_amendment_001",
      status: "PENDING",
      submittedByMemberId: ownerB,
      submittedAt: daysFromNow(-2),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Contracts (PRD #18 §406–§413)                                               */
/* -------------------------------------------------------------------------- */

type ContractStatusKey =
  | "DRAFT"
  | "IN_REVIEW"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "SENT"
  | "SIGNED"
  | "ACTIVE"
  | "EXPIRED"
  | "TERMINATED"
  | "CANCELLED"
  | "ARCHIVED";

type ContractFixture = {
  id: string;
  number: string;
  title: string;
  type:
    | "CLIENT_AGREEMENT"
    | "SERVICE_AGREEMENT"
    | "PURCHASE_AGREEMENT"
    | "SUBCONTRACT"
    | "LEASE"
    | "NDA"
    | "CONSULTING"
    | "FRAMEWORK"
    | "OTHER";
  status: ContractStatusKey;
  client?: string;
  project?: string;
  opportunity?: string;
  proposal?: string;
  counterparty?: string;
  value?: number;
  currency?: string;
  /** Days from today. Negative is in the past. */
  effective?: number;
  expiry?: number;
  signed?: number;
  sent?: number;
  renewal?: "NONE" | "MANUAL" | "AUTO_RENEW" | "EVERGREEN";
  noticeDays?: number;
  renewMonths?: number;
  owner?: "legal" | "owner" | "pm";
  governingLaw?: string;
  jurisdiction?: string;
  summary?: string;
  commercialNotes?: string;
  legalNotes?: string;
  terminationDays?: number;
  terminationReason?: string;
  preArchive?: ContractStatusKey;
};

const CONTRACTS: ContractFixture[] = [
  // Live client agreements on projects a project manager can reach (§409).
  {
    id: "contract_001", number: "CTR-2026-001", title: "Riverside phase 2 — main works",
    type: "CLIENT_AGREEMENT", status: "ACTIVE", client: "client_acme", project: PROJECT_IDS.a,
    counterparty: "ACME Developments sh.p.k.", value: 8_400_000,
    effective: -220, expiry: 240, signed: -230, sent: -240,
    renewal: "NONE",
    governingLaw: "Law of Albania", jurisdiction: "Tirana, Albania",
    summary: "Design and build of the Riverside phase 2 residential blocks, including external works.",
    commercialNotes: "Retention 5%, released in two moieties. Payment terms 30 days from certification.",
    legalNotes: "Liquidated damages capped at 10% of the contract sum; parent company guarantee held.",
  },
  {
    id: "contract_002", number: "CTR-2026-002", title: "Beta head office — design appointment",
    type: "CONSULTING", status: "ACTIVE", client: "client_beta", project: PROJECT_IDS.b,
    counterparty: "Beta Properties SHPK", value: 620_000,
    effective: -180, expiry: 45, signed: -185, sent: -195,
    renewal: "MANUAL", noticeDays: 30, owner: "legal",
    governingLaw: "Law of Albania", jurisdiction: "Tirana, Albania",
    summary: "Full architectural and engineering appointment to RIBA stage 6.",
    commercialNotes: "Fee drawn monthly against a stage-weighted schedule.",
  },
  {
    id: "contract_003", number: "CTR-2026-003", title: "Meridian marina — concept services",
    type: "SERVICE_AGREEMENT", status: "ACTIVE", client: "client_meridian", project: PROJECT_IDS.c,
    counterparty: "Meridian Group", value: 180_000,
    effective: -90, expiry: 15, signed: -95, sent: -100,
    renewal: "MANUAL", noticeDays: 30,
    summary: "Concept design and feasibility for the marina retail frontage.",
    commercialNotes: "Fixed fee, invoiced in three stages.",
    legalNotes: "Client holds an option to extend into detailed design at the same rates.",
  },
  {
    id: "contract_004", number: "CTR-2026-004", title: "Atlas survey framework",
    type: "FRAMEWORK", status: "ACTIVE", client: "client_atlas", project: PROJECT_IDS.d,
    counterparty: "Atlas Holdings", value: 95_000,
    effective: -300, expiry: 90, signed: -310, sent: -320,
    renewal: "AUTO_RENEW", noticeDays: 60, renewMonths: 12,
    summary: "Call-off framework for topographic and measured building surveys.",
    commercialNotes: "Rates fixed for the first term; indexed on renewal.",
  },
  {
    id: "contract_005", number: "CTR-2026-005", title: "Urban Core plaza — main works",
    type: "CLIENT_AGREEMENT", status: "ACTIVE", client: "client_urban", project: PROJECT_IDS.f,
    // The whole chain: lead → opportunity → accepted proposal → contract
    // (PRD #18 §411, §438).
    opportunity: "opportunity_004", proposal: "proposal_008",
    counterparty: "Urban Core sh.a.", value: 780_000,
    effective: -40, expiry: 320, signed: -45, sent: -55,
    renewal: "NONE", owner: "legal",
    governingLaw: "Law of Albania", jurisdiction: "Tirana, Albania",
    summary: "Public realm works to the Urban Core plaza, following the accepted proposal PROP-2026-008.",
    commercialNotes: "Priced from the accepted proposal; provisional sums carried for the water feature.",
  },
  {
    id: "contract_006", number: "CTR-2026-006", title: "Central Office Tower — fit-out agreement",
    type: "CLIENT_AGREEMENT", status: "ACTIVE", client: "client_beta", project: PROJECT_IDS.b,
    opportunity: "opportunity_025",
    counterparty: "Beta Properties SHPK", value: 1_120_000,
    effective: -100, expiry: 600, signed: -105, sent: -115,
    renewal: "NONE", owner: "pm",
    summary: "Category B fit-out of floors 4 to 9, following the won tender.",
    commercialNotes: "Two-stage pricing; the second stage sum is fixed at GMP.",
  },
  // An evergreen agreement with no expiry date at all (§412, §413).
  {
    id: "contract_007", number: "CTR-2026-007", title: "Group services NDA — Nova Living",
    type: "NDA", status: "ACTIVE", client: "client_nova",
    counterparty: "Nova Living", renewal: "EVERGREEN",
    effective: -400, signed: -405,
    summary: "Mutual non-disclosure agreement covering all commercial discussions.",
    legalNotes: "Survives termination for five years in respect of technical information.",
  },
  // No client at all: an internal lease (§410).
  {
    id: "contract_008", number: "CTR-2026-008", title: "Head office lease — Rruga e Kavajës",
    type: "LEASE", status: "ACTIVE", counterparty: "Kavaja Property Partners",
    value: 96_000, effective: -700, expiry: 45, signed: -710,
    renewal: "AUTO_RENEW", noticeDays: 90, renewMonths: 24, owner: "owner",
    governingLaw: "Law of Albania", jurisdiction: "Tirana, Albania",
    summary: "Lease of the fourth floor, 620 m², including eight parking spaces.",
    commercialNotes: "Rent reviewed on each renewal by reference to the consumer price index.",
    legalNotes: "Break clause exercisable on nine months' notice after the second term.",
  },
  {
    id: "contract_009", number: "CTR-2026-009", title: "Façade subcontract — Riverside",
    type: "SUBCONTRACT", status: "ACTIVE", client: "client_acme", project: PROJECT_IDS.a,
    counterparty: "Vitrum Façades sh.p.k.", value: 1_240_000,
    effective: -150, expiry: 180, signed: -155, sent: -165,
    renewal: "NONE",
    summary: "Design, supply and installation of the unitised curtain wall.",
    commercialNotes: "Retention 5%; advance payment bond held for the first 20%.",
    legalNotes: "Defects liability 24 months from practical completion of the main works.",
  },
  // Everything still in flight (§407).
  {
    id: "contract_010", number: "CTR-2026-010", title: "Greenline villas — feasibility agreement",
    type: "SERVICE_AGREEMENT", status: "DRAFT", client: "client_greenline", project: PROJECT_IDS.e,
    counterparty: "Greenline Residences", value: 45_000, currency: EUR,
    effective: 30, expiry: 420, renewal: "NONE",
    summary: "Feasibility and planning strategy for the hillside villa plots.",
  },
  {
    id: "contract_011", number: "CTR-2026-011", title: "Horizon coastal villas — appointment",
    type: "CONSULTING", status: "IN_REVIEW", client: "client_horizon",
    opportunity: "opportunity_007",
    counterparty: "Horizon Estates", value: 210_000,
    effective: 20, expiry: 400, renewal: "MANUAL", noticeDays: 45,
    summary: "Concept through to planning submission for the coastal villa cluster.",
    legalNotes: "Client is pressing for unlimited liability; Legal has proposed a 2× fee cap.",
  },
  {
    id: "contract_012", number: "CTR-2026-012", title: "Municipality framework agreement",
    type: "FRAMEWORK", status: "PENDING_APPROVAL", client: "client_municipality",
    counterparty: "Central Municipality", value: 250_000,
    effective: 15, expiry: 380, renewal: "MANUAL", noticeDays: 90,
    governingLaw: "Law of Albania", jurisdiction: "Tirana Administrative Court",
    summary: "Four-year call-off framework for public building condition surveys.",
    commercialNotes: "Rates fixed for the first two years, then indexed.",
  },
  {
    id: "contract_013", number: "CTR-2026-013", title: "Delta workspace — consultancy retainer",
    type: "CONSULTING", status: "PENDING_APPROVAL", client: "client_delta",
    counterparty: "Delta Offices", value: 60_000,
    effective: 10, expiry: 375, renewal: "AUTO_RENEW", noticeDays: 30, renewMonths: 12,
    summary: "Monthly workplace strategy retainer.",
  },
  {
    id: "contract_014", number: "CTR-2026-014", title: "Nova Living block A — pre-construction",
    type: "CLIENT_AGREEMENT", status: "APPROVED", client: "client_nova",
    opportunity: "opportunity_006",
    counterparty: "Nova Living", value: 310_000,
    effective: 25, expiry: 390, renewal: "NONE",
    summary: "Pre-construction services agreement ahead of the main works contract.",
    commercialNotes: "Fee is set off against the main contract sum if it proceeds.",
  },
  {
    id: "contract_015", number: "CTR-2026-015", title: "Atlas US distribution hub — services",
    type: "SERVICE_AGREEMENT", status: "SENT", client: "client_atlas",
    counterparty: "Atlas Holdings Inc.", value: 420_000, currency: "USD",
    effective: 35, expiry: 400, sent: -6, renewal: "NONE",
    governingLaw: "Laws of the State of Delaware", jurisdiction: "Wilmington, Delaware",
    summary: "Design services for the US distribution hub. Priced and payable in dollars.",
    commercialNotes: "Dollar-denominated: never to be added to the euro portfolio total.",
  },
  {
    id: "contract_016", number: "CTR-2026-016", title: "Greenline enabling works",
    type: "SUBCONTRACT", status: "SIGNED", client: "client_greenline", project: PROJECT_IDS.e,
    counterparty: "Terra Works sh.p.k.", value: 185_000,
    // Signed, effective from today: the "ready to activate" fixture (§121).
    effective: 0, expiry: 300, signed: -3, sent: -12, renewal: "NONE",
    summary: "Site clearance, temporary access and enabling works.",
  },
  // Closed records (§407).
  {
    id: "contract_017", number: "CTR-2025-017", title: "Urban Core retention deed",
    type: "OTHER", status: "EXPIRED", client: "client_urban", project: PROJECT_IDS.f,
    counterparty: "Urban Core sh.a.", value: 120_000,
    effective: -500, expiry: -30, signed: -505, renewal: "NONE",
    summary: "Retention release deed for the first phase of the plaza works.",
  },
  {
    id: "contract_018", number: "CTR-2025-018", title: "Delta signage package",
    type: "PURCHASE_AGREEMENT", status: "TERMINATED", client: "client_delta",
    counterparty: "Signum Graphics", value: 42_000,
    effective: -240, expiry: 120, signed: -245, renewal: "NONE",
    terminationDays: -20,
    terminationReason:
      "Supplier entered insolvency proceedings. Terminated under clause 14.2 with no further liability.",
    summary: "Supply and installation of wayfinding signage.",
  },
  {
    id: "contract_019", number: "CTR-2026-019", title: "Adriatic Hotels — draft appointment",
    type: "CONSULTING", status: "CANCELLED", counterparty: "Adriatic Hotels",
    value: 88_000, effective: 45, expiry: 410, renewal: "NONE",
    summary: "Appointment drafted before the enquiry was withdrawn.",
  },
  {
    id: "contract_020", number: "CTR-2024-020", title: "Archive test contract",
    type: "OTHER", status: "ARCHIVED", client: "client_archive",
    counterparty: "Archive Test Client", value: 30_000,
    effective: -900, expiry: -200, renewal: "NONE", preArchive: "EXPIRED",
    summary: "Historical agreement retained for the archive view.",
  },
];

async function seedContracts(
  prisma: PrismaClient,
  members: { legal: string; owner: string; pm: string },
) {
  for (const contract of CONTRACTS) {
    const owner =
      contract.owner === "owner" ? members.owner : contract.owner === "pm" ? members.pm : members.legal;

    await prisma.contract.upsert({
      where: { id: contract.id },
      update: {},
      create: {
        id: contract.id,
        companyId: COMPANY_A,
        contractNumber: contract.number,
        title: contract.title,
        contractType: contract.type,
        clientId: contract.client ?? null,
        projectId: contract.project ?? null,
        opportunityId: contract.opportunity ?? null,
        proposalId: contract.proposal ?? null,
        ownerMemberId: owner,
        status: contract.status,
        preArchiveStatus: contract.preArchive ?? null,
        counterpartyName: contract.counterparty ?? null,
        currency: contract.value === undefined ? null : (contract.currency ?? EUR),
        contractValue:
          contract.value === undefined ? null : new Prisma.Decimal(contract.value.toFixed(2)),
        sentAt: contract.sent === undefined ? null : daysFromNow(contract.sent),
        signedDate: contract.signed === undefined ? null : daysFromNow(contract.signed),
        effectiveDate: contract.effective === undefined ? null : daysFromNow(contract.effective),
        expiryDate: contract.expiry === undefined ? null : daysFromNow(contract.expiry),
        renewalType: contract.renewal ?? "NONE",
        renewalNoticeDays: contract.noticeDays ?? null,
        autoRenewalPeriodMonths: contract.renewMonths ?? null,
        governingLaw: contract.governingLaw ?? null,
        jurisdiction: contract.jurisdiction ?? null,
        summary: contract.summary ?? null,
        commercialNotes: contract.commercialNotes ?? null,
        legalNotes: contract.legalNotes ?? null,
        terminationDate:
          contract.terminationDays === undefined ? null : daysFromNow(contract.terminationDays),
        terminationReason: contract.terminationReason ?? null,
        terminatedByMemberId: contract.terminationReason ? members.legal : null,
        createdByMemberId: members.legal,
        archivedAt: contract.status === "ARCHIVED" ? daysFromNow(-150) : null,
        archivedByMemberId: contract.status === "ARCHIVED" ? members.legal : null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Parties (PRD #18 §406)                                                      */
/* -------------------------------------------------------------------------- */

type PartyFixture = {
  contract: string;
  role: "OUR_COMPANY" | "CLIENT" | "COUNTERPARTY" | "GUARANTOR" | "SUBCONTRACTOR" | "OTHER";
  type: "COMPANY" | "INDIVIDUAL" | "PUBLIC_ENTITY" | "OTHER";
  name: string;
  legalName?: string;
  registration?: string;
  taxId?: string;
  client?: string;
  city?: string;
  country?: string;
  signatory?: string;
  signatoryTitle?: string;
  primary?: boolean;
};

const OUR_COMPANY: Omit<PartyFixture, "contract"> = {
  role: "OUR_COMPANY",
  type: "COMPANY",
  name: "NESTO Demo Construction",
  legalName: "NESTO Demo Construction sh.p.k.",
  registration: "L41234567P",
  taxId: "AL41234567P",
  city: "Tiranë",
  country: "Albania",
  signatory: "Arben Malaj",
  signatoryTitle: "Managing Director",
};

const PARTIES: PartyFixture[] = [
  { contract: "contract_001", ...OUR_COMPANY },
  { contract: "contract_001", role: "CLIENT", type: "COMPANY", name: "ACME Developments", legalName: "ACME Developments sh.p.k.", registration: "L61111111A", taxId: "AL61111111A", client: "client_acme", city: "Tiranë", country: "Albania", signatory: "Ana Beqiri", signatoryTitle: "Development Director", primary: true },
  { contract: "contract_001", role: "GUARANTOR", type: "COMPANY", name: "ACME Holdings BV", legalName: "ACME Holdings B.V.", city: "Amsterdam", country: "Netherlands", signatory: "Joost van Dijk", signatoryTitle: "Group Treasurer" },

  { contract: "contract_002", ...OUR_COMPANY },
  { contract: "contract_002", role: "CLIENT", type: "COMPANY", name: "Beta Properties", legalName: "Beta Properties SHPK", client: "client_beta", city: "Durrës", country: "Albania", signatory: "Erion Kola", signatoryTitle: "Managing Partner", primary: true },

  { contract: "contract_003", ...OUR_COMPANY },
  { contract: "contract_003", role: "CLIENT", type: "COMPANY", name: "Meridian Group", client: "client_meridian", city: "Vlorë", country: "Albania", signatory: "Sara Vokshi", signatoryTitle: "Head of Property", primary: true },

  { contract: "contract_004", ...OUR_COMPANY },
  { contract: "contract_004", role: "CLIENT", type: "COMPANY", name: "Atlas Holdings", client: "client_atlas", city: "Tiranë", country: "Albania", signatory: "Mira Duka", signatoryTitle: "Operations Director", primary: true },

  { contract: "contract_005", ...OUR_COMPANY },
  { contract: "contract_005", role: "CLIENT", type: "COMPANY", name: "Urban Core", legalName: "Urban Core sh.a.", registration: "L72222222B", client: "client_urban", city: "Tiranë", country: "Albania", signatory: "Ardit Meta", signatoryTitle: "Chief Executive", primary: true },

  { contract: "contract_006", ...OUR_COMPANY },
  { contract: "contract_006", role: "CLIENT", type: "COMPANY", name: "Beta Properties", legalName: "Beta Properties SHPK", client: "client_beta", city: "Durrës", country: "Albania", signatory: "Lira Meta", signatoryTitle: "Project Lead", primary: true },

  { contract: "contract_007", ...OUR_COMPANY },
  { contract: "contract_007", role: "COUNTERPARTY", type: "COMPANY", name: "Nova Living", client: "client_nova", city: "Shkodër", country: "Albania", signatory: "Klodian Zeka", signatoryTitle: "Founder", primary: true },

  { contract: "contract_008", ...OUR_COMPANY },
  { contract: "contract_008", role: "COUNTERPARTY", type: "COMPANY", name: "Kavaja Property Partners", legalName: "Kavaja Property Partners sh.p.k.", city: "Tiranë", country: "Albania", signatory: "Petrit Hasa", signatoryTitle: "Partner", primary: true },

  { contract: "contract_009", ...OUR_COMPANY },
  { contract: "contract_009", role: "SUBCONTRACTOR", type: "COMPANY", name: "Vitrum Façades", legalName: "Vitrum Façades sh.p.k.", registration: "L83333333C", taxId: "AL83333333C", city: "Durrës", country: "Albania", signatory: "Gentian Rrapi", signatoryTitle: "Commercial Director", primary: true },
  { contract: "contract_009", role: "GUARANTOR", type: "COMPANY", name: "Vitrum Group SpA", city: "Milano", country: "Italy", signatory: "Chiara Rossi", signatoryTitle: "Group CFO" },

  { contract: "contract_010", ...OUR_COMPANY },
  { contract: "contract_010", role: "CLIENT", type: "COMPANY", name: "Greenline Residences", client: "client_greenline", city: "Elbasan", country: "Albania", primary: true },

  { contract: "contract_011", ...OUR_COMPANY },
  { contract: "contract_011", role: "CLIENT", type: "COMPANY", name: "Horizon Estates", client: "client_horizon", city: "Sarandë", country: "Albania", signatory: "Blerta Cami", signatoryTitle: "Director", primary: true },

  { contract: "contract_012", ...OUR_COMPANY },
  { contract: "contract_012", role: "CLIENT", type: "PUBLIC_ENTITY", name: "Central Municipality", client: "client_municipality", city: "Tiranë", country: "Albania", signatory: "Sokol Prenga", signatoryTitle: "Head of Procurement", primary: true },

  { contract: "contract_015", ...OUR_COMPANY },
  { contract: "contract_015", role: "CLIENT", type: "COMPANY", name: "Atlas Holdings Inc.", legalName: "Atlas Holdings, Inc.", client: "client_atlas", city: "Wilmington", country: "United States", signatory: "Dana Reeves", signatoryTitle: "VP Real Estate", primary: true },

  { contract: "contract_016", ...OUR_COMPANY },
  { contract: "contract_016", role: "SUBCONTRACTOR", type: "COMPANY", name: "Terra Works", legalName: "Terra Works sh.p.k.", city: "Elbasan", country: "Albania", signatory: "Fatjon Gega", signatoryTitle: "Owner", primary: true },

  { contract: "contract_018", ...OUR_COMPANY },
  { contract: "contract_018", role: "COUNTERPARTY", type: "COMPANY", name: "Signum Graphics", city: "Tiranë", country: "Albania", primary: true },
];

async function seedParties(prisma: PrismaClient) {
  let index = 0;
  for (const party of PARTIES) {
    index += 1;
    const id = `contract_party_${index.toString().padStart(3, "0")}`;

    await prisma.contractParty.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        contractId: party.contract,
        partyRole: party.role,
        partyType: party.type,
        name: party.name,
        legalName: party.legalName ?? null,
        registrationNumber: party.registration ?? null,
        taxId: party.taxId ?? null,
        clientId: party.client ?? null,
        city: party.city ?? null,
        country: party.country ?? null,
        signatoryName: party.signatory ?? null,
        signatoryTitle: party.signatoryTitle ?? null,
        isPrimaryCounterparty: party.primary ?? false,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Obligations (PRD #18 §414)                                                  */
/* -------------------------------------------------------------------------- */

type ObligationFixture = {
  contract: string;
  title: string;
  type: "DELIVERABLE" | "NOTICE" | "PAYMENT" | "DOCUMENT" | "COMPLIANCE" | "RENEWAL" | "OTHER";
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  /** Days from today; negative and OPEN makes it overdue by derivation (§152). */
  due?: number;
  responsible?: "legal" | "pm";
  description?: string;
};

const OBLIGATIONS: ObligationFixture[] = [
  { contract: "contract_001", title: "Contractor's all-risks certificate", type: "DOCUMENT", status: "OPEN", due: -12, responsible: "pm", description: "Annual renewal certificate to be provided by the contractor." },
  { contract: "contract_001", title: "Performance bond — 10% of contract sum", type: "COMPLIANCE", status: "COMPLETED", due: -200, responsible: "legal" },
  { contract: "contract_001", title: "Monthly progress report to the employer", type: "DELIVERABLE", status: "OPEN", due: 6, responsible: "pm" },
  { contract: "contract_001", title: "Retention moiety 1 release", type: "PAYMENT", status: "OPEN", due: 120, responsible: "legal" },
  { contract: "contract_002", title: "Stage 4 design freeze sign-off", type: "DELIVERABLE", status: "OPEN", due: 3, responsible: "pm" },
  { contract: "contract_002", title: "Renewal notice to the client", type: "RENEWAL", status: "OPEN", due: 15, responsible: "legal", description: "Thirty days' notice required before the expiry date." },
  { contract: "contract_002", title: "Professional indemnity evidence", type: "DOCUMENT", status: "COMPLETED", due: -60, responsible: "legal" },
  { contract: "contract_003", title: "Concept report issue", type: "DELIVERABLE", status: "COMPLETED", due: -30, responsible: "pm" },
  { contract: "contract_003", title: "Extension option notice", type: "NOTICE", status: "OPEN", due: -2, responsible: "legal", description: "The client's option to extend lapses if not answered." },
  { contract: "contract_004", title: "Framework rate review", type: "RENEWAL", status: "OPEN", due: 30, responsible: "legal" },
  { contract: "contract_004", title: "Quarterly call-off summary", type: "DELIVERABLE", status: "OPEN", due: 20, responsible: "pm" },
  { contract: "contract_005", title: "Public realm method statement", type: "DOCUMENT", status: "COMPLETED", due: -25, responsible: "pm" },
  { contract: "contract_005", title: "Provisional sum instruction", type: "NOTICE", status: "OPEN", due: 40, responsible: "legal" },
  { contract: "contract_005", title: "Superseded handover date", type: "DELIVERABLE", status: "CANCELLED", due: -5, responsible: "pm", description: "Replaced by the programme in amendment AMD-001." },
  { contract: "contract_006", title: "GMP submission for stage 2", type: "DELIVERABLE", status: "OPEN", due: 25, responsible: "pm" },
  { contract: "contract_006", title: "Fire strategy sign-off", type: "COMPLIANCE", status: "OPEN", due: -6, responsible: "pm" },
  { contract: "contract_008", title: "Lease renewal notice", type: "RENEWAL", status: "OPEN", due: 0, responsible: "legal", description: "Ninety days' notice is required; today is the last day to serve it." },
  { contract: "contract_008", title: "Service charge reconciliation", type: "PAYMENT", status: "OPEN", due: 60, responsible: "legal" },
  { contract: "contract_009", title: "Advance payment bond", type: "COMPLIANCE", status: "COMPLETED", due: -140, responsible: "legal" },
  { contract: "contract_009", title: "Façade sample panel approval", type: "DELIVERABLE", status: "OPEN", due: 12, responsible: "pm" },
  { contract: "contract_009", title: "Design warranty from the specialist", type: "DOCUMENT", status: "OPEN", due: -45, responsible: "legal" },
  { contract: "contract_016", title: "Site possession certificate", type: "DOCUMENT", status: "OPEN", due: 2, responsible: "pm" },
  { contract: "contract_017", title: "Final retention release", type: "PAYMENT", status: "COMPLETED", due: -35, responsible: "legal" },
  { contract: "contract_018", title: "Recovery of the advance payment", type: "PAYMENT", status: "CANCELLED", due: -15, responsible: "legal", description: "Written off following the supplier's insolvency." },
];

async function seedObligations(prisma: PrismaClient, members: { legal: string; pm: string }) {
  let index = 0;
  for (const obligation of OBLIGATIONS) {
    index += 1;
    const id = `contract_obligation_${index.toString().padStart(3, "0")}`;

    await prisma.contractObligation.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        contractId: obligation.contract,
        title: obligation.title,
        description: obligation.description ?? null,
        obligationType: obligation.type,
        responsibleMemberId:
          obligation.responsible === "pm" ? members.pm : obligation.responsible ? members.legal : null,
        dueDate: obligation.due === undefined ? null : daysFromNow(obligation.due),
        status: obligation.status,
        completedAt:
          obligation.status === "COMPLETED" ? daysFromNow((obligation.due ?? 0) - 1) : null,
        // The one amendment-sourced obligation, so `sourceAmendmentId` is
        // exercised rather than always null (PRD #18 §337).
        sourceAmendmentId:
          obligation.title === "Provisional sum instruction" ? "contract_amendment_001" : null,
        createdByMemberId: members.legal,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Amendments (PRD #18 §415)                                                   */
/* -------------------------------------------------------------------------- */

type AmendmentFixture = {
  id: string;
  contract: string;
  number: string;
  title: string;
  summary: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SENT" | "SIGNED" | "ACTIVE" | "CANCELLED";
  effective?: number;
  signed?: number;
  newValue?: number;
  previousValue?: number;
  newExpiry?: number;
  previousExpiry?: number;
  activated?: number;
};

const AMENDMENTS: AmendmentFixture[] = [
  // Executed: raised the value of the Urban Core plaza contract (§433).
  {
    id: "contract_amendment_001", contract: "contract_005", number: "AMD-001",
    title: "Additional public realm scope",
    summary: "Adds the water feature and the eastern steps, previously carried as a provisional sum.",
    status: "ACTIVE", effective: -15, signed: -18, activated: -15,
    newValue: 862_000, previousValue: 780_000,
  },
  // Executed: extended an expiry date (§434).
  {
    id: "contract_amendment_002", contract: "contract_004", number: "AMD-001",
    title: "Framework term extension",
    summary: "Extends the survey framework by a further twelve months on the existing rates.",
    status: "ACTIVE", effective: -60, signed: -62, activated: -60,
    newExpiry: 90, previousExpiry: -275,
  },
  {
    id: "contract_amendment_003", contract: "contract_001", number: "AMD-001",
    title: "Block C substructure variation",
    summary: "Revised piling design following the ground investigation, with an agreed cost uplift.",
    status: "SIGNED", effective: 5, signed: -2, newValue: 8_640_000,
  },
  {
    id: "contract_amendment_004", contract: "contract_009", number: "AMD-001",
    title: "Façade programme realignment",
    summary: "Moves the installation window by six weeks and extends the subcontract period accordingly.",
    status: "APPROVED", effective: 10, newExpiry: 240,
  },
  {
    id: "contract_amendment_005", contract: "contract_002", number: "AMD-001",
    title: "Stage 6 fee adjustment",
    summary: "Adds the additional inspection visits requested by the client during construction.",
    status: "PENDING_APPROVAL", effective: 14, newValue: 668_000,
  },
  {
    id: "contract_amendment_006", contract: "contract_006", number: "AMD-001",
    title: "Floors 10 and 11 added",
    summary: "Extends the fit-out to two further floors at the agreed stage-two rates.",
    status: "DRAFT", effective: 30, newValue: 1_395_000,
  },
  {
    id: "contract_amendment_007", contract: "contract_003", number: "AMD-001",
    title: "Withdrawn scope change",
    summary: "Proposed extension into detailed design, withdrawn before it was submitted.",
    status: "CANCELLED", effective: 20, newValue: 240_000,
  },
  {
    id: "contract_amendment_008", contract: "contract_008", number: "AMD-001",
    title: "Parking allocation reduced",
    summary: "Reduces the allocation from eight spaces to five, with a corresponding rent reduction.",
    status: "SENT", effective: 40, newValue: 90_000,
  },
];

async function seedAmendments(prisma: PrismaClient, legal: string) {
  for (const amendment of AMENDMENTS) {
    const newValue =
      amendment.newValue === undefined ? null : new Prisma.Decimal(amendment.newValue.toFixed(2));
    const previousValue =
      amendment.previousValue === undefined
        ? null
        : new Prisma.Decimal(amendment.previousValue.toFixed(2));

    await prisma.contractAmendment.upsert({
      where: { id: amendment.id },
      update: {},
      create: {
        id: amendment.id,
        companyId: COMPANY_A,
        contractId: amendment.contract,
        amendmentNumber: amendment.number,
        title: amendment.title,
        summary: amendment.summary,
        status: amendment.status,
        effectiveDate: amendment.effective === undefined ? null : daysFromNow(amendment.effective),
        signedDate: amendment.signed === undefined ? null : daysFromNow(amendment.signed),
        newContractValue: newValue,
        previousContractValue: previousValue,
        // Derived exactly as the service derives it: new minus old (§332).
        valueDelta: newValue === null ? null : newValue.minus(previousValue ?? 0),
        newExpiryDate: amendment.newExpiry === undefined ? null : daysFromNow(amendment.newExpiry),
        previousExpiryDate:
          amendment.previousExpiry === undefined ? null : daysFromNow(amendment.previousExpiry),
        activatedAt: amendment.activated === undefined ? null : daysFromNow(amendment.activated),
        createdByMemberId: legal,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Approvals (PRD #18 §416)                                                    */
/* -------------------------------------------------------------------------- */

type ApprovalFixture = {
  id: string;
  type: "CONTRACT" | "AMENDMENT";
  record: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedDaysAgo: number;
  decidedDaysAgo?: number;
  decidedBy?: "owner" | "ceo";
  note?: string;
};

const APPROVALS: ApprovalFixture[] = [
  { id: "contract_approval_001", type: "CONTRACT", record: "contract_012", status: "PENDING", submittedDaysAgo: 3 },
  { id: "contract_approval_002", type: "CONTRACT", record: "contract_013", status: "PENDING", submittedDaysAgo: 1 },
  { id: "contract_approval_003", type: "CONTRACT", record: "contract_014", status: "APPROVED", submittedDaysAgo: 12, decidedDaysAgo: 9, decidedBy: "ceo", note: "Approved. Set the pre-construction fee off against the main contract." },
  { id: "contract_approval_004", type: "CONTRACT", record: "contract_005", status: "APPROVED", submittedDaysAgo: 70, decidedDaysAgo: 66, decidedBy: "owner" },
  { id: "contract_approval_005", type: "CONTRACT", record: "contract_015", status: "APPROVED", submittedDaysAgo: 18, decidedDaysAgo: 14, decidedBy: "ceo" },
  { id: "contract_approval_006", type: "CONTRACT", record: "contract_011", status: "REJECTED", submittedDaysAgo: 20, decidedDaysAgo: 17, decidedBy: "ceo", note: "Liability position is unacceptable. Cap it at twice the fee before resubmitting." },
  { id: "contract_approval_007", type: "AMENDMENT", record: "contract_amendment_005", status: "PENDING", submittedDaysAgo: 2 },
  { id: "contract_approval_008", type: "AMENDMENT", record: "contract_amendment_004", status: "APPROVED", submittedDaysAgo: 8, decidedDaysAgo: 5, decidedBy: "owner" },
  { id: "contract_approval_009", type: "AMENDMENT", record: "contract_amendment_001", status: "APPROVED", submittedDaysAgo: 26, decidedDaysAgo: 22, decidedBy: "ceo" },
  { id: "contract_approval_010", type: "AMENDMENT", record: "contract_amendment_002", status: "APPROVED", submittedDaysAgo: 72, decidedDaysAgo: 68, decidedBy: "owner" },
];

async function seedApprovals(
  prisma: PrismaClient,
  members: { legal: string; owner: string; ceo: string },
) {
  for (const approval of APPROVALS) {
    await prisma.contractApproval.upsert({
      where: { id: approval.id },
      update: {},
      create: {
        id: approval.id,
        companyId: COMPANY_A,
        recordType: approval.type,
        recordId: approval.record,
        status: approval.status,
        // Always submitted by Legal, decided by somebody else: the separation of
        // duties the module enforces is visible in the demo data (§116).
        submittedByMemberId: members.legal,
        submittedAt: daysFromNow(-approval.submittedDaysAgo),
        decidedByMemberId:
          approval.decidedBy === "owner"
            ? members.owner
            : approval.decidedBy === "ceo"
              ? members.ceo
              : null,
        decidedAt:
          approval.decidedDaysAgo === undefined ? null : daysFromNow(-approval.decidedDaysAgo),
        decisionNote: approval.note ?? null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Tasks and documents (PRD #18 §205, §417)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Canonical Tasks, parented to legal records (PRD #18 §154, §205).
 *
 * Legal has no task table of its own: these are `Task` rows carrying
 * `module = "contracts"`, so the same task appears in /tasks, in
 * /contracts/tasks and on the record it belongs to — one id, three views.
 */
const CONTRACT_TASKS = [
  { title: "Chase ACME for the insurance certificate", entityType: "obligation", entityId: "contract_obligation_001", status: "IN_PROGRESS", due: -4 },
  { title: "Serve the Beta renewal notice", entityType: "obligation", entityId: "contract_obligation_006", status: "TODO", due: 10 },
  { title: "Answer the Meridian extension option", entityType: "obligation", entityId: "contract_obligation_009", status: "TODO", due: -2 },
  { title: "Collect the Vitrum design warranty", entityType: "obligation", entityId: "contract_obligation_021", status: "TODO", due: -40 },
  { title: "Review the Horizon liability cap", entityType: "contract", entityId: "contract_011", status: "IN_PROGRESS", due: 3 },
  { title: "Prepare the municipality framework pack", entityType: "contract", entityId: "contract_012", status: "TODO", due: 6 },
  { title: "File the executed Urban Core amendment", entityType: "contract", entityId: "contract_005", status: "COMPLETED", due: -14 },
  { title: "Serve the head office lease renewal", entityType: "obligation", entityId: "contract_obligation_017", status: "TODO", due: 0 },
];

async function seedContractTasks(prisma: PrismaClient, legal: string) {
  let index = 0;
  for (const task of CONTRACT_TASKS) {
    index += 1;
    const id = `task_contract_${index.toString().padStart(3, "0")}`;

    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        projectId: null,
        title: task.title,
        assigneeMemberId: legal,
        createdByMemberId: legal,
        status: task.status as "TODO" | "IN_PROGRESS" | "COMPLETED",
        priority: "MEDIUM",
        dueDate: daysFromNow(task.due),
        completedAt: task.status === "COMPLETED" ? daysFromNow(task.due - 1) : null,
        module: "contracts",
        entityType: task.entityType,
        entityId: task.entityId,
        createdBy: "user_legal",
      },
    });
  }
}

/**
 * Canonical Documents on legal records (PRD #18 §196–§199, §417).
 *
 * `module = "contracts"` with an `entityType` the Documents parent-access
 * registry knows about, so reaching one of these files requires reaching the
 * record it hangs off — a generic `document.view` gets nothing (PRD #18 §437).
 */
const CONTRACT_DOCUMENTS = [
  { name: "Signed Contract — Riverside phase 2.pdf", entityType: "contract", entityId: "contract_001" },
  { name: "Draft Contract — Riverside phase 2 (rev C).pdf", entityType: "contract", entityId: "contract_001" },
  { name: "Signed Contract — Beta design appointment.pdf", entityType: "contract", entityId: "contract_002" },
  { name: "Signed Contract — Urban Core plaza.pdf", entityType: "contract", entityId: "contract_005" },
  { name: "Signed Contract — Central Office Tower.pdf", entityType: "contract", entityId: "contract_006" },
  { name: "NDA Signed — Nova Living.pdf", entityType: "contract", entityId: "contract_007" },
  { name: "Head office lease — executed counterpart.pdf", entityType: "contract", entityId: "contract_008" },
  { name: "Façade subcontract — signed.pdf", entityType: "contract", entityId: "contract_009" },
  { name: "Draft — Municipality framework agreement.pdf", entityType: "contract", entityId: "contract_012" },
  { name: "Greenline enabling works — signed.pdf", entityType: "contract", entityId: "contract_016" },
  { name: "Amendment 01 — Urban Core public realm.pdf", entityType: "amendment", entityId: "contract_amendment_001" },
  { name: "Amendment 01 — Atlas framework extension.pdf", entityType: "amendment", entityId: "contract_amendment_002" },
  { name: "Insurance certificate 2025.pdf", entityType: "obligation", entityId: "contract_obligation_002" },
];

async function seedContractDocuments(prisma: PrismaClient) {
  const uploader = await prisma.companyMember.findFirst({
    where: { companyId: COMPANY_A, user: { email: "legal@nesto.test" } },
    select: { id: true },
  });

  let index = 0;
  for (const document of CONTRACT_DOCUMENTS) {
    index += 1;
    await seedStoredDocument(prisma, {
      id: `document_contract_${index.toString().padStart(2, "0")}`,
      companyId: COMPANY_A,
      name: document.name,
      module: "contracts",
      entityType: document.entityType,
      entityId: document.entityId,
      uploadedByMemberId: uploader?.id ?? null,
      createdBy: "user_legal",
    });
  }
}
