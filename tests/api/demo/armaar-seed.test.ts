import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { armaarPassword, seedArmaar } from "../../../prisma/seed/armaar/seed";
import { verifyDemoTenant } from "../../../prisma/seed/armaar/verify";
import { PROJECT_FACTS } from "../../../prisma/seed/armaar/public-facts";
import { prisma } from "../../helpers";

/**
 * The ARMAAR demo tenant as D-01 accepts it (§93-§99, §107, §108, §110, §111):
 * idempotent, public facts untouched, provenance on what a presenter talks
 * about, one person per login, no ARMAAR in product code.
 */

const ARMAAR = "armaar_group";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the ARMAAR demo tenant", () => {
  it("is what D-01 says it is (§93-§99, §108)", async () => {
    expect(await verifyDemoTenant(prisma, ARMAAR)).toEqual([]);
  });

  it("seeds again without adding or changing anything (§73, §110)", async () => {
    const count = async () => ({
      companies: await prisma.company.count({ where: { parentGroupId: ARMAAR } }),
      users: await prisma.user.count({ where: { personProfile: { parentGroupId: ARMAAR } } }),
      logins: await prisma.companyMember.count({ where: { company: { parentGroupId: ARMAAR } } }),
      projects: await prisma.project.count({ where: { company: { parentGroupId: ARMAAR } } }),
      units: await prisma.projectUnit.count({ where: { company: { parentGroupId: ARMAAR } } }),
      contracts: await prisma.contract.count({ where: { company: { parentGroupId: ARMAAR } } }),
      payments: await prisma.payment.count({ where: { company: { parentGroupId: ARMAAR } } }),
      tasks: await prisma.task.count({ where: { company: { parentGroupId: ARMAAR } } }),
      documents: await prisma.document.count({ where: { company: { parentGroupId: ARMAAR } } }),
      history: await prisma.employmentAssignment.count({ where: { company: { parentGroupId: ARMAAR } } }),
      persons: await prisma.personProfile.count({ where: { parentGroupId: ARMAAR } }),
      crewMembers: await prisma.workforceCrewMember.count({ where: { company: { parentGroupId: ARMAAR } } }),
      assignments: await prisma.employeeProjectAssignment.count({ where: { company: { parentGroupId: ARMAAR } } }),
      attendance: await prisma.attendanceRecord.count({ where: { company: { parentGroupId: ARMAAR } } }),
      inductions: await prisma.hseInduction.count({ where: { company: { parentGroupId: ARMAAR } } }),
      records: await prisma.demoRecord.count({ where: { parentGroupId: ARMAAR } }),
      // D-02's operational data.
      clients: await prisma.client.count({ where: { company: { parentGroupId: ARMAAR } } }),
      suppliers: await prisma.supplier.count({ where: { company: { parentGroupId: ARMAAR } } }),
      requests: await prisma.purchaseRequest.count({ where: { company: { parentGroupId: ARMAAR } } }),
      orders: await prisma.purchaseOrder.count({ where: { company: { parentGroupId: ARMAAR } } }),
      receipts: await prisma.goodsReceipt.count({ where: { company: { parentGroupId: ARMAAR } } }),
      commitments: await prisma.commitment.count({ where: { company: { parentGroupId: ARMAAR } } }),
      contractors: await prisma.contractorProfile.count({ where: { company: { parentGroupId: ARMAAR } } }),
      revisions: await prisma.engineeringDocumentRevision.count({ where: { engineeringDocument: { company: { parentGroupId: ARMAAR } } } }),
      rfis: await prisma.rfi.count({ where: { company: { parentGroupId: ARMAAR } } }),
      submittals: await prisma.technicalSubmittal.count({ where: { company: { parentGroupId: ARMAAR } } }),
      transmittals: await prisma.documentTransmittal.count({ where: { company: { parentGroupId: ARMAAR } } }),
      invoices: await prisma.invoice.count({ where: { company: { parentGroupId: ARMAAR } } }),
      expenses: await prisma.expense.count({ where: { company: { parentGroupId: ARMAAR } } }),
      obligations: await prisma.contractObligation.count({ where: { company: { parentGroupId: ARMAAR } } }),
      amendments: await prisma.contractAmendment.count({ where: { company: { parentGroupId: ARMAAR } } }),
      meetings: await prisma.meeting.count({ where: { company: { parentGroupId: ARMAAR } } }),
      events: await prisma.calendarEvent.count({ where: { company: { parentGroupId: ARMAAR } } }),
      reviews: await prisma.documentReview.count({ where: { documentId: { startsWith: "armaar_" } } }),
      dailyLogs: await prisma.dailyLog.count({ where: { company: { parentGroupId: ARMAAR } } }),
      hazards: await prisma.hseHazard.count({ where: { company: { parentGroupId: ARMAAR } } }),
      talks: await prisma.toolboxTalk.count({ where: { company: { parentGroupId: ARMAAR } } }),
      qualityInspections: await prisma.qualityInspection.count({ where: { company: { parentGroupId: ARMAAR } } }),
      movements: await prisma.stockMovement.count({ where: { company: { parentGroupId: ARMAAR } } }),
      timesheets: await prisma.timesheet.count({ where: { company: { parentGroupId: ARMAAR } } }),
      workLogs: await prisma.workLog.count({ where: { company: { parentGroupId: ARMAAR } } }),
    });
    const before = await count();
    // ARMAAR's own rows only: the steps over every group's rows run beside other suites' writes.
    await seedArmaar(prisma, await hashPassword(armaarPassword()), { shared: false });
    expect(await count()).toEqual(before);
    expect(await verifyDemoTenant(prisma, ARMAAR)).toEqual([]);
  }, 120_000);

  it("runs at D-02's recommended scale (§15, §18, §23, §24, §30, §31, §36, §48)", async () => {
    const inGroup = { company: { parentGroupId: ARMAAR } };
    const lake = "armaar_prj_tirana_lake";
    const square = "armaar_prj_square_21";
    const within = (value: number, low: number, high: number, what: string) => {
      expect(value, what).toBeGreaterThanOrEqual(low);
      expect(value, what).toBeLessThanOrEqual(high);
    };
    within(await prisma.projectUnit.count({ where: { projectId: lake } }), 80, 120, "Tirana Lake units");
    within(await prisma.projectUnit.count({ where: { projectId: square } }), 100, 200, "Square 21 units");
    // Clients are company-scoped: a company buying in Tirana Lake (BCI) and Square 21 (ARLIS - NDERTIM) is a client of each,
    // so the scale is counted in buyers, one per name across the group.
    within((await prisma.client.groupBy({ by: ["normalizedName"], where: inGroup })).length, 40, 80, "buyers");
    within(await prisma.supplier.count({ where: inGroup }), 20, 30, "suppliers");
    within(await prisma.contractorProfile.count({ where: inGroup }), 7, 12, "contractors");
    within(await prisma.task.count({ where: inGroup }), 50, 100, "tasks");
    within(await prisma.document.count({ where: { projectId: lake, status: "ACTIVE" } }), 30, 60, "Tirana Lake documents");
    within(await prisma.rfi.count({ where: inGroup }), 10, 20, "RFIs");
    within(await prisma.technicalSubmittal.count({ where: inGroup }), 10, 20, "submittals");
    within(await prisma.documentTransmittal.count({ where: inGroup }), 5, 10, "transmittals");
    within(await prisma.meeting.count({ where: inGroup }), 10, 20, "meetings");
    within(await prisma.dailyLog.count({ where: { projectId: lake } }), 20, 40, "Tirana Lake daily logs");
    const procurement = (await prisma.purchaseRequest.count({ where: inGroup })) + (await prisma.purchaseOrder.count({ where: inGroup })) + (await prisma.goodsReceipt.count({ where: inGroup }));
    within(procurement, 20, 40, "procurement records");
    const safetyAndQuality = (await prisma.hseInspection.count({ where: inGroup })) + (await prisma.hseHazard.count({ where: inGroup })) + (await prisma.hseIncident.count({ where: inGroup })) + (await prisma.qualityInspection.count({ where: inGroup })) + (await prisma.nonConformanceReport.count({ where: inGroup }));
    within(safetyAndQuality, 15, 30, "HSE and QA/QC records");
    // Only the product's own task states, and none of E-07's (§31).
    expect(await prisma.task.count({ where: { ...inGroup, status: { notIn: ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"] } } })).toBe(0);
  });

  it("carries each demo scenario through the product's own links (§62-§68)", async () => {
    const inGroup = { company: { parentGroupId: ARMAAR } };
    const lake = "armaar_prj_tirana_lake";
    // Procurement: request → approval → supplier → order → delivery, and the commitment the approval opened (§64).
    const delivered = await prisma.goodsReceipt.findFirstOrThrow({ where: { ...inGroup, projectId: lake }, select: { purchaseOrder: { select: { financeCommitmentId: true, supplierId: true, purchaseRequestId: true } } } });
    expect(delivered.purchaseOrder.financeCommitmentId).not.toBeNull();
    expect(await prisma.procurementApproval.count({ where: { recordId: delivered.purchaseOrder.purchaseRequestId!, status: "APPROVED" } })).toBe(1);
    // Engineering: a work package with RFIs, submittals and a transmittal issuing a revision (§65).
    expect(await prisma.rfi.count({ where: { projectId: lake, workPackageId: { not: null } } })).toBeGreaterThan(0);
    expect(await prisma.technicalSubmittal.count({ where: { projectId: lake, currentRevisionId: { not: null } } })).toBeGreaterThan(0);
    expect(await prisma.documentTransmittalItem.count({ where: { transmittal: { projectId: lake, status: "ISSUED" }, engineeringRevisionId: { not: null } } })).toBeGreaterThan(0);
    // Finance: invoice → payment → allocation (§67).
    expect(await prisma.paymentAllocation.count({ where: { invoiceId: { not: null }, payment: { ...inGroup, status: "RECORDED", direction: "RECEIPT" } } })).toBeGreaterThan(0);
    expect(await prisma.paymentAllocation.count({ where: { expenseId: { not: null }, payment: { ...inGroup, direction: "DISBURSEMENT" } } })).toBeGreaterThan(0);
    // Site operations: the daily log names the crews E-04 keeps, stock goes to the project, hours are approved (§68).
    expect(await prisma.dailyLogWorkforceEntry.count({ where: { dailyLog: { projectId: lake }, crewId: { not: null } } })).toBeGreaterThan(0);
    expect(await prisma.stockMovement.count({ where: { ...inGroup, projectId: lake, movementType: "ISSUE" } })).toBeGreaterThan(0);
    expect(await prisma.workLog.count({ where: { ...inGroup, projectId: lake, timesheet: { status: "APPROVED" } } })).toBeGreaterThan(0);
    expect(await prisma.toolboxTalkParticipant.count({ where: { toolboxTalk: inGroup, employeeProfile: { companyMemberId: null } } })).toBeGreaterThan(0);
  });

  it("records where each fact comes from, field by field where a record mixes them (§3, §107)", async () => {
    const lake = await prisma.demoRecord.findUniqueOrThrow({ where: { key: "ARMAAR:PROJECT:TIRANA_LAKE" } });
    expect(lake).toMatchObject({ sourceType: "PUBLIC", sourceVerifiedAt: expect.any(Date) });
    expect(lake.fieldSources).toMatchObject({ name: "PUBLIC", builtArea: "PUBLIC", company: "PUBLIC", status: "SYNTHETIC", progress: "SYNTHETIC" });

    const square = await prisma.demoRecord.findUniqueOrThrow({ where: { key: "ARMAAR:PROJECT:SQUARE_21" } });
    expect(square.fieldSources).toMatchObject({ name: "PUBLIC", company: "SYNTHETIC" });
    expect(square.note).toMatch(/not in the source set/);

    // A persona is synthetic; the people D-03 names are held by their own test.
    const person = await prisma.demoRecord.findUniqueOrThrow({ where: { key: "ARMAAR:PERSON:bci.director" } });
    expect(person.sourceType).toBe("SYNTHETIC");
    // Nothing is public that the source set does not say.
    const projects = await prisma.project.findMany({ where: { company: { parentGroupId: ARMAAR } }, select: { name: true, builtArea: true } });
    for (const project of projects) {
      const fact = PROJECT_FACTS.find((candidate) => candidate.name === project.name)!;
      expect(project.builtArea === null ? undefined : Number(project.builtArea), project.name).toBe(fact.builtArea);
    }
  });

  it("gives each person one person record and addresses nobody real (§11, §76, §95)", async () => {
    const users = await prisma.user.findMany({ where: { personProfile: { parentGroupId: ARMAAR } }, select: { email: true, personProfileId: true } });
    expect(new Set(users.map((user) => user.personProfileId)).size).toBe(users.length);
    // The reserved .test domain: no address here can reach a mailbox.
    expect(users.every((user) => user.email?.endsWith("@armaar-demo.test"))).toBe(true);
    const suppliers = await prisma.supplier.findMany({ where: { company: { parentGroupId: ARMAAR } }, select: { taxId: true } });
    // No Albanian NIPT begins with X: none of these can be a real company's.
    expect(suppliers.every((supplier) => supplier.taxId?.startsWith("X"))).toBe(true);
  });

  it("has a site workforce that never signs in: employed, in a crew, on a project (E-04 §4, §28-§42)", async () => {
    // The site workforce: people without a login who are employed today — not a candidate still to start, nor somebody who has left (E-08 §46, §54).
    const workers = await prisma.personProfile.findMany({
      where: { parentGroupId: ARMAAR, user: null, employments: { some: { employmentStatus: "ACTIVE" } } },
      select: {
        id: true,
        employments: {
          select: {
            employmentStatus: true,
            companyMemberId: true,
            tradeId: true,
            projectAssignments: { where: { endDate: null }, select: { isPrimary: true } },
            crewMemberships: { where: { endDate: null }, select: { id: true } },
          },
        },
      },
    });
    expect(workers.length).toBeGreaterThan(0);
    for (const worker of workers) {
      expect(worker.employments, worker.id).toHaveLength(1);
      const [employment] = worker.employments;
      expect(employment, worker.id).toMatchObject({ employmentStatus: "ACTIVE", companyMemberId: null, tradeId: expect.any(String) });
      expect(employment!.projectAssignments, worker.id).toEqual([{ isPrimary: true }]);
      expect(employment!.crewMemberships, worker.id).toHaveLength(1);
    }
    // Each crew is led by a foreman who has no login either (§31, §32).
    const crews = await prisma.workforceCrew.findMany({ where: { company: { parentGroupId: ARMAAR }, status: "ACTIVE" }, select: { supervisor: { select: { companyMemberId: true } } } });
    expect(crews.length).toBeGreaterThan(0);
    expect(crews.every((crew) => crew.supervisor && crew.supervisor.companyMemberId === null)).toBe(true);
  });

  it("keeps suspended companies visible and free of new work (§5, §93)", async () => {
    const suspended = await prisma.company.findMany({ where: { parentGroupId: ARMAAR, status: "SUSPENDED" }, select: { id: true } });
    expect(suspended).toHaveLength(4);
    expect(await prisma.project.count({ where: { companyId: { in: suspended.map((row) => row.id) } } })).toBe(0);
    expect(await prisma.task.count({ where: { companyId: { in: suspended.map((row) => row.id) } } })).toBe(0);
  });

  it("is data, never product behaviour: no product code names ARMAAR (§92)", () => {
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const file = path.join(dir, entry);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx)$/.test(entry) && /armaar/i.test(readFileSync(file, "utf8"))) named.push(file);
      }
    };
    for (const root of ["app", "components", "config", "lib"]) walk(path.resolve(process.cwd(), root));
    expect(named).toEqual([]);
  });
});
