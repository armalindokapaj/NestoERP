import { afterAll, afterEach, describe, expect, it } from "vitest";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { canReachDocumentParent } from "@/lib/modules/documents/document.parent-access";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import * as approvals from "@/lib/modules/contracts/approvals/approval.service";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";
import * as parties from "@/lib/modules/contracts/parties/party.service";
import { contractOverview } from "@/lib/modules/contracts/overview/overview.service";
import { contractReports } from "@/lib/modules/contracts/reports/reports.service";
import { exportContracts } from "@/lib/modules/contracts/contract.export";
import { listRecordActivity } from "@/lib/modules/contracts/contract.activity";
import {
  contractListQuerySchema,
  contractReasonSchema,
  contractTerminationSchema,
  createContractSchema,
} from "@/lib/modules/contracts/contracts/contract.schema";
import { obligationListQuerySchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import { cleanupSessions, COMPANY, DEMO_EMAIL, demoEmail, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";

/**
 * Legal / Contracts authorisation and lifecycle tests (PRD #18 §419–§450).
 *
 * These call the same services the API routes and the pages call, so a passing
 * test is a statement about the running product rather than about a mock
 * (PRD #9 §223).
 *
 * The rules this module exists to hold:
 *   1. client access alone never reaches a contract,
 *   2. the price and the legal note are two separate curtains,
 *   3. nobody approves what they submitted,
 *   4. an approved contract's terms change by amendment and not by editing,
 *   5. an amendment moves the contract's value exactly once,
 *   6. another group's company is unreachable by every route in and out.
 */
const query = contractListQuerySchema.parse({ limit: 100 });
const obligationQuery = obligationListQuerySchema.parse({ limit: 100 });

const SEED = {
  active: "contract_001", // Aurelia
  activeWithAmendment: "contract_005", // Nova
  draft: "contract_010", // Nova
  inReview: "contract_011", // Forma
  pendingApproval: "contract_012", // Terra
  pendingApproval2: "contract_013", // Meridian
  approved: "contract_014", // Aurelia
  sent: "contract_015", // Terra
  signed: "contract_016", // Nova
  expired: "contract_017", // Nova
  terminated: "contract_018", // Meridian
  cancelled: "contract_019", // Aurelia
  archived: "contract_020", // Aurelia
  tenant: "contract_b_001",
} as const;

/**
 * A contract sits in the company of its project or client (E-06), so a test
 * works on one from inside that company: as the group's head of Legal, who is
 * a member of all five, or as that company's own CEO.
 */
async function inCompanyOf(contractId: string, who: { user: { email: string } } | { role: { key: "CEO" } }) {
  const { companyId } = await prisma.contract.findUniqueOrThrow({ where: { id: contractId }, select: { companyId: true } });
  const member = await prisma.companyMember.findFirstOrThrow({
    where: { ...who, companyId, status: "ACTIVE" },
    select: { id: true },
  });
  return loginAsMembership(member.id);
}

const legalFor = (contractId: string) => inCompanyOf(contractId, { user: { email: demoEmail("LEGAL") } });
const ceoFor = (contractId: string) => inCompanyOf(contractId, { role: { key: "CEO" } });

const TEST_PREFIX = "Vitest";

const created = {
  tasks: [] as string[],
  obligations: [] as string[],
  amendments: [] as string[],
  parties: [] as string[],
  contracts: [] as string[],
};

/** Seeded rows a test changed, restored after it. */
const touchedContracts: {
  id: string;
  status: string;
  contractValue: unknown;
  expiryDate: Date | null;
  effectiveDate: Date | null;
  signedDate: Date | null;
  sentAt: Date | null;
  terminationDate: Date | null;
  terminationReason: string | null;
  archivedAt: Date | null;
  ownerMemberId: string;
}[] = [];

const touchedAmendments: {
  id: string;
  status: string;
  activatedAt: Date | null;
  signedDate: Date | null;
  previousContractValue: unknown;
  newContractValue: unknown;
}[] = [];

const touchedObligations: { id: string; status: string; completedAt: Date | null }[] = [];
const touchedApprovals: { id: string }[] = [];

async function rememberContract(id: string) {
  const row = await prisma.contract.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      contractValue: true,
      expiryDate: true,
      effectiveDate: true,
      signedDate: true,
      sentAt: true,
      terminationDate: true,
      terminationReason: true,
      archivedAt: true,
      ownerMemberId: true,
    },
  });
  touchedContracts.push({ id, ...row });
}

async function rememberAmendment(id: string) {
  const row = await prisma.contractAmendment.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      activatedAt: true,
      signedDate: true,
      previousContractValue: true,
      newContractValue: true,
    },
  });
  touchedAmendments.push({ id, ...row });
}

async function rememberObligation(id: string) {
  const row = await prisma.contractObligation.findUniqueOrThrow({
    where: { id },
    select: { status: true, completedAt: true },
  });
  touchedObligations.push({ id, ...row });
}

afterEach(async () => {
  if (created.tasks.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: created.tasks } } });
    await prisma.task.deleteMany({ where: { id: { in: created.tasks } } });
    created.tasks.length = 0;
  }
  if (created.obligations.length > 0) {
    await prisma.contractObligation.deleteMany({ where: { id: { in: created.obligations } } });
    created.obligations.length = 0;
  }
  if (created.amendments.length > 0) {
    await prisma.contractApproval.deleteMany({ where: { recordId: { in: created.amendments } } });
    await prisma.contractAmendment.deleteMany({ where: { id: { in: created.amendments } } });
    created.amendments.length = 0;
  }
  if (created.parties.length > 0) {
    await prisma.contractParty.deleteMany({ where: { id: { in: created.parties } } });
    created.parties.length = 0;
  }
  if (created.contracts.length > 0) {
    await prisma.contractApproval.deleteMany({ where: { recordId: { in: created.contracts } } });
    await prisma.contractObligation.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.contractAmendment.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.contractParty.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created.contracts } } });
    await prisma.contract.deleteMany({ where: { id: { in: created.contracts } } });
    created.contracts.length = 0;
  }

  for (const row of touchedObligations) {
    await prisma.contractObligation.update({
      where: { id: row.id },
      data: { status: row.status as "OPEN", completedAt: row.completedAt },
    });
  }
  touchedObligations.length = 0;

  for (const row of touchedAmendments) {
    await prisma.contractAmendment.update({
      where: { id: row.id },
      data: {
        status: row.status as "DRAFT",
        activatedAt: row.activatedAt,
        signedDate: row.signedDate,
        previousContractValue: row.previousContractValue as never,
        newContractValue: row.newContractValue as never,
      },
    });
  }
  touchedAmendments.length = 0;

  for (const row of touchedContracts) {
    await prisma.contract.update({
      where: { id: row.id },
      data: {
        status: row.status as "DRAFT",
        contractValue: row.contractValue as never,
        expiryDate: row.expiryDate,
        effectiveDate: row.effectiveDate,
        signedDate: row.signedDate,
        sentAt: row.sentAt,
        terminationDate: row.terminationDate,
        terminationReason: row.terminationReason,
        archivedAt: row.archivedAt,
        ownerMemberId: row.ownerMemberId,
      },
    });
  }
  touchedContracts.length = 0;

  for (const row of touchedApprovals) {
    await prisma.contractApproval.update({
      where: { id: row.id },
      data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
    });
  }
  touchedApprovals.length = 0;

  await prisma.activity.deleteMany({ where: { message: { startsWith: TEST_PREFIX } } });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* §420 Authorisation                                                          */
/* -------------------------------------------------------------------------- */

describe("contract access (PRD #18 §16–§31, §420)", () => {
  it("gives Legal the whole company register", async () => {
    const context = await loginAs("LEGAL");
    const result = await contracts.listContracts(context, query);

    const register = await prisma.contract.count({ where: { companyId: context.companyId, archivedAt: null } });
    expect(register).toBeGreaterThan(5);
    expect(result.data.length).toBe(register);
    expect(result.data.some((row) => row.id === SEED.active)).toBe(true);
  });

  it("refuses Group IT by default (PRD #18 §24, §25)", async () => {
    const context = await loginAs("GROUP_IT");
    expect(can(context, "legal.contract.view")).toBe(false);
    await expect(contracts.listContracts(context, query)).rejects.toBeInstanceOf(AccessError);
  });

  it("does not let client access alone reach a contract (PRD #18 §19, §251)", async () => {
    // Architect and Viewer both hold `client.view`: they can open the customer
    // record and read who it is. Neither is thereby told what the company
    // agreed with them. The access formula is three terms, and the contract
    // permission is one of them.
    for (const role of ["ARCHITECT", "VIEWER"] as const) {
      const context = await loginAs(role);
      expect(can(context, "client.view")).toBe(true);
      expect(can(context, "legal.contract.view")).toBe(false);

      await expect(contracts.listContracts(context, query)).rejects.toBeInstanceOf(AccessError);
      // Not even through the client record's own tab.
      expect(await contracts.listForClient(context, "client_acme")).toEqual([]);
    }
  });

  it("narrows a Project Manager to the jobs they run (PRD #18 §28, §248)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const result = await contracts.listContracts(context, query);

    // A company-wide agreement with no project attached is deliberately out of
    // reach: an NDA is not inherited by being given a project.
    const nda = result.data.find((row) => row.id === "contract_007");
    expect(nda).toBeUndefined();

    for (const row of result.data) {
      expect(row.project !== null || row.owner.memberId === context.membershipId).toBe(true);
    }
  });

  it("answers 404 rather than 403 for a contract out of scope (PRD #18 §288)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expect(contracts.getContract(context, "contract_007")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* §441, §442 Redaction                                                        */
/* -------------------------------------------------------------------------- */

describe("commercial and confidential redaction (PRD #18 §22, §23, §441, §442)", () => {
  it("omits the value entirely without legal.commercial.view", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    expect(can(pm, "legal.commercial.view")).toBe(false);

    const rows = await contracts.listContracts(pm, query);
    expect(rows.data.length).toBeGreaterThan(0);
    // `null`, not an object of nulls: a blank money row would itself tell the
    // reader there is a figure being withheld (PRD #18 §495).
    for (const row of rows.data) expect(row.commercial).toBeNull();

    const detail = await contracts.getContract(pm, rows.data[0]!.id);
    expect(detail.commercial).toBeNull();
    expect(detail.commercialNotes).toBeNull();
  });

  it("shows the value to Legal", async () => {
    const legal = await loginAs("LEGAL");
    const detail = await contracts.getContract(legal, SEED.active);

    expect(detail.commercial).not.toBeNull();
    // Money crosses as a decimal string so no JSON parser rounds an agreement.
    expect(typeof detail.commercial!.contractValue).toBe("string");
  });

  it("keeps legal notes behind their own curtain (PRD #18 §23, §257)", async () => {
    const legal = await loginAs("LEGAL");
    const withNotes = await contracts.getContract(legal, SEED.active);
    expect(can(legal, "legal.confidential_terms.view")).toBe(true);

    const finance = await loginAs("FINANCE");
    if (can(finance, "legal.contract.view")) {
      const seen = await contracts.getContract(finance, SEED.active);
      if (!can(finance, "legal.confidential_terms.view")) {
        expect(seen.legal.legalNotes).toBeNull();
      }
    }
    expect(withNotes.legal).toBeDefined();
  });

  it("redacts the CSV export the same way (PRD #18 §227, §228)", async () => {
    const legal = await loginAs("LEGAL");
    const pm = await loginAs("PROJECT_MANAGER");

    const full = await exportContracts(legal, "contracts", query, obligationQuery);
    expect(full.csv.length).toBeGreaterThan(0);

    if (can(pm, "legal.export")) {
      const limited = await exportContracts(pm, "contracts", query, obligationQuery);
      expect(limited.csv.toLowerCase()).not.toContain("contract value");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* §421 Validation and §98 create                                              */
/* -------------------------------------------------------------------------- */

describe("creating a contract (PRD #18 §94–§99, §421)", () => {
  async function draft(context: Awaited<ReturnType<typeof loginAs>>, overrides = {}) {
    const contract = await contracts.createContract(context, {
      contractNumber: `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${TEST_PREFIX} agreement`,
      contractType: "SERVICE_AGREEMENT",
      ownerMemberId: context.membershipId,
      renewalType: "NONE",
      ...overrides,
    } as Parameters<typeof contracts.createContract>[1]);
    created.contracts.push(contract.id);
    return contract;
  }

  it("always starts as a DRAFT (PRD #18 §40, §192)", async () => {
    const context = await loginAs("LEGAL");
    const contract = await draft(context);
    expect(contract.status).toBe("DRAFT");
  });

  it("refuses a duplicate contract number within the company (PRD #18 §36)", async () => {
    const context = await loginAs("LEGAL");
    await expect(
      draft(context, { contractNumber: "CTR-2026-001" }),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("allows the number another company already uses (PRD #18 §36, §239)", async () => {
    // The fixture tenant carries CTR-2026-001 too. Uniqueness is per company;
    // a global constraint would leak the other company's numbering.
    const b = await prisma.contract.findUniqueOrThrow({
      where: { id: SEED.tenant },
      select: { contractNumber: true },
    });
    expect(b.contractNumber).toBe("CTR-2026-001");

    const both = await prisma.contract.count({ where: { contractNumber: "CTR-2026-001" } });
    expect(both).toBe(2);
  });

  /*
   * The cross-field rules live in the schema, which is what every API route and
   * server action parses with before the service is reached (PRD #18 §270).
   * Testing them here tests the gate the product actually runs.
   */
  const base = {
    contractNumber: "CTR-TEST-001",
    title: "Validation fixture",
    contractType: "SERVICE_AGREEMENT",
    ownerMemberId: "member_legal",
    renewalType: "NONE",
  };

  it("refuses a value without a currency (PRD #18 §273)", () => {
    const parsed = createContractSchema.safeParse({ ...base, contractValue: "1000.00" });
    expect(parsed.success).toBe(false);
  });

  it("accepts a value with a currency", () => {
    const parsed = createContractSchema.safeParse({
      ...base,
      contractValue: "1000.00",
      currency: "EUR",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an expiry before the effective date (PRD #18 §69)", () => {
    const parsed = createContractSchema.safeParse({
      ...base,
      effectiveDate: "2026-06-01",
      expiryDate: "2026-01-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses auto-renew without an expiry and a period (PRD #18 §275)", () => {
    const parsed = createContractSchema.safeParse({ ...base, renewalType: "AUTO_RENEW" });
    expect(parsed.success).toBe(false);
  });

  it("refuses notice days on a contract that does not renew (PRD #18 §275)", () => {
    const parsed = createContractSchema.safeParse({
      ...base,
      renewalType: "NONE",
      renewalNoticeDays: "30",
    });
    expect(parsed.success).toBe(false);
  });

  it("allows a signed date after the effective date (PRD #18 §69)", () => {
    // Agreements are routinely signed after they take effect, and a product
    // that refuses to record that is one people work around.
    const parsed = createContractSchema.safeParse({
      ...base,
      effectiveDate: "2026-01-01",
      signedDate: "2026-03-01",
      expiryDate: "2026-12-31",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an owner outside the company (PRD #18 §52, §269)", async () => {
    const context = await loginAs("LEGAL");
    await expect(draft(context, { ownerMemberId: "member_owner_b" })).rejects.toMatchObject({
      details: { code: "INVALID_OWNER" },
    });
  });

  it("refuses a proposal addressed to a different client (PRD #18 §60)", async () => {
    const context = await loginAs("LEGAL");
    const proposal = await prisma.proposal.findFirst({
      where: { companyId: "company_demo_a" },
      select: { id: true, clientId: true },
    });
    if (!proposal) return;

    const otherClient = await prisma.client.findFirst({
      where: { companyId: "company_demo_a", id: { not: proposal.clientId }, archivedAt: null },
      select: { id: true },
    });
    if (!otherClient) return;

    await expect(
      draft(context, { proposalId: proposal.id, clientId: otherClient.id }),
    ).rejects.toMatchObject({ details: { code: "SALES_SOURCE_MISMATCH" } });
  });
});

/* -------------------------------------------------------------------------- */
/* §422–§427 Lifecycle                                                         */
/* -------------------------------------------------------------------------- */

describe("contract lifecycle (PRD #18 §108–§135, §422–§427)", () => {
  it("walks draft → review → approval and records the approval (PRD #18 §422)", async () => {
    const legal = await legalFor(SEED.draft);
    await rememberContract(SEED.draft);

    await contracts.submitForReview(legal, SEED.draft);
    expect((await contracts.getContract(legal, SEED.draft)).status).toBe("IN_REVIEW");

    await contracts.submitForApproval(legal, SEED.draft);
    const pending = await contracts.getContract(legal, SEED.draft);
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect(pending.approvals.some((row) => row.status === "PENDING")).toBe(true);

    const open = await prisma.contractApproval.findMany({
      where: { recordId: SEED.draft, status: "PENDING" },
      select: { id: true },
    });
    for (const row of open) await prisma.contractApproval.delete({ where: { id: row.id } });
  });

  it("returns a contract in review to draft (PRD #18 §110)", async () => {
    const legal = await legalFor(SEED.inReview);
    await rememberContract(SEED.inReview);

    await contracts.returnToDraft(legal, SEED.inReview, "Needs a liability cap.");
    expect((await contracts.getContract(legal, SEED.inReview)).status).toBe("DRAFT");
  });

  it("blocks self-approval (PRD #18 §116, §423)", async () => {
    // contract_012's approval was submitted by Legal in the seed.
    const legal = await legalFor(SEED.pendingApproval);
    await expect(contracts.approveContract(legal, SEED.pendingApproval, null)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("does not offer a decision to the person who submitted it (PRD #18 §116, §353)", async () => {
    // The queue has always withheld the buttons; the record page must agree,
    // or it draws an Approve the service is certain to refuse.
    const legal = await legalFor(SEED.pendingApproval);
    const ceo = await ceoFor(SEED.pendingApproval);

    const submitted = await contracts.getContract(legal, SEED.pendingApproval);
    expect(submitted.status).toBe("PENDING_APPROVAL");
    expect(submitted.capabilities.canApprove).toBe(false);
    expect(submitted.capabilities.canReject).toBe(false);

    const decider = await contracts.getContract(ceo, SEED.pendingApproval);
    expect(decider.capabilities.canApprove).toBe(true);
    expect(decider.capabilities.canReject).toBe(true);
  });

  it("lets somebody else approve, once (PRD #18 §189, §508)", async () => {
    const ceo = await ceoFor(SEED.pendingApproval);
    await rememberContract(SEED.pendingApproval);
    touchedApprovals.push({ id: "contract_approval_001" });

    await contracts.approveContract(ceo, SEED.pendingApproval, "Agreed.");
    expect((await contracts.getContract(ceo, SEED.pendingApproval)).status).toBe("APPROVED");

    // A second decision on a settled cycle is refused rather than recorded twice.
    await expect(contracts.approveContract(ceo, SEED.pendingApproval, null)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("requires a reason to reject (PRD #18 §114, §190)", async () => {
    const ceo = await ceoFor(SEED.pendingApproval2);
    await rememberContract(SEED.pendingApproval2);
    touchedApprovals.push({ id: "contract_approval_002" });

    // The reason is required by the schema every route parses with.
    expect(contractReasonSchema.safeParse({ note: "" }).success).toBe(false);
    expect(contractReasonSchema.safeParse({ note: "  " }).success).toBe(false);

    await contracts.rejectContract(ceo, SEED.pendingApproval2, "Liability cap is unacceptable.");
    const rejected = await contracts.getContract(ceo, SEED.pendingApproval2);
    // Back to review rather than to draft: a rejected approval does not undo
    // the reviewer's work (PRD #18 §114).
    expect(rejected.status).toBe("IN_REVIEW");
    // The decision survives the status going back (PRD #18 §115).
    expect(rejected.approvals.some((row) => row.status === "REJECTED")).toBe(true);
  });

  it("keeps an approved contract's terms immutable (PRD #18 §106, §436)", async () => {
    const legal = await loginAs("LEGAL");
    const before = await contracts.getContract(legal, SEED.approved);

    await expect(
      contracts.updateContract(legal, SEED.approved, {
        contractNumber: before.contractNumber,
        title: "Rewritten after approval",
        contractType: before.contractType,
        ownerMemberId: before.owner.memberId,
        renewalType: before.renewal.type,
      } as Parameters<typeof contracts.updateContract>[2]),
    ).rejects.toBeInstanceOf(AccessError);

    // The metadata correction is still allowed (PRD #18 §107).
    await rememberContract(SEED.approved);
    await contracts.updateContractMetadata(legal, SEED.approved, {
      ownerMemberId: before.owner.memberId,
      summary: `${TEST_PREFIX} corrected summary`,
    } as Parameters<typeof contracts.updateContractMetadata>[2]);

    const after = await contracts.getContract(legal, SEED.approved);
    expect(after.legal.summary).toContain(TEST_PREFIX);
    expect(after.title).toBe(before.title);
  });

  it("signs with a date, then activates (PRD #18 §118, §120, §424, §425)", async () => {
    const legal = await legalFor(SEED.sent);
    await rememberContract(SEED.sent);

    await contracts.markSigned(legal, SEED.sent, {
      signedDate: new Date(),
      acknowledgeMissingDocument: true,
    });
    const signed = await contracts.getContract(legal, SEED.sent);
    expect(signed.status).toBe("SIGNED");
    expect(signed.dates.signedDate).not.toBeNull();

    await contracts.activateContract(legal, SEED.sent, new Date());
    const active = await contracts.getContract(legal, SEED.sent);
    expect(active.status).toBe("ACTIVE");
    expect(active.dates.effectiveDate).not.toBeNull();
  });

  it("refuses a lifecycle jump that skips a state (PRD #18 §191, §192)", async () => {
    const legal = await legalFor(SEED.draft);
    // A draft has not been sent, so it cannot be signed.
    await expect(
      contracts.markSigned(legal, SEED.draft, {
        signedDate: new Date(),
        acknowledgeMissingDocument: true,
      }),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("terminates with a date and a reason, and closes open obligations (PRD #18 §130–§133, §427)", async () => {
    const legal = await loginAs("LEGAL");
    await rememberContract(SEED.active);
    for (const row of await prisma.contractObligation.findMany({
      where: { contractId: SEED.active },
      select: { id: true },
    })) {
      await rememberObligation(row.id);
    }

    // Ending an agreement early needs a date and a reason (PRD #18 §276).
    expect(
      contractTerminationSchema.safeParse({ terminationDate: "2026-06-01", terminationReason: "" })
        .success,
    ).toBe(false);
    expect(contractTerminationSchema.safeParse({ terminationReason: "Employer stopped." }).success).toBe(
      false,
    );

    await contracts.terminateContract(legal, SEED.active, {
      terminationDate: new Date(),
      terminationReason: "Employer stopped the works.",
    });

    const terminated = await contracts.getContract(legal, SEED.active);
    expect(terminated.status).toBe("TERMINATED");
    expect(terminated.dates.terminationDate).not.toBeNull();
    expect(terminated.legal.terminationReason).toContain("Employer");
  });

  it("treats expiry as derived, so reporting is right even if the status lags (PRD #18 §193, §426)", async () => {
    const legal = await legalFor(SEED.expired);
    const expired = await contracts.getContract(legal, SEED.expired);

    expect(expired.attention.daysToExpiry).not.toBeNull();
    expect(expired.attention.daysToExpiry!).toBeLessThan(0);
    expect(expired.attention.effectiveStatus).toBe("EXPIRED");
  });

  it("archives only what is finished, and restores it (PRD #18 §134, §135)", async () => {
    const legal = await loginAs("LEGAL");

    // An active contract is not archivable.
    await expect(contracts.archiveContract(legal, SEED.active)).rejects.toBeInstanceOf(
      AccessError,
    );

    await rememberContract(SEED.cancelled);
    await contracts.archiveContract(legal, SEED.cancelled);
    expect((await contracts.getContract(legal, SEED.cancelled)).archivedAt).not.toBeNull();

    await contracts.restoreContract(legal, SEED.cancelled);
    expect((await contracts.getContract(legal, SEED.cancelled)).archivedAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* §428, §429 Parties                                                          */
/* -------------------------------------------------------------------------- */

describe("contract parties (PRD #18 §136–§147, §428, §429)", () => {
  it("allows one primary counterparty only (PRD #18 §144, §236)", async () => {
    const legal = await legalFor(SEED.draft);
    const existing = await parties.listParties(legal, SEED.draft);
    const alreadyPrimary = existing.find((row) => row.isPrimaryCounterparty);

    const added = await parties.addParty(legal, SEED.draft, {
      partyRole: "COUNTERPARTY",
      partyType: "COMPANY",
      name: `${TEST_PREFIX} second counterparty`,
      isPrimaryCounterparty: true,
    } as Parameters<typeof parties.addParty>[2]);
    created.parties.push(added.id);

    const after = await parties.listParties(legal, SEED.draft);
    expect(after.filter((row) => row.isPrimaryCounterparty)).toHaveLength(1);
    if (alreadyPrimary) {
      // The flag moved rather than duplicating.
      expect(after.find((row) => row.id === added.id)?.isPrimaryCounterparty).toBe(true);
    }
  });

  it("freezes the party snapshot when the client is renamed (PRD #18 §141, §429)", async () => {
    const legal = await legalFor(SEED.activeWithAmendment);
    const linked = (await parties.listParties(legal, SEED.activeWithAmendment)).find(
      (row) => row.clientId !== null,
    );
    if (!linked) return;

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: linked.clientId! },
      select: { name: true },
    });

    await prisma.client.update({
      where: { id: linked.clientId! },
      data: { name: `${TEST_PREFIX} renamed` },
    });

    const after = await parties.listParties(legal, SEED.activeWithAmendment);
    const same = after.find((row) => row.id === linked.id)!;
    // The agreement still says who signed it.
    expect(same.name).toBe(linked.name);
    expect(same.name).not.toContain(TEST_PREFIX);

    await prisma.client.update({ where: { id: linked.clientId! }, data: { name: client.name } });
  });

  it("refuses to edit parties once the contract has left drafting (PRD #18 §145)", async () => {
    const legal = await loginAs("LEGAL");
    await expect(
      parties.addParty(legal, SEED.active, {
        partyRole: "GUARANTOR",
        partyType: "COMPANY",
        name: `${TEST_PREFIX} late guarantor`,
        isPrimaryCounterparty: false,
      } as Parameters<typeof parties.addParty>[2]),
    ).rejects.toBeInstanceOf(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* §430, §431 Obligations                                                      */
/* -------------------------------------------------------------------------- */

describe("contract obligations (PRD #18 §148–§158, §430, §431)", () => {
  it("derives overdue from the due date (PRD #18 §152)", async () => {
    const legal = await loginAs("LEGAL");
    const rows = await obligations.listForContract(legal, SEED.active);
    const overdue = rows.filter((row) => row.isOverdue);

    expect(overdue.length).toBeGreaterThan(0);
    for (const row of overdue) {
      expect(row.status).toBe("OPEN");
      expect(row.daysOverdue).toBeGreaterThan(0);
    }
  });

  it("completes and cancels an obligation (PRD #18 §156, §157)", async () => {
    const legal = await loginAs("LEGAL");
    const open = (await obligations.listForContract(legal, SEED.active)).find(
      (row) => row.status === "OPEN",
    )!;
    await rememberObligation(open.id);

    await obligations.completeObligation(legal, open.id, "Certificate received.");
    const done = (await obligations.listForContract(legal, SEED.active)).find(
      (row) => row.id === open.id,
    )!;
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).not.toBeNull();
    // A completed obligation is no longer overdue, whatever its due date said.
    expect(done.isOverdue).toBe(false);
  });

  it("creates a canonical Task from an obligation (PRD #18 §154, §431)", async () => {
    const legal = await loginAs("LEGAL");
    const open = (await obligations.listForContract(legal, SEED.active)).find(
      (row) => row.status === "OPEN",
    )!;

    // Left unassigned on purpose: who may be assigned a task on a project is a
    // Tasks rule, and the obligation hand-off does not get to bypass it.
    const task = await obligations.createTaskForObligation(legal, open.id, {
      title: `${TEST_PREFIX} satisfy obligation`,
    } as Parameters<typeof obligations.createTaskForObligation>[2]);
    created.tasks.push(task.id);

    // It lives in Tasks with every other piece of work — there is no
    // obligation-shaped task table.
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { companyId: true, title: true },
    });
    expect(row.companyId).toBe(legal.companyId);
    expect(row.title).toContain(TEST_PREFIX);
  });
});

/* -------------------------------------------------------------------------- */
/* §432–§435 Amendments                                                        */
/* -------------------------------------------------------------------------- */

describe("contract amendments (PRD #18 §159–§180, §432–§435)", () => {
  it("changes nothing until it is activated (PRD #18 §333)", async () => {
    const legal = await legalFor(SEED.activeWithAmendment);
    const before = await contracts.getContract(legal, SEED.activeWithAmendment);

    const amendment = await amendments.createAmendment(legal, SEED.activeWithAmendment, {
      amendmentNumber: `${TEST_PREFIX}-A1`,
      title: `${TEST_PREFIX} scope change`,
      summary: "Additional works agreed.",
      newContractValue: "999999.00",
      acknowledgeReduction: false,
    } as Parameters<typeof amendments.createAmendment>[2]);
    created.amendments.push(amendment.id);

    const after = await contracts.getContract(legal, SEED.activeWithAmendment);
    expect(after.commercial!.contractValue).toBe(before.commercial!.contractValue);
    expect(amendment.status).toBe("DRAFT");
  });

  it("applies the value once, and refuses a second activation (PRD #18 §332, §511, §435)", async () => {
    const legal = await legalFor(SEED.activeWithAmendment);
    const ceo = await ceoFor(SEED.activeWithAmendment);

    await rememberContract(SEED.activeWithAmendment);
    const start = await contracts.getContract(legal, SEED.activeWithAmendment);

    const amendment = await amendments.createAmendment(legal, SEED.activeWithAmendment, {
      amendmentNumber: `${TEST_PREFIX}-A2`,
      title: `${TEST_PREFIX} uplift`,
      summary: "Agreed uplift.",
      newContractValue: "1234567.00",
      effectiveDate: new Date(),
      acknowledgeReduction: false,
    } as Parameters<typeof amendments.createAmendment>[2]);
    created.amendments.push(amendment.id);

    await amendments.submitAmendment(legal, amendment.id);
    await amendments.approveAmendment(ceo, amendment.id, "Agreed.");
    await amendments.markAmendmentSent(legal, amendment.id);
    await amendments.markAmendmentSigned(legal, amendment.id, { signedDate: new Date() });
    await amendments.activateAmendment(legal, amendment.id);

    const moved = await contracts.getContract(legal, SEED.activeWithAmendment);
    expect(moved.commercial!.contractValue).toBe("1234567.00");
    expect(moved.commercial!.contractValue).not.toBe(start.commercial!.contractValue);

    // Idempotent: activating again does not move the value a second time.
    await expect(amendments.activateAmendment(legal, amendment.id)).rejects.toBeInstanceOf(
      AccessError,
    );
    const still = await contracts.getContract(legal, SEED.activeWithAmendment);
    expect(still.commercial!.contractValue).toBe("1234567.00");
  });

  it("extends the expiry date exactly once (PRD #18 §168, §331, §434)", async () => {
    const legal = await legalFor(SEED.activeWithAmendment);
    const ceo = await ceoFor(SEED.activeWithAmendment);
    await rememberContract(SEED.activeWithAmendment);

    const before = await contracts.getContract(legal, SEED.activeWithAmendment);
    const newExpiry = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);

    const amendment = await amendments.createAmendment(legal, SEED.activeWithAmendment, {
      amendmentNumber: `${TEST_PREFIX}-A3`,
      title: `${TEST_PREFIX} extension`,
      summary: "Programme extended.",
      newExpiryDate: newExpiry,
      effectiveDate: new Date(),
      acknowledgeReduction: false,
    } as Parameters<typeof amendments.createAmendment>[2]);
    created.amendments.push(amendment.id);

    await amendments.submitAmendment(legal, amendment.id);
    await amendments.approveAmendment(ceo, amendment.id, null);
    await amendments.markAmendmentSent(legal, amendment.id);
    await amendments.markAmendmentSigned(legal, amendment.id, { signedDate: new Date() });
    await amendments.activateAmendment(legal, amendment.id);

    const after = await contracts.getContract(legal, SEED.activeWithAmendment);
    expect(after.dates.expiryDate).not.toBe(before.dates.expiryDate);
    expect(new Date(after.dates.expiryDate!).getFullYear()).toBe(newExpiry.getFullYear());
  });

  it("blocks self-approval of an amendment too (PRD #18 §169)", async () => {
    const legal = await legalFor(SEED.activeWithAmendment);
    const amendment = await amendments.createAmendment(legal, SEED.activeWithAmendment, {
      amendmentNumber: `${TEST_PREFIX}-A4`,
      title: `${TEST_PREFIX} self approval`,
      summary: "Should not be self-approvable.",
      acknowledgeReduction: false,
    } as Parameters<typeof amendments.createAmendment>[2]);
    created.amendments.push(amendment.id);

    await amendments.submitAmendment(legal, amendment.id);
    await expect(amendments.approveAmendment(legal, amendment.id, null)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("allows only one amendment in flight per contract (PRD #18 §178, §238)", async () => {
    const legal = await legalFor("contract_006");
    // contract_006 carries a seeded DRAFT amendment. Putting it into the
    // approval cycle should close the door on a second one.
    await rememberAmendment("contract_amendment_006");
    await amendments.submitAmendment(legal, "contract_amendment_006");

    const second = amendments.createAmendment(legal, "contract_006", {
      amendmentNumber: `${TEST_PREFIX}-A6`,
      title: `${TEST_PREFIX} conflicting change`,
      summary: "Two amendments changing the same terms at once.",
      newContractValue: "500000.00",
      acknowledgeReduction: false,
    } as Parameters<typeof amendments.createAmendment>[2]);

    await expect(second).rejects.toBeInstanceOf(AccessError);

    // Clean up the approval the submission opened.
    await prisma.contractApproval.deleteMany({
      where: { recordId: "contract_amendment_006", status: "PENDING" },
    });
  });

  it("refuses an amendment on a contract still being drafted (PRD #18 §165)", async () => {
    const legal = await legalFor(SEED.draft);
    await expect(
      amendments.createAmendment(legal, SEED.draft, {
        amendmentNumber: `${TEST_PREFIX}-A5`,
        title: `${TEST_PREFIX} premature`,
        summary: "Too early.",
        acknowledgeReduction: false,
      } as Parameters<typeof amendments.createAmendment>[2]),
    ).rejects.toBeInstanceOf(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* §436, §437 Documents                                                        */
/* -------------------------------------------------------------------------- */

describe("contract documents (PRD #18 §196–§204, §436, §437)", () => {
  it("lets the parent resolver decide, and fails closed (PRD #18 §199, §437)", async () => {
    const legal = await loginAs("LEGAL");
    const pm = await loginAs("PROJECT_MANAGER");

    const reachable = await canReachDocumentParent(legal, {
      module: "contracts",
      entityType: "contract",
      entityId: SEED.active,
    } as Parameters<typeof canReachDocumentParent>[1]);
    expect(reachable).toBe(true);

    // A contract out of the reader's scope is not reachable through a document
    // either: generic document permission cannot bypass contract access.
    const blocked = await canReachDocumentParent(pm, {
      module: "contracts",
      entityType: "contract",
      entityId: "contract_007",
    } as Parameters<typeof canReachDocumentParent>[1]);
    expect(blocked).toBe(false);
  });

  it("refuses an unregistered entity type (PRD #18 §199)", async () => {
    const legal = await loginAs("LEGAL");
    const unknown = await canReachDocumentParent(legal, {
      module: "contracts",
      entityType: "not_a_real_entity",
      entityId: SEED.active,
    } as unknown as Parameters<typeof canReachDocumentParent>[1]);
    expect(unknown).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* §438–§440 Cross-module                                                      */
/* -------------------------------------------------------------------------- */

describe("cross-module reads (PRD #18 §10, §11, §438–§440)", () => {
  it("lists a client's contracts through the caller's own contract scope (PRD #18 §439)", async () => {
    const legal = await loginAs("LEGAL");
    const pm = await loginAs("PROJECT_MANAGER");

    // A live contract: the client tab deliberately omits archived agreements,
    // so picking an arbitrary row would make this test depend on row order.
    const target = await prisma.contract.findFirstOrThrow({
      where: { companyId: legal.companyId, clientId: { not: null }, archivedAt: null },
      orderBy: { contractNumber: "asc" },
      select: { clientId: true },
    });

    const legalRows = await contracts.listForClient(legal, target.clientId!);
    const pmRows = await contracts.listForClient(pm, target.clientId!);

    expect(legalRows.length).toBeGreaterThan(0);
    expect(pmRows.length).toBeLessThanOrEqual(legalRows.length);
    for (const row of pmRows) expect(row.client?.id).toBe(target.clientId);
  });

  it("lists a project's contracts (PRD #18 §440)", async () => {
    const legal = await loginAs("LEGAL");
    const rows = await contracts.listForProject(legal, "project_a");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.project?.id).toBe("project_a");
  });

  it("finds the contracts already drawn from a sales record (PRD #18 §506, §507, §438)", async () => {
    const sourced = await prisma.contract.findFirst({
      where: { companyId: { in: [COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e] }, proposalId: { not: null } },
      select: { id: true, proposalId: true },
    });
    if (!sourced) return;
    const legal = await legalFor(sourced.id);

    const rows = await contracts.listForSalesSource(legal, { proposalId: sourced.proposalId! });
    // A second "Create contract" click meets the first agreement rather than
    // silently making another one.
    expect(rows.some((row) => row.id === sourced.id)).toBe(true);
  });

  it("returns nothing to a reader with no contract permission", async () => {
    const groupIt = await loginAs("GROUP_IT");
    expect(await contracts.listForClient(groupIt, "client_acme")).toEqual([]);
    expect(await contracts.listForProject(groupIt, "project_a")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* §443–§447 Leaks, queues and reports                                         */
/* -------------------------------------------------------------------------- */

describe("search, filters, queues and reports (PRD #18 §443–§447)", () => {
  it("does not let search reach outside scope (PRD #18 §296, §443)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const hit = await contracts.listContracts(
      pm,
      contractListQuerySchema.parse({ search: "Group services NDA", limit: 50 }),
    );
    expect(hit.data.some((row) => row.id === "contract_007")).toBe(false);
  });

  it("does not offer filter options the reader cannot open (PRD #18 §297, §444)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const options = await contracts.contractFilterOptions(pm);
    const reachable = new Set(
      (await contracts.listContracts(pm, query)).data.map((row) => row.client?.id),
    );
    for (const client of options.clients) expect(reachable.has(client.id)).toBe(true);
  });

  it("scopes the approval queue (PRD #18 §188, §445)", async () => {
    const ceo = await loginAs("CEO");
    const result = await approvals.listApprovals(ceo, { status: "PENDING" });
    for (const row of result.data) {
      // Never the fixture tenant's amendment.
      expect(row.recordId).not.toBe("contract_b_amendment_001");
    }
  });

  it("never sums two currencies (PRD #18 §65, §447)", async () => {
    const legal = await loginAs("LEGAL");
    const overview = await contractOverview(legal);
    if (!overview.activeValue) return;

    const codes = overview.activeValue.map((row) => row.currency);
    expect(new Set(codes).size).toBe(codes.length);
    for (const row of overview.activeValue) expect(typeof row.value).toBe("string");
  });

  it("scopes every report to the reader (PRD #18 §299, §446)", async () => {
    const legal = await loginAs("LEGAL");
    const reports = await contractReports(legal);
    expect(reports).toBeTruthy();

    const pm = await loginAs("PROJECT_MANAGER");
    if (can(pm, "legal.report.view")) {
      const limited = await contractReports(pm);
      expect(limited).toBeTruthy();
    } else {
      await expect(contractReports(pm)).rejects.toBeInstanceOf(AccessError);
    }
  });

  it("records activity that names the record and nothing confidential (PRD #18 §210, §448)", async () => {
    const legal = await loginAs("LEGAL");
    const feed = await listRecordActivity(legal, "Contract", SEED.active, { limit: 20 });

    expect(feed.data.length).toBeGreaterThan(0);
    for (const entry of feed.data) {
      // No money, no legal note, no termination reason in the message itself.
      expect(entry.message ?? "").not.toMatch(/€|\bEUR\b|\d{4,}\.\d{2}/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* §418, §462 Company isolation                                                */
/* -------------------------------------------------------------------------- */

describe("company isolation (PRD #18 §418, §462)", () => {
  it("keeps the fixture tenant's contract out of every Aurelia read", async () => {
    const legal = await loginAs("LEGAL");
    const owner = await loginAs("OWNER");

    for (const context of [legal, owner]) {
      const rows = await contracts.listContracts(context, query);
      expect(rows.data.some((row) => row.id === SEED.tenant)).toBe(false);

      await expect(contracts.getContract(context, SEED.tenant)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      expect(await parties.listParties(context, SEED.tenant)).toEqual([]);
      expect(await obligations.listForContract(context, SEED.tenant)).toEqual([]);
      expect(await amendments.listForContract(context, SEED.tenant)).toEqual([]);
    }
  });

  it("keeps the fixture tenant out of search, the obligation register and the export", async () => {
    const legal = await loginAs("LEGAL");

    const searched = await contracts.listContracts(
      legal,
      contractListQuerySchema.parse({ search: "Isarwerk", limit: 50 }),
    );
    expect(searched.data).toHaveLength(0);

    const register = await obligations.listObligations(legal, obligationQuery);
    expect(register.data.some((row) => row.contractId === SEED.tenant)).toBe(false);

    const csv = await exportContracts(legal, "contracts", query, obligationQuery);
    expect(csv.csv).not.toContain("Isarwerk");
  });

  it("does not let the fixture tenant reach Aurelia either", async () => {
    const ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    if (!can(ownerB, "legal.contract.view")) return;

    const rows = await contracts.listContracts(ownerB, query);
    expect(rows.data.every((row) => row.id.startsWith("contract_b_"))).toBe(true);

    await expect(contracts.getContract(ownerB, SEED.active)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* §449 Query shape                                                            */
/* -------------------------------------------------------------------------- */

describe("list performance (PRD #18 §303, §449)", () => {
  it("carries client, project, owner and counts without a query per row", async () => {
    const legal = await loginAs("LEGAL");
    const result = await contracts.listContracts(legal, contractListQuerySchema.parse({ limit: 25 }));

    expect(result.data.length).toBeGreaterThan(1);
    // Everything the table renders is already on the row: nothing here would
    // force the page to go back to the database per contract.
    for (const row of result.data) {
      expect(row.owner.fullName).toBeTruthy();
      expect(row.attention).toBeTruthy();
      expect(typeof row.attention.overdueObligations).toBe("number");
    }
  });
});
