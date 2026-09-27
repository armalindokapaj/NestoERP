import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import { parseAttendanceQuery, parseLeaveQuery } from "@/lib/modules/hr/hr.query";
import { listCandidates } from "@/lib/modules/hr/recruitment/candidate.service";
import { candidateListQuerySchema } from "@/lib/modules/hr/recruitment/candidate.schema";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, prisma } from "../../helpers";

/**
 * AUD-08 on the HR lists (DT-02, DT-03, DT-04, DT-05, DT-22).
 *
 * The employee Attendance tab used to list every record in the reader's scope:
 * the parser wrote the employee filter to a field the schema dropped. The
 * fixtures are January 2031 days — a month no seeded record uses — so each
 * expected id is one this file wrote.
 */

const PREFIX = "aud08c2_att";
const EMP = { a5: "employee_emp_005", a6: "employee_emp_006", b1: "employee_b_emp_001" };
const at = (day: string) => new Date(`${day}T00:00:00.000Z`);

const R = {
  a5First: `${PREFIX}_01`, // emp 005, 2031-01-05
  a5Second: `${PREFIX}_02`, // emp 005, 2031-01-06
  a5Third: `${PREFIX}_03`, // emp 005, 2031-01-07
  a6First: `${PREFIX}_04`, // emp 006, 2031-01-05 (ties a5First on date)
  a6Second: `${PREFIX}_05`, // emp 006, 2031-01-08
  b1: `${PREFIX}_06`, // company B, 2031-01-05
};

beforeAll(async () => {
  await prisma.attendanceRecord.deleteMany({ where: { id: { startsWith: PREFIX } } });
  const row = (id: string, employeeProfileId: string, day: string, companyId: string = COMPANY.a) => ({
    id,
    companyId,
    employeeProfileId,
    date: at(day),
    status: "PRESENT" as const,
    createdByMemberId: companyId === COMPANY.a ? "member_hr" : "member_hr__b",
  });
  await prisma.attendanceRecord.createMany({
    data: [
      row(R.a5First, EMP.a5, "2031-01-05"),
      row(R.a5Second, EMP.a5, "2031-01-06"),
      row(R.a5Third, EMP.a5, "2031-01-07"),
      row(R.a6First, EMP.a6, "2031-01-05"),
      row(R.a6Second, EMP.a6, "2031-01-08"),
      row(R.b1, EMP.b1, "2031-01-05", COMPANY.b),
    ],
  });
});

afterAll(async () => {
  await prisma.attendanceRecord.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

const JANUARY = { from: "2031-01-01", to: "2031-01-31" };

describe("attendance (AUD-08 §3, §4)", () => {
  it("DT-02: an employee's tab lists that employee's days only, counted before pagination", async () => {
    const hr = await loginAs("HR");
    const result = await attendance.listAttendance(hr, parseAttendanceQuery({ ...JANUARY, employeeId: EMP.a5, limit: "2" }));
    expect(result.pagination.total).toBe(3);
    expect(result.data.map((row) => row.id)).toEqual([R.a5Third, R.a5Second]);
  });

  it("DT-04: newest first; a shared date is broken by id, the same across pages", async () => {
    const hr = await loginAs("HR");
    const read = (page: number) => attendance.listAttendance(hr, parseAttendanceQuery({ ...JANUARY, limit: "2", page: String(page) }));
    const order = [(await read(1)).data, (await read(2)).data, (await read(3)).data].flat().map((row) => row.id);
    expect(order).toEqual([R.a6Second, R.a5Third, R.a5Second, R.a5First, R.a6First]);
  });

  it("DT-05: a page past the end reads the last page", async () => {
    const hr = await loginAs("HR");
    const past = await attendance.listAttendance(hr, parseAttendanceQuery({ ...JANUARY, limit: "2", page: "8" }));
    expect(past.pagination).toMatchObject({ page: 3, totalPages: 3, total: 5 });
    expect(past.data.map((row) => row.id)).toEqual([R.a6First]);
  });

  it("DT-22: another company's employee id is no result; that company's own HR reader sees the day", async () => {
    const hr = await loginAs("HR");
    const foreign = await attendance.listAttendance(hr, parseAttendanceQuery({ ...JANUARY, employeeId: EMP.b1 }));
    expect(foreign.pagination.total).toBe(0);
    const hrB = await loginAsMembership("member_hr__b");
    const own = await attendance.listAttendance(hrB, parseAttendanceQuery({ ...JANUARY, employeeId: EMP.b1 }));
    expect(own.data.map((row) => row.id)).toEqual([R.b1]);
  });

  it("the leave parser reads the same `employeeId` key", () => {
    expect(parseLeaveQuery({ employeeId: EMP.a5 }).employeeId).toBe(EMP.a5);
  });
});

describe("recruitment (AUD-08 §3, §4)", () => {
  it("a page that is not a number is page 1, and a page past the end reads the last page", async () => {
    expect(candidateListQuerySchema.parse({ page: "abc" }).page).toBe(1);
    const hr = await loginAs("HR");
    const first = await listCandidates(hr, candidateListQuerySchema.parse({}));
    const past = await listCandidates(hr, candidateListQuerySchema.parse({ page: "999" }));
    expect(past.meta.page).toBe(first.meta.totalPages);
    expect(past.meta.total).toBe(first.meta.total);
  });
});
