import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import * as activity from "@/lib/modules/hse/hse.activity";
import { hazardListSchema, incidentListSchema, inspectionListSchema } from "@/lib/modules/hse/hse.schema";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import { runReport } from "@/lib/modules/hse/reports/reports.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * AUD-08 — the HSE registers' query contract (§3, §4; DT-02..DT-06, DT-22).
 *
 * Real Postgres, the real services and schemas, the seeded Owner (company-wide
 * HSE scope). Every expected id list is written out by hand from the fixture
 * table below — never read back from the list under test (PRD §9). The
 * fixtures tie on risk score, due date, observed-at and updated-at so only the
 * id can order them; two have no due date; hazard numbers carry leading zeros
 * and run opposite to the ids; one hazard sits in another company.
 *
 * Hazards (title prefix `aud08h-HZ`, every `observedAt` 2026-01-01, every
 * `updatedAt` 2026-01-01):
 *
 * | id | number        | risk          | status    | due        | project | assigned |
 * |----|---------------|---------------|-----------|------------|---------|----------|
 * | h1 | AUD08H-HZ-06  | HIGH 12       | OPEN      | 2099-10-01 | A       | Owner    |
 * | h2 | AUD08H-HZ-05  | HIGH 12       | OPEN      | 2020-06-01 | A       |          |
 * | h3 | AUD08H-HZ-04  | CRITICAL 20   | OPEN      | 2099-10-01 | —       |          |
 * | h4 | AUD08H-HZ-03  | LOW 4         | CLOSED    | 2020-01-01 | A       |          |
 * | h5 | AUD08H-HZ-02  | HIGH 12       | CANCELLED | —          | —       |          |
 * | h6 | AUD08H-HZ-01  | MEDIUM 6      | OPEN      | —          | —       |          |
 * | hb | AUD08H-HZ-99  | CRITICAL 25   | OPEN      | —          | —       | company B|
 *
 * Incidents (`aud08h-IN`, company A): i1 HIGH, i2 HIGH, i3 CRITICAL NEAR_MISS,
 * i4 LOW — i1/i2/i4 occurred 2026-02-01 (a tie), i3 2026-03-01.
 */

const TAG = "aud08h-HZ";
const IN_TAG = "aud08h-IN";
const hz = (key: string) => `aud08h_hz_${key}`;
const inc = (key: string) => `aud08h_in_${key}`;
const H = { h1: hz("h1"), h2: hz("h2"), h3: hz("h3"), h4: hz("h4"), h5: hz("h5"), h6: hz("h6"), hb: hz("hb") };
const I = { i1: inc("i1"), i2: inc("i2"), i3: inc("i3"), i4: inc("i4") };
const INSPECTION = "aud08h_ins_1";
const ACTIVITY = ["aud08h_act_1", "aud08h_act_2", "aud08h_act_3"];

let owner: UserContext;

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
const hazardList = (params: Record<string, unknown>) =>
  hazards.listHazards(owner, hazardListSchema.parse({ search: TAG, ...params }));

/** Every page of a sort, walked with a small limit: the concatenation is the list's order. */
async function walkHazards(sort: string, limit = 2) {
  const seen: string[] = [];
  const totals = new Set<number>();
  for (let page = 1; page < 20; page += 1) {
    const result = await hazardList({ sort, limit, page });
    totals.add(result.pagination.total);
    seen.push(...ids(result.data));
    if (page >= result.pagination.totalPages) break;
  }
  return { seen, totals: [...totals] };
}

async function cleanup() {
  await prisma.activity.deleteMany({ where: { id: { in: ACTIVITY } } });
  await prisma.hseInspectionChecklistItem.deleteMany({ where: { inspectionId: INSPECTION } });
  await prisma.hseInspection.deleteMany({ where: { id: INSPECTION } });
  await prisma.hseHazard.deleteMany({ where: { id: { in: Object.values(H) } } });
  await prisma.hseIncident.deleteMany({ where: { id: { in: Object.values(I) } } });
}

beforeAll(async () => {
  await cleanup();
  owner = await loginAs("OWNER");
  const ownerA = owner.membershipId;
  const ownerB = (
    await prisma.companyMember.findFirstOrThrow({
      where: { companyId: COMPANY.b, user: { email: "owner@nesto.test" } },
      select: { id: true },
    })
  ).id;
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

  const hazard = (
    id: string,
    number: string,
    title: string,
    risk: { level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; score: number },
    extra: Record<string, unknown>,
    companyId: string = COMPANY.a,
    member = ownerA,
  ) =>
    prisma.hseHazard.create({
      data: {
        id,
        companyId,
        hazardNumber: number,
        title: `${TAG} ${title}`,
        description: "AUD-08 fixture",
        hazardCategory: "OTHER",
        likelihood: 1,
        severityScore: 1,
        riskScore: risk.score,
        riskLevel: risk.level,
        observedAt: day("2026-01-01"),
        reportedByMemberId: member,
        createdByMemberId: member,
        ...extra,
      },
    });

  await hazard(H.h1, "AUD08H-HZ-06", "Alpha", { level: "HIGH", score: 12 }, { status: "OPEN", dueDate: day("2099-10-01"), projectId: PROJECT.a, assignedToMemberId: ownerA });
  await hazard(H.h2, "AUD08H-HZ-05", "Alpha", { level: "HIGH", score: 12 }, { status: "OPEN", dueDate: day("2020-06-01"), projectId: PROJECT.a });
  await hazard(H.h3, "AUD08H-HZ-04", "Bravo", { level: "CRITICAL", score: 20 }, { status: "OPEN", dueDate: day("2099-10-01") });
  await hazard(H.h4, "AUD08H-HZ-03", "Charlie", { level: "LOW", score: 4 }, { status: "CLOSED", dueDate: day("2020-01-01"), projectId: PROJECT.a });
  await hazard(H.h5, "AUD08H-HZ-02", "Delta", { level: "HIGH", score: 12 }, { status: "CANCELLED" });
  await hazard(H.h6, "AUD08H-HZ-01", "Echo", { level: "MEDIUM", score: 6 }, { status: "OPEN" });
  await hazard(H.hb, "AUD08H-HZ-99", "Foreign", { level: "CRITICAL", score: 25 }, { status: "OPEN" }, COMPANY.b, ownerB);

  const incident = (id: string, number: string, severity: "LOW" | "HIGH" | "CRITICAL", occurred: string, type: "INCIDENT" | "NEAR_MISS" = "INCIDENT") =>
    prisma.hseIncident.create({
      data: {
        id,
        companyId: COMPANY.a,
        incidentNumber: number,
        incidentType: type,
        title: `${IN_TAG} ${number}`,
        description: "AUD-08 fixture",
        occurredAt: day(occurred),
        severity,
        reportedByMemberId: ownerA,
        createdByMemberId: ownerA,
      },
    });
  await incident(I.i1, "AUD08H-IN-04", "HIGH", "2026-02-01");
  await incident(I.i2, "AUD08H-IN-03", "HIGH", "2026-02-01");
  await incident(I.i3, "AUD08H-IN-02", "CRITICAL", "2026-03-01", "NEAR_MISS");
  await incident(I.i4, "AUD08H-IN-01", "LOW", "2026-02-01");

  // An inspection on project A with two failed items and one pass.
  await prisma.hseInspection.create({
    data: {
      id: INSPECTION,
      companyId: COMPANY.a,
      inspectionNumber: "AUD08H-INS-01",
      inspectionType: "GENERAL",
      projectId: PROJECT.a,
      assignedInspectorMemberId: ownerA,
      createdByMemberId: ownerA,
      locationText: "aud08h-INS",
      checklistItems: {
        create: [
          { label: "One", responseType: "PASS_FAIL", result: "FAIL", sortOrder: 1 },
          { label: "Two", responseType: "PASS_FAIL", result: "FAIL", sortOrder: 2 },
          { label: "Three", responseType: "PASS_FAIL", result: "PASS", sortOrder: 3 },
        ],
      },
    },
  });

  // Three activity entries on h1 at one instant: only the id can order them.
  const at = new Date("2026-01-02T10:00:00.000Z");
  for (const id of ACTIVITY) {
    await prisma.activity.create({
      data: { id, companyId: COMPANY.a, module: "hse", entityType: "HseHazard", entityId: H.h1, action: "aud08h.fixture", createdAt: at },
    });
  }

  await prisma.$executeRaw`UPDATE hse_hazards SET "updatedAt" = '2026-01-01 00:00:00' WHERE id = ANY(${Object.values(H)})`;
  await prisma.$executeRaw`UPDATE hse_incidents SET "updatedAt" = '2026-01-01 00:00:00' WHERE id = ANY(${Object.values(I)})`;
}, 60_000);

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("DT-04 — hazard sorts are total orders, identical across every page", () => {
  // Six company-A hazards match the tag; hb (company B) never appears.
  it.each([
    // updatedAt ties everywhere: the id decides.
    ["recent", [H.h1, H.h2, H.h3, H.h4, H.h5, H.h6]],
    // Score desc, observedAt tie, then id: 20, 12 12 12, 6, 4.
    ["risk-desc", [H.h3, H.h1, H.h2, H.h5, H.h6, H.h4]],
    // Due soonest, nulls last; the 2099 tie falls to the id.
    ["due-asc", [H.h4, H.h2, H.h1, H.h3, H.h5, H.h6]],
    // Leading-zero numbers compared as text, opposite to the ids.
    ["number-asc", [H.h6, H.h5, H.h4, H.h3, H.h2, H.h1]],
  ])("%s walks every page in the expected order with one total", async (sort, expected) => {
    const { seen, totals } = await walkHazards(sort as string);
    expect(seen).toEqual(expected);
    expect(totals).toEqual([6]);
  });

  it("incident severity ties fall to occurrence then id; the export order is the list order", async () => {
    const pageOf = (page: number) =>
      incidents.listIncidents(owner, incidentListSchema.parse({ search: IN_TAG, sort: "severity-desc", limit: 3, page }));
    const [first, second] = [await pageOf(1), await pageOf(2)];
    expect([...ids(first.data), ...ids(second.data)]).toEqual([I.i3, I.i1, I.i2, I.i4]);
    expect(first.pagination.total).toBe(4);
    expect(incidents.incidentListOrder("severity-desc").at(-1)).toEqual({ id: "asc" });
  });

  it("activity at one instant keeps one order across pages", async () => {
    const first = await activity.listRecordActivity(owner, "HseHazard", H.h1, { page: 1, limit: 2 });
    const second = await activity.listRecordActivity(owner, "HseHazard", H.h1, { page: 2, limit: 2 });
    const fixture = [...ids(first.data), ...ids(second.data)].filter((id) => ACTIVITY.includes(id));
    expect(fixture).toEqual(ACTIVITY);
  });
});

describe("DT-03 — filters OR within, AND across; counted before pagination", () => {
  it("status (OPEN or CLOSED) and risk (HIGH or LOW)", async () => {
    const first = await hazardList({ status: ["OPEN", "CLOSED"], riskLevel: ["HIGH", "LOW"], limit: 2 });
    expect(ids(first.data)).toEqual([H.h1, H.h2]);
    expect(first.pagination.total).toBe(3);
    const second = await hazardList({ status: ["OPEN", "CLOSED"], riskLevel: ["HIGH", "LOW"], limit: 2, page: 2 });
    expect(ids(second.data)).toEqual([H.h4]);
  });

  it("search narrows within the filters", async () => {
    const result = await hazards.listHazards(owner, hazardListSchema.parse({ search: `${TAG} Alpha`, status: ["OPEN"] }));
    expect(ids(result.data)).toEqual([H.h1, H.h2]);
    expect(result.pagination.total).toBe(2);
  });

  it("the page shows its inspections' real failed-item counts", async () => {
    const result = await inspections.listInspections(owner, inspectionListSchema.parse({ search: "aud08h-INS" }));
    expect(result.data.map((row) => [row.id, row.failedItemCount])).toEqual([[INSPECTION, 2]]);
  });
});

describe("DT-02 — the section (view) is part of the query and its where-builder", () => {
  it.each([
    ["open", [H.h1, H.h2, H.h3, H.h6]],
    ["critical", [H.h3]],
    // Open and due before today: only h2 (h4 is closed, h1/h3 are 2099).
    ["overdue", [H.h2]],
    ["mine", [H.h1]],
  ])("view=%s", async (view, expected) => {
    const result = await hazardList({ view, limit: 100 });
    expect(ids(result.data)).toEqual(expected);
    expect(result.pagination.total).toBe((expected as string[]).length);
  });

  it("the exported where-builder carries the section, so an export cannot drop it", async () => {
    const where = hazards.buildHazardListWhere(owner, hazardListSchema.parse({ search: TAG, view: "critical" }));
    const rows = await prisma.hseHazard.findMany({ where, select: { id: true }, orderBy: { id: "asc" } });
    expect(ids(rows)).toEqual([H.h3]);
  });
});

describe("DT-05 — page windows", () => {
  it("a page past the end is clamped to the last page, which the page redirects to", async () => {
    const result = await hazardList({ limit: 2, page: 99 });
    expect(result.pagination).toMatchObject({ page: 3, totalPages: 3, total: 6 });
  });

  it("zero results is page 1 of 1 with a 0 total; one page still counts", async () => {
    const none = await hazards.listHazards(owner, hazardListSchema.parse({ search: "aud08h-nothing-matches", page: 4 }));
    expect(none.pagination).toMatchObject({ page: 1, totalPages: 1, total: 0 });
    const one = await hazardList({ limit: 25 });
    expect(one.pagination).toMatchObject({ page: 1, totalPages: 1, total: 6 });
  });
});

describe("DT-22 — a foreign project id narrows to nothing, never to everything", () => {
  it("another company's project matches no hazard; project A is the positive control", async () => {
    const foreign = await hazardList({ projectId: PROJECT.companyB, limit: 100 });
    expect(foreign.pagination.total).toBe(0);
    expect(foreign.data).toEqual([]);
    const own = await hazardList({ projectId: PROJECT.a, limit: 100 });
    expect(ids(own.data)).toEqual([H.h1, H.h2, H.h4]);
  });

  it("a company-B hazard is not in company A's register under any sort", async () => {
    const { seen } = await walkHazards("risk-desc", 100);
    expect(seen).not.toContain(H.hb);
  });
});

describe("DT-01 — a project tab's preview states the true total", () => {
  it("hazards on project A: the preview holds `limit` rows and the whole count", async () => {
    const expected = await prisma.hseHazard.count({ where: { companyId: COMPANY.a, projectId: PROJECT.a } });
    const preview = await hazards.listForProject(owner, PROJECT.a, 2);
    expect(preview.total).toBe(expected);
    expect(preview.data).toHaveLength(Math.min(2, expected));
    expect(expected).toBeGreaterThanOrEqual(3);
  });

  it("an inspection preview carries real failed counts (it used to show 0)", async () => {
    const expected = await prisma.hseInspection.count({ where: { companyId: COMPANY.a, projectId: PROJECT.a } });
    const preview = await inspections.listForProject(owner, PROJECT.a, 500);
    expect(preview.total).toBe(expected);
    expect(preview.data.find((row) => row.id === INSPECTION)?.failedItemCount).toBe(2);
  });

  it("a bounded report register reports its true total beside its rows", async () => {
    const expected = await prisma.hseHazard.count({ where: { companyId: COMPANY.a } });
    const report = await runReport(owner, "hazard-register");
    expect(report.total).toBe(expected);
    expect(report.limit).toBe(500);
    expect(report.rows).toHaveLength(Math.min(500, expected));
  });
});
