import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import * as approvals from "@/lib/modules/qaqc/approvals/approval.service";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import {
  approvalListQuerySchema,
  defectListQuerySchema,
  inspectionListQuerySchema,
  ncrListQuerySchema,
} from "@/lib/modules/qaqc/qaqc.schema";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * AUD-08 — the QA/QC registers' query contract (§3, §4; DT-01..DT-06, DT-22).
 *
 * Real Postgres, the real services and schemas, the seeded Owner (company-wide
 * QA/QC scope) and the seeded Project Manager (project-scoped QA/QC, holds
 * `qaqc.approval.view`). Every expected id list is written out by hand from
 * the fixture table below — never read back from the list under test (PRD §9).
 *
 * Defects (title prefix `aud08h-DF`, project A, one `createdAt`):
 *
 * | id | number       | severity | status      | due        | assigned |
 * |----|--------------|----------|-------------|------------|----------|
 * | d1 | AUD08H-DF-06 | HIGH     | OPEN        | 2099-10-01 | Owner    |
 * | d2 | AUD08H-DF-05 | HIGH     | OPEN        | 2099-10-01 |          |
 * | d3 | AUD08H-DF-04 | CRITICAL | OPEN        | —          |          |
 * | d4 | AUD08H-DF-03 | LOW      | CLOSED      | 2020-01-01 |          |
 * | d5 | AUD08H-DF-02 | HIGH     | IN_PROGRESS | —          |          |
 * | d6 | AUD08H-DF-01 | MEDIUM   | OPEN        | 2020-06-01 |          |
 * | db | AUD08H-DF-99 | CRITICAL | OPEN        | —          | company B|
 *
 * NCRs with a PENDING approval each: n1 has no project (company QA/QC scope
 * only — the Project Manager cannot open it), n2 is on project A.
 *
 * Request r1 with 55 inspections raised from it (more than the 50 the detail
 * page used to stop at).
 */

const TAG = "aud08h-DF";
const df = (key: string) => `aud08h_df_${key}`;
const D = { d1: df("d1"), d2: df("d2"), d3: df("d3"), d4: df("d4"), d5: df("d5"), d6: df("d6"), db: df("db") };
const N = { n1: "aud08h_ncr_n1", n2: "aud08h_ncr_n2" };
const A = { a1: "aud08h_apr_a1", a2: "aud08h_apr_a2" };
const REQUEST = "aud08h_req_r1";
const REQUEST_INSPECTIONS = Array.from({ length: 55 }, (_, index) => `aud08h_qins_${String(index + 1).padStart(2, "0")}`);

let owner: UserContext;
let pm: UserContext;

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
const defectList = (params: Record<string, unknown>) =>
  defects.listDefects(owner, defectListQuerySchema.parse({ search: TAG, ...params }));

async function walkDefects(sort: string, limit = 2) {
  const seen: string[] = [];
  const totals = new Set<number>();
  for (let page = 1; page < 20; page += 1) {
    const result = await defectList({ sort, limit, page });
    totals.add(result.pagination.total);
    seen.push(...ids(result.data));
    if (page >= result.pagination.totalPages) break;
  }
  return { seen, totals: [...totals] };
}

async function cleanup() {
  await prisma.qualityApproval.deleteMany({ where: { id: { in: Object.values(A) } } });
  await prisma.nonConformanceReport.deleteMany({ where: { id: { in: Object.values(N) } } });
  await prisma.qualityDefect.deleteMany({ where: { id: { in: Object.values(D) } } });
  await prisma.qualityInspection.deleteMany({ where: { id: { in: REQUEST_INSPECTIONS } } });
  await prisma.inspectionRequest.deleteMany({ where: { id: REQUEST } });
}

beforeAll(async () => {
  await cleanup();
  owner = await loginAs("OWNER");
  pm = await loginAs("PROJECT_MANAGER");
  const ownerA = owner.membershipId;
  const ownerB = (
    await prisma.companyMember.findFirstOrThrow({
      where: { companyId: COMPANY.b, user: { email: "owner@nesto.test" } },
      select: { id: true },
    })
  ).id;
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

  const defect = (
    id: string,
    number: string,
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    extra: Record<string, unknown>,
    companyId: string = COMPANY.a,
    projectId: string = PROJECT.a,
    member = ownerA,
  ) =>
    prisma.qualityDefect.create({
      data: {
        id,
        companyId,
        defectNumber: number,
        title: `${TAG} ${number}`,
        description: "AUD-08 fixture",
        projectId,
        severity,
        createdByMemberId: member,
        ...extra,
      },
    });

  await defect(D.d1, "AUD08H-DF-06", "HIGH", { status: "OPEN", dueDate: day("2099-10-01"), assignedToMemberId: ownerA });
  await defect(D.d2, "AUD08H-DF-05", "HIGH", { status: "OPEN", dueDate: day("2099-10-01") });
  await defect(D.d3, "AUD08H-DF-04", "CRITICAL", { status: "OPEN" });
  await defect(D.d4, "AUD08H-DF-03", "LOW", { status: "CLOSED", dueDate: day("2020-01-01") });
  await defect(D.d5, "AUD08H-DF-02", "HIGH", { status: "IN_PROGRESS" });
  await defect(D.d6, "AUD08H-DF-01", "MEDIUM", { status: "OPEN", dueDate: day("2020-06-01") });
  await defect(D.db, "AUD08H-DF-99", "CRITICAL", { status: "OPEN" }, COMPANY.b, PROJECT.b, ownerB);
  await prisma.$executeRaw`UPDATE quality_defects SET "createdAt" = '2026-01-01 00:00:00' WHERE id = ANY(${Object.values(D)})`;

  const ncr = (id: string, number: string, projectId: string | null) =>
    prisma.nonConformanceReport.create({
      data: {
        id,
        companyId: COMPANY.a,
        ncrNumber: number,
        title: `aud08h-NCR ${number}`,
        description: "AUD-08 fixture",
        category: "WORKMANSHIP",
        severity: "MEDIUM",
        status: "PENDING_APPROVAL",
        projectId,
        createdByMemberId: ownerA,
      },
    });
  await ncr(N.n1, "AUD08H-NCR-01", null);
  await ncr(N.n2, "AUD08H-NCR-02", PROJECT.a);
  const submitted = new Date("2000-01-01T00:00:00.000Z");
  await prisma.qualityApproval.create({ data: { id: A.a1, companyId: COMPANY.a, recordType: "NCR", recordId: N.n1, submittedByMemberId: ownerA, submittedAt: submitted } });
  await prisma.qualityApproval.create({ data: { id: A.a2, companyId: COMPANY.a, recordType: "NCR", recordId: N.n2, submittedByMemberId: ownerA, submittedAt: submitted } });

  await prisma.inspectionRequest.create({
    data: {
      id: REQUEST,
      companyId: COMPANY.a,
      requestNumber: "AUD08H-IR-01",
      title: "aud08h-IR",
      inspectionType: "WORK",
      requestedByMemberId: ownerA,
      requestedDate: day("2026-01-01"),
      createdByMemberId: ownerA,
    },
  });
  await prisma.qualityInspection.createMany({
    data: REQUEST_INSPECTIONS.map((id, index) => ({
      id,
      companyId: COMPANY.a,
      inspectionNumber: `AUD08H-QI-${String(index + 1).padStart(2, "0")}`,
      inspectionType: "WORK" as const,
      requestId: REQUEST,
      assignedInspectorMemberId: ownerA,
      createdByMemberId: ownerA,
    })),
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("DT-04 — defect sorts are total orders, identical across every page", () => {
  it.each([
    // createdAt ties everywhere: the id decides.
    ["created-desc", [D.d1, D.d2, D.d3, D.d4, D.d5, D.d6]],
    // Enum order, then due soonest with nulls last, then id.
    ["severity-desc", [D.d3, D.d1, D.d2, D.d5, D.d6, D.d4]],
    // Nulls last; the 2099 tie falls to the id.
    ["due-asc", [D.d4, D.d6, D.d1, D.d2, D.d3, D.d5]],
    // Leading-zero numbers compared as text, opposite to the ids.
    ["number-asc", [D.d6, D.d5, D.d4, D.d3, D.d2, D.d1]],
  ])("%s walks every page in the expected order with one total", async (sort, expected) => {
    const { seen, totals } = await walkDefects(sort as string);
    expect(seen).toEqual(expected);
    expect(totals).toEqual([6]);
  });

  it("every register order ends in the id", () => {
    expect(defects.defectListOrder("severity-desc").at(-1)).toEqual({ id: "asc" });
    expect(ncrs.ncrListOrder("due-asc").at(-1)).toEqual({ id: "asc" });
    expect(actions.correctiveActionListOrder("created-desc").at(-1)).toEqual({ id: "asc" });
    expect(requests.requestListOrder("priority-desc").at(-1)).toEqual({ id: "asc" });
    expect(inspections.inspectionListOrder("date-desc").at(-1)).toEqual({ id: "asc" });
  });
});

describe("DT-03 — filters OR within, AND across; counted before pagination", () => {
  it("status (OPEN or CLOSED) and severity (HIGH or LOW)", async () => {
    const first = await defectList({ status: ["OPEN", "CLOSED"], severity: ["HIGH", "LOW"], limit: 2 });
    expect(ids(first.data)).toEqual([D.d1, D.d2]);
    expect(first.pagination.total).toBe(3);
    const second = await defectList({ status: ["OPEN", "CLOSED"], severity: ["HIGH", "LOW"], limit: 2, page: 2 });
    expect(ids(second.data)).toEqual([D.d4]);
  });
});

describe("DT-02 — the section (view) is part of the query and its where-builder", () => {
  it.each([
    ["open", [D.d1, D.d2, D.d3, D.d5, D.d6]],
    // Open and due before today: d6 (d4 is closed).
    ["overdue", [D.d6]],
    ["mine", [D.d1]],
  ])("view=%s", async (view, expected) => {
    const result = await defectList({ view, limit: 100 });
    expect(ids(result.data)).toEqual(expected);
    expect(result.pagination.total).toBe((expected as string[]).length);
  });

  it("the exported where-builder carries the section", async () => {
    const where = defects.buildDefectListWhere(owner, defectListQuerySchema.parse({ search: TAG, view: "overdue" }));
    const rows = await prisma.qualityDefect.findMany({ where, select: { id: true } });
    expect(ids(rows)).toEqual([D.d6]);
  });
});

describe("DT-05 — page windows", () => {
  it("a page past the end is clamped to the last page; an empty list is page 1 of 1", async () => {
    const past = await defectList({ limit: 4, page: 9 });
    expect(past.pagination).toMatchObject({ page: 2, totalPages: 2, total: 6 });
    const none = await defects.listDefects(owner, defectListQuerySchema.parse({ search: "aud08h-nothing", page: 3 }));
    expect(none.pagination).toMatchObject({ page: 1, totalPages: 1, total: 0 });
  });
});

describe("DT-22 — foreign ids narrow to nothing", () => {
  it("another company's project matches no defect; project A is the positive control", async () => {
    expect((await defectList({ projectId: PROJECT.companyB, limit: 100 })).pagination.total).toBe(0);
    expect((await defectList({ projectId: PROJECT.b, limit: 100 })).pagination.total).toBe(0);
    expect(ids((await defectList({ projectId: PROJECT.a, limit: 100 })).data)).toEqual([
      D.d1,
      D.d2,
      D.d3,
      D.d4,
      D.d5,
      D.d6,
    ]);
  });
});

describe("DT-03/DT-22 — the approval queue counts only records the reader can open", () => {
  const queue = (context: UserContext) =>
    approvals.listApprovals(context, approvalListQuerySchema.parse({ view: "pending", recordType: "NCR", limit: 100 }));

  it("the Project Manager sees the project-A NCR's approval and neither sees nor counts the company-only one", async () => {
    // Preconditions, from the NCR register itself: n2 is reachable, n1 is not.
    const reachable = ids((await ncrs.listNcrs(pm, ncrListQuerySchema.parse({ search: "aud08h-NCR", limit: 100 }))).data);
    expect(reachable).toEqual([N.n2]);

    const result = await queue(pm);
    const shown = result.data.map((row) => row.id);
    expect(shown).toContain(A.a2);
    expect(shown).not.toContain(A.a1);
    // The total is the rows the reader can open — before, it counted a1 too.
    expect(result.pagination.total).toBe(result.data.length);
  });

  it("the Owner (company scope) is the positive control: both approvals, oldest first", async () => {
    const result = await queue(owner);
    const shown = result.data.map((row) => row.id);
    expect(shown.slice(0, 2)).toEqual([A.a1, A.a2]);
    expect(result.pagination.total).toBe(result.data.length);
  });
});

describe("DT-01 — record and project previews never stop silently", () => {
  it("a request's detail lists every inspection raised from it, not the first 50", async () => {
    const request = await requests.getRequest(owner, REQUEST);
    expect(ids(request.inspections).sort()).toEqual([...REQUEST_INSPECTIONS].sort());
  });

  it("the project tab's defect preview states the true total", async () => {
    const expected = await prisma.qualityDefect.count({ where: { companyId: COMPANY.a, projectId: PROJECT.a } });
    const preview = await defects.listForProject(owner, PROJECT.a, 3);
    expect(preview.total).toBe(expected);
    expect(preview.data).toHaveLength(Math.min(3, expected));
    expect(expected).toBeGreaterThanOrEqual(6);
  });

  it("the reinspections section is a query value, applied by the where-builder", async () => {
    const where = inspections.buildInspectionListWhere(
      owner,
      inspectionListQuerySchema.parse({ view: "reinspections", search: "AUD08H-QI" }),
    );
    // None of the request's inspections re-inspects another one.
    expect(await prisma.qualityInspection.count({ where })).toBe(0);
    const all = inspections.buildInspectionListWhere(owner, inspectionListQuerySchema.parse({ search: "AUD08H-QI" }));
    expect(await prisma.qualityInspection.count({ where: all })).toBe(55);
  });
});
