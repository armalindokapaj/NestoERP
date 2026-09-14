import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { contractorListSchema } from "@/lib/modules/contractors/contractor.schema";
import { listContractors } from "@/lib/modules/contractors/contractor.service";
import { listEngineeringDocuments } from "@/lib/modules/engineering/engineering.documents";
import { getRfi, listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { engineeringDocumentListSchema, rfiListSchema, submittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { getSubmittal, listSubmittals } from "@/lib/modules/engineering/engineering.submittals";
import { cleanupSessions, loginAs, prisma } from "../helpers";

/**
 * Contractor and engineering performance (PRD #46 §235, §236).
 *
 * Seeds 2,000 contractors with three compliance items each, and 20 projects
 * with 30 assigned contractors, 400 RFIs (two responses apiece), 250
 * submittals (two revisions apiece) and 400 engineering documents (three
 * revisions apiece) — about 60,000 rows — then times the contractor directory,
 * the project engineering registers and the RFI and submittal details as the
 * Owner, the Project Manager and the Engineer. Targets: contractor list
 * P95 < 800 ms, register P95 < 1.2 s, RFI detail P95 < 800 ms, submittal
 * detail P95 < 1 s.
 *
 * Opt-in (`NESTO_PERF=1`): it writes into the shared development database for
 * the length of the run and removes everything afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/engineering.perf.test.ts
 */

const RUN = process.env.NESTO_PERF === "1";
const COMPANY = "company_demo_a";
const PREFIX = "perf_eng";
const CONTRACTORS = 2_000;
const PROJECTS = 20;
const ASSIGNED = 30;
const RFIS = 400;
const SUBMITTALS = 250;
const DOCUMENTS = 400;
const CHUNK = 5_000;
/** Revisions point at an existing stored file; the registers never open it. */
const FILE = "doc_sub_001_a";

async function cleanup() {
  const projects = (await prisma.project.findMany({ where: { id: { startsWith: `${PREFIX}_project_` } }, select: { id: true } })).map((row) => row.id);
  const inProjects = { projectId: { in: projects } };
  await prisma.rfiResponse.deleteMany({ where: { rfi: inProjects } });
  await prisma.rfi.deleteMany({ where: inProjects });
  await prisma.technicalSubmittal.updateMany({ where: inProjects, data: { currentRevisionId: null } });
  await prisma.technicalSubmittalRevision.deleteMany({ where: { submittal: inProjects } });
  await prisma.technicalSubmittal.deleteMany({ where: inProjects });
  await prisma.engineeringDocument.updateMany({ where: inProjects, data: { currentRevisionId: null } });
  await prisma.engineeringDocumentRevision.deleteMany({ where: { engineeringDocument: inProjects } });
  await prisma.engineeringDocument.deleteMany({ where: inProjects });
  await prisma.projectContractorAssignment.deleteMany({ where: inProjects });
  await prisma.contractorComplianceItem.deleteMany({ where: { contractorId: { startsWith: `${PREFIX}_contractor_` } } });
  await prisma.contractorProfile.deleteMany({ where: { id: { startsWith: `${PREFIX}_contractor_` } } });
  await prisma.projectMember.deleteMany({ where: inProjects });
  await prisma.project.deleteMany({ where: { id: { in: projects } } });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function time(run: () => Promise<unknown>, attempts = 10): Promise<number[]> {
  await run();
  const timings: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const started = performance.now();
    await run();
    timings.push(performance.now() - started);
  }
  return timings;
}

async function insert<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += CHUNK) await write(rows.slice(index, index + CHUNK));
}

const day = (offset: number) => new Date(Date.UTC(2026, 8, 14 + offset, 12));

describe.skipIf(!RUN)("contractors and engineering at 2,000 contractors × 20 projects (§235)", () => {
  beforeAll(async () => {
    await cleanup();
    const member = (email: string) => prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY, user: { email } }, select: { id: true } }).then((row) => row.id);
    const [pm, engineer, architect] = await Promise.all([member("pm@nesto.test"), member("engineer@nesto.test"), member("architect@nesto.test")]);

    await prisma.project.createMany({ data: Array.from({ length: PROJECTS }, (_, index) => ({ id: `${PREFIX}_project_${index}`, companyId: COMPANY, code: `PERF-ENG-${index}`, name: `Perf engineering ${String(index).padStart(2, "0")}`, status: "ACTIVE" as const, projectManagerMemberId: pm, createdBy: "perf" })) });
    await prisma.projectMember.createMany({ data: Array.from({ length: PROJECTS }, (_, index) => [engineer, architect].map((companyMemberId) => ({ companyId: COMPANY, projectId: `${PREFIX}_project_${index}`, companyMemberId, status: "ACTIVE" as const }))).flat() });

    await insert(
      Array.from({ length: CONTRACTORS }, (_, index) => ({ id: `${PREFIX}_contractor_${index}`, companyId: COMPANY, legalName: `Perf Contractor ${String(index).padStart(4, "0")} sh.p.k.`, normalizedName: `perf contractor ${String(index).padStart(4, "0")}`, status: index % 10 === 0 ? ("PROSPECTIVE" as const) : ("ACTIVE" as const), countryCode: "AL", createdByMemberId: pm })),
      (data) => prisma.contractorProfile.createMany({ data }),
    );
    await insert(
      Array.from({ length: CONTRACTORS }, (_, index) =>
        (["INSURANCE", "LICENSE", "TAX_DOCUMENT"] as const).map((type, item) => ({ companyId: COMPANY, contractorId: `${PREFIX}_contractor_${index}`, type, title: `${type} ${index}`, status: item === 0 && index % 7 === 0 ? ("EXPIRING" as const) : ("VALID" as const), expiresAt: day(30 + ((index + item) % 300)), createdByMemberId: pm })),
      ).flat(),
      (data) => prisma.contractorComplianceItem.createMany({ data }),
    );

    for (let project = 0; project < PROJECTS; project += 1) {
      const projectId = `${PREFIX}_project_${project}`;
      const contractorOf = (index: number) => `${PREFIX}_contractor_${project * ASSIGNED + (index % ASSIGNED)}`;
      await prisma.projectContractorAssignment.createMany({ data: Array.from({ length: ASSIGNED }, (_, index) => ({ companyId: COMPANY, projectId, contractorId: contractorOf(index), status: "ACTIVE" as const, internalManagerMemberId: pm, createdByMemberId: pm })) });

      const rfis = Array.from({ length: RFIS }, (_, index) => ({ id: `${PREFIX}_rfi_${project}_${index}`, companyId: COMPANY, projectId, rfiNumber: `RFI-${String(index + 1).padStart(4, "0")}`, subject: `Perf question ${index} on site ${project}`, question: "Which detail applies at this grid line?", status: (["OPEN", "ANSWERED", "CLOSED", "CLARIFICATION_REQUIRED"] as const)[index % 4], priority: "NORMAL" as const, contractorId: contractorOf(index), assignedToMemberId: architect, dueAt: day((index % 30) - 15), openedAt: day(-40), createdByMemberId: engineer }));
      await prisma.rfi.createMany({ data: rfis });
      await prisma.rfiResponse.createMany({ data: rfis.flatMap((rfi) => [0, 1].map((n) => ({ companyId: COMPANY, rfiId: rfi.id, responseText: `Response ${n} to ${rfi.subject}`, respondedByMemberId: architect, respondedAt: day(-10 + n), finalResponse: n === 1 }))) });

      const submittals = Array.from({ length: SUBMITTALS }, (_, index) => ({ id: `${PREFIX}_sub_${project}_${index}`, companyId: COMPANY, projectId, submittalNumber: `SUB-${String(index + 1).padStart(4, "0")}`, title: `Perf submittal ${index} on site ${project}`, submittalType: (["MATERIAL_SUBMITTAL", "SHOP_DRAWING", "METHOD_STATEMENT"] as const)[index % 3], status: (["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REVISION_REQUIRED"] as const)[index % 4], contractorId: contractorOf(index), assignedReviewerMemberId: architect, dueAt: day((index % 20) - 5), createdByMemberId: engineer }));
      await prisma.technicalSubmittal.createMany({ data: submittals });
      await prisma.technicalSubmittalRevision.createMany({ data: submittals.flatMap((row) => ["A", "B"].map((revisionCode, n) => ({ id: `${row.id}_${revisionCode}`, companyId: COMPANY, submittalId: row.id, revisionCode, revisionNumber: n + 1, documentId: FILE, status: n === 0 ? ("FINALIZED" as const) : ("SUBMITTED" as const), reviewDecision: n === 0 ? ("REVISION_REQUIRED" as const) : null, reviewComment: n === 0 ? "Resubmit with the test data." : null, submittedAt: day(-20 + n * 10), submittedByMemberId: engineer, createdByMemberId: engineer }))) });

      const documents = Array.from({ length: DOCUMENTS }, (_, index) => ({ id: `${PREFIX}_doc_${project}_${index}`, companyId: COMPANY, projectId, documentNumber: `STR-GA-${String(index + 1).padStart(4, "0")}`, title: `Perf drawing ${index} on site ${project}`, documentType: (["DRAWING", "SHOP_DRAWING", "CALCULATION", "SPECIFICATION"] as const)[index % 4], discipline: "STRUCTURAL" as const, status: (["APPROVED", "SUBMITTED", "UNDER_REVIEW", "DRAFT"] as const)[index % 4], contractorId: contractorOf(index), reviewerMemberId: architect, reviewDueAt: day((index % 20) - 5), createdByMemberId: engineer }));
      await prisma.engineeringDocument.createMany({ data: documents });
      await insert(
        documents.flatMap((row) => ["A", "B", "C"].map((revisionCode, n) => ({ id: `${row.id}_${revisionCode}`, companyId: COMPANY, engineeringDocumentId: row.id, revisionCode, revisionNumber: n + 1, documentId: FILE, status: n < 2 ? ("SUPERSEDED" as const) : ("FINALIZED" as const), submittedAt: day(-30 + n * 10), submittedByMemberId: engineer, createdByMemberId: engineer }))),
        (data) => prisma.engineeringDocumentRevision.createMany({ data }),
      );
    }

    // Current revisions, as submitting sets them.
    await prisma.$executeRaw`UPDATE technical_submittals SET "currentRevisionId" = id || '_B' WHERE id LIKE ${`${PREFIX}_sub_%`}`;
    await prisma.$executeRaw`UPDATE engineering_documents SET "currentRevisionId" = id || '_C' WHERE id LIKE ${`${PREFIX}_doc_%`}`;
  }, 1_800_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    await prisma.$disconnect();
  }, 1_800_000);

  it("meets the directory, register and detail targets", async () => {
    const [owner, pm, engineer] = await Promise.all([loginAs("OWNER"), loginAs("PROJECT_MANAGER"), loginAs("ENGINEER")]);
    const project = `${PREFIX}_project_7`;
    // The timings mean something only if the reads see the seeded volume.
    expect((await listContractors(owner, contractorListSchema.parse({}))).total).toBeGreaterThanOrEqual(CONTRACTORS);
    expect((await listRfis(engineer, rfiListSchema.parse({ projectId: project }))).total).toBe(RFIS);
    expect((await getSubmittal(engineer, `${PREFIX}_sub_7_10`)).revisions).toHaveLength(2);
    const report: Record<string, { p50: number; p95: number }> = {};
    const record = (name: string, timings: number[]) => {
      report[name] = { p50: Math.round(percentile(timings, 50)), p95: Math.round(percentile(timings, 95)) };
      return timings;
    };

    const contractors = record("contractor list", [
      ...(await time(() => listContractors(owner, contractorListSchema.parse({})))),
      ...(await time(() => listContractors(pm, contractorListSchema.parse({ q: "contractor 12", page: 1 })))),
      ...(await time(() => listContractors(owner, contractorListSchema.parse({ status: "ACTIVE", page: 20 })))),
    ]);
    const registers = record("project register", [
      ...(await time(() => listRfis(engineer, rfiListSchema.parse({ projectId: project })))),
      ...(await time(() => listRfis(pm, rfiListSchema.parse({ projectId: project, open: "1", page: 3 })))),
      ...(await time(() => listSubmittals(engineer, submittalListSchema.parse({ projectId: project })))),
      ...(await time(() => listEngineeringDocuments(engineer, engineeringDocumentListSchema.parse({ projectId: project, drawings: "1" })))),
      ...(await time(() => listRfis(owner, rfiListSchema.parse({ overdue: "1" })))),
    ]);
    const rfiDetail = record("RFI detail", await time(() => getRfi(engineer, `${PREFIX}_rfi_7_10`)));
    const submittalDetail = record("submittal detail", await time(() => getSubmittal(engineer, `${PREFIX}_sub_7_10`)));

    if (process.env.NESTO_PERF_REPORT) (await import("node:fs")).writeFileSync(process.env.NESTO_PERF_REPORT, JSON.stringify(report, null, 2));
    console.table(report);
    expect(percentile(contractors, 95)).toBeLessThan(800);
    expect(percentile(registers, 95)).toBeLessThan(1_200);
    expect(percentile(rfiDetail, 95)).toBeLessThan(800);
    expect(percentile(submittalDetail, 95)).toBeLessThan(1_000);
  }, 1_800_000);
});
