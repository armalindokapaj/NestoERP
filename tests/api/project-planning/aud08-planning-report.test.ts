import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { planningReport } from "@/lib/modules/project-planning/planning.reports";
import { reportQuerySchema } from "@/lib/modules/project-planning/planning.schema";
import { cleanupSessions, loginAsMembership, prisma } from "../../helpers";

/**
 * The cross-project milestone report (/projects/milestones) (AUD-08 §4, DT-04, DT-05).
 *
 * - Top-N lists (overdue 50, variance 100, critical 100) carry the size they were
 *   cut from (`listTotals`), so the page labels "Showing the top 50 of 55".
 * - Ties sort by milestone id, not by whatever order the rows were read in.
 * - `truncated` is false under ROW_LIMIT; a foreign project finds nothing.
 *
 * Fixture: 55 open critical milestones on the fixture company's project_f
 * (which has none of its own), forecast 2020-01-01 + i days with baseline
 * 2019-12-01, except that #011 shares #010's date. sortOrder runs backwards so
 * read order is the reverse of id order. Removed in afterAll.
 */

const OWNER = "member_fixture_owner";
const COMPANY = "company_fixture";
const PROJECT_F = "project_f";
const PREFIX = "aud08m_ms_";
const COUNT = 55;
const id = (index: number) => `${PREFIX}${String(index).padStart(3, "0")}`;
const day = (offset: number) => new Date(Date.UTC(2020, 0, 1 + offset, 12));

let owner: UserContext;

beforeAll(async () => {
  owner = await loginAsMembership(OWNER);
  expect(await prisma.projectMilestone.count({ where: { projectId: PROJECT_F, archivedAt: null } })).toBe(0);
  await prisma.projectMilestone.createMany({
    data: Array.from({ length: COUNT }, (_, index) => ({
      id: id(index),
      companyId: COMPANY,
      projectId: PROJECT_F,
      name: `aud08m milestone ${index}`,
      status: "NOT_STARTED" as const,
      critical: true,
      baselineDate: new Date(Date.UTC(2019, 11, 1, 12)),
      forecastDate: day(index === 11 ? 10 : index),
      sortOrder: 1000 - index,
      createdByMemberId: OWNER,
    })),
  });
});

afterAll(async () => {
  await prisma.projectMilestone.deleteMany({ where: { companyId: COMPANY, id: { startsWith: PREFIX } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("planning report lists are labelled and totally ordered (AUD-08 §4)", () => {
  it("cuts overdue at 50 of 55 in overdue order with id tie-breaks, and says how many there were", async () => {
    const report = await planningReport(owner, reportQuerySchema.parse({ projectId: PROJECT_F }));
    expect(report.truncated).toBe(false);
    expect(report.totals.total).toBe(COUNT);
    expect(report.listTotals).toEqual({ overdue: COUNT, variance: COUNT, critical: COUNT });

    // Most overdue first = earliest forecast first; #010 and #011 tie on the date and go by id.
    const expectedOverdue = Array.from({ length: 50 }, (_, index) => id(index));
    expect(report.overdue.map((row) => row.id)).toEqual(expectedOverdue);

    // Largest slip first = latest forecast first; the tied pair again by id.
    const expectedVariance = [...Array.from({ length: COUNT }, (_, index) => index).filter((index) => index > 11).reverse(), 10, 11, ...Array.from({ length: 10 }, (_, index) => 9 - index)].map(id);
    expect(report.variance.map((row) => row.id)).toEqual(expectedVariance);
    expect(report.critical).toHaveLength(COUNT);
  });

  it("a project outside the reader's scope finds nothing (DT-22), beside the positive control above", async () => {
    const report = await planningReport(owner, reportQuerySchema.parse({ projectId: "project_a" }));
    expect(report.totals.total).toBe(0);
    expect(report.overdue).toEqual([]);
    expect(report.listTotals).toEqual({ overdue: 0, variance: 0, critical: 0 });
    expect(report.projects.map((project) => project.id)).not.toContain("project_a");
  });
});
