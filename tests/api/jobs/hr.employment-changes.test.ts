import { afterAll, describe, expect, it } from "vitest";

import { addDays, dayOf, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { prisma } from "../../helpers";
import { snapshotEmployments } from "../hr/employment-fixture";
import { COMPANY_A, invokeJob, withCompanyStatus, withModule } from "./job-harness";

/**
 * Job `hr.employment-changes` (E-03 §153-§157, §208-§210, §226; PRD #51
 * §173-§181): a scheduled employment change whose day has come applies once,
 * dated its own effective date, as the system — however often the job runs;
 * one that can no longer apply is marked failed with why and never retried;
 * each company is run on its own, and a suspended company or one with HR
 * switched off waits and then catches up.
 */

const JOB = "hr.employment-changes";
/** Another company of the demo group, with its own employments. */
const COMPANY_B = "company_demo_b";
const SALES_A = "employee_emp_011";
const PM_B = "employee_b_emp_002";

async function due(employmentId: string, companyId: string, payload: Record<string, unknown>, daysAgo = 2): Promise<string> {
  const effectiveDate = addDays(todayDay(), -daysAgo);
  const change = await prisma.employmentChange.create({
    data: {
      companyId,
      employeeProfileId: employmentId,
      type: payload.action === "LOCATION" ? "LOCATION_CHANGE" : payload.action === "MANAGER" ? "MANAGER_CHANGE" : "EMPLOYMENT_TYPE_CHANGE",
      effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`),
      payload: { effectiveDate, ...payload },
      requestedByUserId: "user_hr",
    },
    select: { id: true },
  });
  return change.id;
}

const statusOf = async (id: string) => (await prisma.employmentChange.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

afterAll(async () => {
  await prisma.$disconnect();
});

describe("hr.employment-changes", () => {
  describe("idempotency", () => {
    it("applies a due change once, dated its own day, and audits it as the system", async () => {
      const restore = await snapshotEmployments([SALES_A]);
      try {
        const id = await due(SALES_A, COMPANY_A, { action: "LOCATION", workLocationType: "HYBRID", workLocation: "Durrës" });
        const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
        const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

        expect(await statusOf(id)).toBe("APPLIED");
        expect((first.detail as { applied: number }).applied).toBeGreaterThanOrEqual(1);
        expect(second.detail).toMatchObject({ applied: 0 });
        const rows = await prisma.employmentAssignment.findMany({ where: { employeeProfileId: SALES_A, supersededAt: null, workLocation: "Durrës" } });
        expect(rows).toHaveLength(1);
        expect({ start: dayOf(rows[0]!.startDate), source: rows[0]!.source }).toEqual({ start: addDays(todayDay(), -2), source: "SCHEDULED" });
        const audit = await prisma.auditEvent.findMany({ where: { entityId: SALES_A, actionKey: "HR_EMPLOYMENT_CHANGE_APPLIED" } });
        expect(audit.filter((row) => JSON.stringify(row).includes(id))).toHaveLength(1);
        expect(audit[0]).toMatchObject({ companyId: COMPANY_A, actorType: "SYSTEM" });
      } finally {
        await restore();
      }
    });
  });

  describe("failure", () => {
    it("marks a change that can no longer apply as failed, with why, and does not retry it", async () => {
      const restore = await snapshotEmployments([SALES_A]);
      try {
        const id = await due(SALES_A, COMPANY_A, { action: "MANAGER", managerMemberId: "member_that_does_not_exist" });
        await invokeJob(JOB, { companyIds: [COMPANY_A] });
        const row = await prisma.employmentChange.findUniqueOrThrow({ where: { id }, select: { status: true, failureReason: true } });
        expect(row.status).toBe("FAILED");
        expect(row.failureReason).toMatch(/manager/i);

        await invokeJob(JOB, { companyIds: [COMPANY_A] });
        expect(await statusOf(id)).toBe("FAILED");
        expect(await prisma.auditEvent.count({ where: { entityId: SALES_A, actionKey: "HR_EMPLOYMENT_CHANGE_FAILED" } })).toBeGreaterThanOrEqual(1);
      } finally {
        await restore();
      }
    });
  });

  describe("company isolation", () => {
    it("applies only the companies it is run for", async () => {
      const restore = await snapshotEmployments([SALES_A, PM_B]);
      try {
        const a = await due(SALES_A, COMPANY_A, { action: "EMPLOYMENT_TYPE", employmentType: "PART_TIME" });
        const b = await due(PM_B, COMPANY_B, { action: "EMPLOYMENT_TYPE", employmentType: "PART_TIME" });

        await invokeJob(JOB, { companyIds: [COMPANY_A] });
        expect(await statusOf(a)).toBe("APPLIED");
        expect(await statusOf(b)).toBe("SCHEDULED");

        await invokeJob(JOB, { companyIds: [COMPANY_B] });
        expect(await statusOf(b)).toBe("APPLIED");
      } finally {
        await restore();
      }
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company and one with HR switched off, then catches up", async () => {
      const restore = await snapshotEmployments([PM_B]);
      try {
        const b = await due(PM_B, COMPANY_B, { action: "LOCATION", workLocationType: "SITE", workLocation: "Central Office Tower" }, 5);

        await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
        expect(await statusOf(b)).toBe("SCHEDULED");
        await withModule(COMPANY_B, "hr", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
        expect(await statusOf(b)).toBe("SCHEDULED");

        await invokeJob(JOB, { companyIds: [COMPANY_B] });
        expect(await statusOf(b)).toBe("APPLIED");
        // Caught up, it is still dated its own day (E-03 §156).
        const row = await prisma.employmentAssignment.findFirstOrThrow({ where: { employeeProfileId: PM_B, supersededAt: null, workLocation: "Central Office Tower" } });
        expect(dayOf(row.startDate)).toBe(addDays(todayDay(), -5));
      } finally {
        await restore();
      }
    });
  });
});
