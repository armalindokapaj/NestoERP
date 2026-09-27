import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { listCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { complianceListSchema, contractorListSchema, workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { listContractors } from "@/lib/modules/contractors/contractor.service";
import { myEngineeringWork } from "@/lib/modules/engineering/engineering.overview";
import { listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { rfiListSchema } from "@/lib/modules/engineering/engineering.schema";
import { listProjectWorkPackagesPage, listWorkPackages } from "@/lib/modules/work-packages/work-package.service";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * AUD-08 §3, §4 on the engineering, contractor and work-package registers,
 * against the real database (DT-02, DT-03, DT-04, DT-05, DT-06, DT-22).
 *
 * Every expected id, order and count below is written from the fixture
 * definitions in this file — never read back from the service under test.
 * Fixtures are owned by the `aud08e_` prefix and removed in afterAll.
 */

const COMPANY_A = "company_demo_a";
const P2 = "aud08e_project";
const P2_NAME = "AUD08E Second Site";
const TENANT_PROJECT = PROJECT.companyB;

let owner: UserContext;
let engineer: UserContext;

/* RFIs --------------------------------------------------------------------- */

type RfiFixture = { id: string; projectId: string; projectName: string; number: string; due: string | null; status: "OPEN" | "DRAFT"; priority: "NORMAL" | "HIGH" };

const RIVERSIDE = "Riverside Residences";
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 55 RFIs numbered AUD08E-01.. on two projects. The same number exists on both
 * projects with the same due date, so only the id can order those pairs; a
 * third of them have no due date. Leading zeros keep the numbers text.
 */
const RFIS: RfiFixture[] = [
  ...Array.from({ length: 30 }, (_, i) => i + 1).map((n) => ({ id: `aud08e_rfi_a_${pad(n)}`, projectId: PROJECT.a, projectName: RIVERSIDE, n })),
  ...Array.from({ length: 25 }, (_, i) => i + 1).map((n) => ({ id: `aud08e_rfi_b_${pad(n)}`, projectId: P2, projectName: P2_NAME, n })),
].map(({ id, projectId, projectName, n }) => ({
  id,
  projectId,
  projectName,
  number: `AUD08E-${pad(n)}`,
  due: n % 3 === 0 ? null : n % 2 === 1 ? "2031-01-10" : "2031-01-05",
  status: n % 4 === 0 ? "DRAFT" : "OPEN",
  priority: n % 5 === 0 ? "HIGH" : "NORMAL",
}));

/** The documented RFI order, written independently: due ascending, undated last, then number, then id. */
function expectedRfiOrder(rows: RfiFixture[]): string[] {
  return [...rows]
    .sort((x, y) => {
      if (x.due !== y.due) {
        if (x.due === null) return 1;
        if (y.due === null) return -1;
        return x.due < y.due ? -1 : 1;
      }
      if (x.number !== y.number) return x.number < y.number ? -1 : 1;
      return x.id < y.id ? -1 : 1;
    })
    .map((row) => row.id);
}

/** 51 answered RFIs raised by the PM that sort before the one raised by the Owner. */
const CLOSE_PM = Array.from({ length: 51 }, (_, i) => `aud08e_close_pm_${pad(i + 1)}`);
const CLOSE_OWNER = "aud08e_close_owner";

/* Contractors, compliance, work packages ------------------------------------ */

const CONTRACTORS = { one: "aud08e_ctr_1", two: "aud08e_ctr_2", archived: "aud08e_ctr_3" } as const;
const COMPLIANCE = { aEarly1: "aud08e_cmp_1", aEarly2: "aud08e_cmp_2", bEarly: "aud08e_cmp_3", aUndated: "aud08e_cmp_4", archived: "aud08e_cmp_5" } as const;
const PACKAGES = { aOne: "aud08e_wp_a1", aTwoArchived: "aud08e_wp_a2", bOne: "aud08e_wp_b1", bTwo: "aud08e_wp_b2" } as const;

async function cleanup() {
  await prisma.rfi.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
  await prisma.workPackage.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
  await prisma.contractorComplianceItem.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
  await prisma.contractorProfile.deleteMany({ where: { id: { startsWith: "aud08e_" } } });
  await prisma.projectMember.deleteMany({ where: { projectId: P2 } });
  await prisma.project.deleteMany({ where: { id: P2 } });
}

beforeAll(async () => {
  await cleanup();
  [owner, engineer] = await Promise.all([loginAs("OWNER"), loginAs("ENGINEER")]);
  const pm = await loginAs("PROJECT_MANAGER");
  await prisma.project.create({ data: { id: P2, companyId: COMPANY_A, code: "AUD08E-P2", name: P2_NAME, status: "ACTIVE", projectManagerMemberId: pm.membershipId, createdBy: "aud08e" } });
  await prisma.projectMember.create({ data: { companyId: COMPANY_A, projectId: P2, companyMemberId: pm.membershipId, status: "ACTIVE", projectRole: "Project Manager" } });

  await prisma.rfi.createMany({
    data: RFIS.map((row) => ({
      id: row.id,
      companyId: COMPANY_A,
      projectId: row.projectId,
      rfiNumber: row.number,
      subject: `Probe ${row.number}`,
      question: "AUD-08 register probe.",
      status: row.status,
      priority: row.priority,
      dueAt: row.due ? new Date(`${row.due}T00:00:00.000Z`) : null,
      createdByMemberId: pm.membershipId,
    })),
  });
  await prisma.rfi.createMany({
    data: [
      ...CLOSE_PM.map((id, i) => ({ id, companyId: COMPANY_A, projectId: P2, rfiNumber: `Z8E-PM-${pad(i + 1)}`, subject: "Answered, PM", question: "?", status: "ANSWERED" as const, dueAt: new Date("2000-01-01T00:00:00.000Z"), createdByMemberId: pm.membershipId })),
      { id: CLOSE_OWNER, companyId: COMPANY_A, projectId: P2, rfiNumber: "Z8E-OWNER", subject: "Answered, Owner", question: "?", status: "ANSWERED" as const, dueAt: new Date("2040-01-01T00:00:00.000Z"), createdByMemberId: owner.membershipId },
    ],
  });

  await prisma.contractorProfile.createMany({
    data: [
      { id: CONTRACTORS.one, companyId: COMPANY_A, legalName: "AUD08E Tied Contractor", status: "ACTIVE", createdByMemberId: owner.membershipId },
      { id: CONTRACTORS.two, companyId: COMPANY_A, legalName: "AUD08E Tied Contractor", status: "PROSPECTIVE", createdByMemberId: owner.membershipId },
      { id: CONTRACTORS.archived, companyId: COMPANY_A, legalName: "AUD08E Tied Contractor", status: "ARCHIVED", createdByMemberId: owner.membershipId },
    ],
  });
  const expiry = new Date("2031-06-30T00:00:00.000Z");
  await prisma.contractorComplianceItem.createMany({
    data: [
      { id: COMPLIANCE.aEarly2, companyId: COMPANY_A, contractorId: CONTRACTORS.one, type: "INSURANCE", title: "A cover", expiresAt: expiry, createdByMemberId: owner.membershipId },
      { id: COMPLIANCE.aEarly1, companyId: COMPANY_A, contractorId: CONTRACTORS.one, type: "INSURANCE", title: "A cover", expiresAt: expiry, createdByMemberId: owner.membershipId },
      { id: COMPLIANCE.bEarly, companyId: COMPANY_A, contractorId: CONTRACTORS.two, type: "LICENSE", title: "B licence", expiresAt: expiry, status: "MISSING", createdByMemberId: owner.membershipId },
      { id: COMPLIANCE.aUndated, companyId: COMPANY_A, contractorId: CONTRACTORS.two, type: "INSURANCE", title: "A cover", expiresAt: null, createdByMemberId: owner.membershipId },
      { id: COMPLIANCE.archived, companyId: COMPANY_A, contractorId: CONTRACTORS.one, type: "INSURANCE", title: "A cover", expiresAt: expiry, archivedAt: new Date(), createdByMemberId: owner.membershipId },
    ],
  });
  await prisma.workPackage.createMany({
    data: [
      { id: PACKAGES.aOne, companyId: COMPANY_A, projectId: PROJECT.a, code: "AUD08E-WP-1", name: "Probe one", createdByMemberId: owner.membershipId },
      { id: PACKAGES.aTwoArchived, companyId: COMPANY_A, projectId: PROJECT.a, code: "AUD08E-WP-2", name: "Probe two", archivedAt: new Date(), createdByMemberId: owner.membershipId },
      { id: PACKAGES.bOne, companyId: COMPANY_A, projectId: P2, code: "AUD08E-WP-1", name: "Probe one", createdByMemberId: owner.membershipId },
      { id: PACKAGES.bTwo, companyId: COMPANY_A, projectId: P2, code: "AUD08E-WP-2", name: "Probe two", createdByMemberId: owner.membershipId },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
});

const rfiQuery = (extra: Record<string, unknown> = {}) => rfiListSchema.parse({ q: "AUD08E", ...extra });

describe("RFI register (AUD-08 §3, §4)", () => {
  it("DT-04: walking every page gives the documented order exactly once, ties broken by id", async () => {
    const first = await listRfis(owner, rfiQuery());
    const second = await listRfis(owner, rfiQuery({ page: 2 }));
    expect(first.total).toBe(55);
    expect(second.total).toBe(55);
    expect(first.pageSize).toBe(50);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(5);
    const walked = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(walked).size).toBe(55);
    expect(walked).toEqual(expectedRfiOrder(RFIS));
    // The pairs tied on due date and number: project A's id sorts before project B's.
    expect(walked.indexOf("aud08e_rfi_a_01")).toBe(walked.indexOf("aud08e_rfi_b_01") - 1);
    // Undated RFIs come last.
    expect(walked.slice(-18).every((id) => RFIS.find((row) => row.id === id)!.due === null)).toBe(true);
  });

  it("DT-03: filters and search combine with AND, and the total is counted before the page", async () => {
    // Written from the fixture rules: OPEN = n % 4 != 0, HIGH = n % 5 == 0.
    // Project A n=1..30: HIGH 5,10,15,20,25,30; OPEN among them 5,10,15,25,30 → 5. Project B n=1..25: HIGH 5,10,15,20,25; OPEN 5,10,15,25 → 4.
    const openHigh = await listRfis(owner, rfiQuery({ status: "OPEN", priority: "HIGH" }));
    expect(openHigh.total).toBe(9);
    expect(openHigh.items.map((row) => row.id).sort()).toEqual(
      ["aud08e_rfi_a_05", "aud08e_rfi_a_10", "aud08e_rfi_a_15", "aud08e_rfi_a_25", "aud08e_rfi_a_30", "aud08e_rfi_b_05", "aud08e_rfi_b_10", "aud08e_rfi_b_15", "aud08e_rfi_b_25"].sort(),
    );
    // A section (the project) plus search: 25 on project B, one page.
    const onB = await listRfis(owner, rfiQuery({ projectId: P2 }));
    expect(onB.total).toBe(25);
    expect(onB.items.every((row) => row.projectId === P2)).toBe(true);
    // Search on a number keeps leading zeros as text: "AUD08E-0" is 1..9 on both projects.
    const zero = await listRfis(owner, rfiListSchema.parse({ q: "AUD08E-0" }));
    expect(zero.total).toBe(18);
  });

  it("DT-05: a page past the end is clamped to the last page, and an empty list is page 1", async () => {
    const past = await listRfis(owner, rfiQuery({ page: 9 }));
    expect(past.total).toBe(55);
    expect(past.page).toBe(2);
    const none = await listRfis(owner, rfiListSchema.parse({ q: "aud08e-no-such-rfi" }));
    expect(none).toMatchObject({ total: 0, page: 1, items: [] });
    // A malformed page reads as page 1 instead of failing the register.
    expect(rfiListSchema.parse({ page: "abc" }).page).toBe(1);
  });

  it("DT-22: a project outside the reader's reach is refused; the reader's own project answers", async () => {
    await expect(listRfis(owner, rfiQuery({ projectId: TENANT_PROJECT }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The Engineer is not on the second site: refused there, and the company-wide list shows only project A.
    await expect(listRfis(engineer, rfiQuery({ projectId: P2 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const own = await listRfis(engineer, rfiQuery());
    expect(own.total).toBe(30);
    expect(own.items.every((row) => row.projectId === PROJECT.a)).toBe(true);
  });

  it("My engineering work finds the Owner's answered RFI past the first 50 answered ones", async () => {
    // Before AUD-08 "ready to close" filtered the first page of every answered RFI; 51 of the PM's sort first.
    const baseline = await prisma.rfi.count({ where: { companyId: COMPANY_A, status: "ANSWERED", createdByMemberId: owner.membershipId, id: { not: CLOSE_OWNER } } });
    const work = await myEngineeringWork(owner);
    expect(work.toClose.map((row) => row.id)).toContain(CLOSE_OWNER);
    expect(work.toClose.some((row) => CLOSE_PM.includes(row.id))).toBe(false);
    expect(work.counts.toClose).toBe(baseline + 1);
  });
});

describe("contractor directory, compliance and work packages (AUD-08 §3, §4)", () => {
  it("DT-04, DT-02: tied legal names keep id order across pages; archived only when asked", async () => {
    const walk = async (extra: Record<string, unknown>) => {
      const ids: string[] = [];
      for (let page = 1; page <= 4; page += 1) {
        const result = await listContractors(owner, contractorListSchema.parse({ q: "AUD08E Tied", pageSize: 1, page, ...extra }));
        if (result.page !== page) break;
        ids.push(...result.items.map((row) => row.id));
      }
      return ids;
    };
    expect(await walk({})).toEqual([CONTRACTORS.one, CONTRACTORS.two]);
    expect(await walk({ includeArchived: "1" })).toEqual([CONTRACTORS.one, CONTRACTORS.two, CONTRACTORS.archived]);
    const past = await listContractors(owner, contractorListSchema.parse({ q: "AUD08E Tied", pageSize: 1, page: 7 }));
    expect(past).toMatchObject({ total: 2, page: 2 });
  });

  it("DT-22: a foreign project narrows the directory to nothing", async () => {
    const foreign = await listContractors(owner, contractorListSchema.parse({ q: "AUD08E Tied", projectId: TENANT_PROJECT }));
    expect(foreign.total).toBe(0);
    expect((await listContractors(owner, contractorListSchema.parse({ q: "AUD08E Tied" }))).total).toBe(2);
  });

  it("DT-04, DT-03: compliance by expiry (undated last), title, then id; archived never listed; alerts filter", async () => {
    const all = await listCompliance(owner, complianceListSchema.parse({ q: "AUD08E Tied" }));
    expect(all.total).toBe(4);
    expect(all.items.map((row) => row.id)).toEqual([COMPLIANCE.aEarly1, COMPLIANCE.aEarly2, COMPLIANCE.bEarly, COMPLIANCE.aUndated]);
    const alerts = await listCompliance(owner, complianceListSchema.parse({ q: "AUD08E Tied", alerts: "1" }));
    expect(alerts.items.map((row) => row.id)).toEqual([COMPLIANCE.bEarly]);
    const past = await listCompliance(owner, complianceListSchema.parse({ q: "AUD08E Tied", page: 3 }));
    expect(past).toMatchObject({ total: 4, page: 1 });
  });

  it("DT-04, DT-02: work packages by project name, code, then id; archived only when asked", async () => {
    const live = await listWorkPackages(owner, workPackageListSchema.parse({ q: "AUD08E-WP" }));
    // "AUD08E Second Site" sorts before "Riverside Residences".
    expect(live.items.map((row) => row.id)).toEqual([PACKAGES.bOne, PACKAGES.bTwo, PACKAGES.aOne]);
    expect(live.total).toBe(3);
    const all = await listWorkPackages(owner, workPackageListSchema.parse({ q: "AUD08E-WP", includeArchived: "1" }));
    expect(all.items.map((row) => row.id)).toEqual([PACKAGES.bOne, PACKAGES.bTwo, PACKAGES.aOne, PACKAGES.aTwoArchived]);
  });

  it("DT-22, DT-05: the project tab pages its own project and refuses one the reader cannot open", async () => {
    const tab = await listProjectWorkPackagesPage(owner, P2, workPackageListSchema.parse({ q: "AUD08E-WP", page: 4 }));
    expect(tab).toMatchObject({ total: 2, page: 1 });
    await expect(listProjectWorkPackagesPage(engineer, P2, workPackageListSchema.parse({}))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const foreign = await listWorkPackages(owner, workPackageListSchema.parse({ q: "AUD08E-WP", projectId: TENANT_PROJECT }));
    expect(foreign.total).toBe(0);
    const own = await listWorkPackages(engineer, workPackageListSchema.parse({ q: "AUD08E-WP" }));
    expect(own.items.map((row) => row.id)).toEqual([PACKAGES.aOne]);
  });
});
