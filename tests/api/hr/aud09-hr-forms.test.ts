import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import { applyEmploymentChange } from "@/lib/modules/hr/employment/employment.change.service";
import { addDays, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import { createEmployeeProfileSchema, createLeaveSchema, updateEmployeeProfileSchema, updateLeaveSchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { endWorkforce } from "@/lib/modules/workforce/workforce.end";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 (Forms & Validation) for HR's own forms: the payload contract of the
 * employment edit, leave and attendance, over the route and the server action
 * the pages post to, against the real database.
 *
 *   FV-04  the server holds the form's rules, forged payloads included;
 *   FV-05  absent, empty and null are three answers — an edit that does not
 *          carry a field never erases it;
 *   FV-07  calendar dates stay the day typed; impossible dates and ranges
 *          outside the employment are refused on their field;
 *   FV-10/FV-20  a private field hidden from its reader (the leave reason)
 *          is kept by that reader's edit, and a forged one is refused with
 *          nothing written.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { PATCH: patchEmployee } = await import("@/app/api/hr/employees/[employeeId]/route");
const { PATCH: patchAttendance } = await import("@/app/api/hr/attendance/[attendanceId]/route");
const actions = await import("@/lib/actions/hr");

const PREFIX = "aud09c2_";
const startedAt = new Date();
let hr: UserContext;

beforeAll(async () => {
  hr = await loginAs("HR");
});

afterEach(() => {
  actAs(null);
  vi.useRealTimers();
});

afterAll(async () => {
  await removeCreated();
  await cleanupSessions();
});

async function removeCreated(): Promise<void> {
  const people = await prisma.personProfile.findMany({ where: { lastName: { startsWith: PREFIX } }, select: { id: true } });
  const personIds = people.map((row) => row.id);
  const employments = await prisma.employeeProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const employmentIds = employments.map((row) => row.id);
  const leaveRows = await prisma.leaveRequest.findMany({ where: { employeeProfileId: { in: employmentIds } }, select: { id: true } });
  const attendanceRows = await prisma.attendanceRecord.findMany({ where: { employeeProfileId: { in: employmentIds } }, select: { id: true } });
  const trail = [...personIds, ...employmentIds, ...leaveRows.map((row) => row.id), ...attendanceRows.map((row) => row.id)];
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: startedAt } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: startedAt } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.attendanceRecord.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.leaveRequest.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.leaveBalance.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.employeeProfile.deleteMany({ where: { id: { in: employmentIds } } });
  await prisma.personProfile.deleteMany({ where: { id: { in: personIds } } });
}

let serial = 0;
/** A new worker with no login, started on `startDay` (default today), as HR adds one. */
async function newWorker(extra: Record<string, unknown> = {}, startDay = todayDay()) {
  serial += 1;
  const created = await employees.createEmployeeProfile(
    hr,
    createEmployeeProfileSchema.parse({ subject: "NEW", firstName: `Ardit${serial}`, lastName: `${PREFIX}Leka${serial}`, employmentType: "FULL_TIME", confirmNewPerson: true, ...extra }),
  );
  await applyEmploymentChange(hr, created.id, employmentChangeSchema.parse({ action: "STATUS", status: "ACTIVE", reason: "HIRE", effectiveDate: startDay }), { placement: placeMembership, workforce: endWorkforce });
  return created.id;
}

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;
async function call<P>(handler: Handler<P>, params: P, body: unknown) {
  const response = await handler(new Request("http://localhost/api/test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** The next Monday at least `weeks` weeks out, as YYYY-MM-DD. */
function monday(weeks: number): string {
  let day = addDays(todayDay(), weeks * 7);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 1) day = addDays(day, 1);
  return day;
}

describe("the employment edit is a partial update (FV-05)", () => {
  it("keeps every field a PATCH does not name, and clears only what it names as null or empty", async () => {
    const id = await newWorker({ employeeNumber: `${PREFIX}E1`, weeklyHours: "40", probationEndDate: addDays(todayDay(), 90), endDate: addDays(todayDay(), 365) });
    actAs(hr);

    // Omitted: a PATCH naming the hours alone.
    const partial = await call(patchEmployee, { employeeId: id }, { weeklyHours: "32.5" });
    expect(partial.status).toBe(200);
    let row = await prisma.employeeProfile.findUniqueOrThrow({ where: { id }, select: { employeeNumber: true, weeklyHours: true, probationEndDate: true, endDate: true } });
    expect(row.employeeNumber).toBe(`${PREFIX}E1`);
    expect(row.weeklyHours?.toString()).toBe("32.5");
    expect(row.probationEndDate?.toISOString().slice(0, 10)).toBe(addDays(todayDay(), 90));
    expect(row.endDate?.toISOString().slice(0, 10)).toBe(addDays(todayDay(), 365));

    // Null and empty clear exactly the fields they name.
    const cleared = await call(patchEmployee, { employeeId: id }, { employeeNumber: null, probationEndDate: "" });
    expect(cleared.status).toBe(200);
    row = await prisma.employeeProfile.findUniqueOrThrow({ where: { id }, select: { employeeNumber: true, weeklyHours: true, probationEndDate: true, endDate: true } });
    expect(row.employeeNumber).toBeNull();
    expect(row.probationEndDate).toBeNull();
    expect(row.weeklyHours?.toString()).toBe("32.5");
    expect(row.endDate?.toISOString().slice(0, 10)).toBe(addDays(todayDay(), 365));
  });

  it("refuses an impossible date on its field and writes nothing; a real one saves", async () => {
    const id = await newWorker({ weeklyHours: "40" });
    actAs(hr);
    const refused = await call(patchEmployee, { employeeId: id }, { endDate: "2031-02-30", weeklyHours: "10" });
    expect(refused.status).toBe(422);
    expect(refused.body?.error.code).toBe("VALIDATION_ERROR");
    expect(refused.body?.error.fieldErrors?.endDate?.[0]).toMatch(/YYYY-MM-DD/);
    const untouched = await prisma.employeeProfile.findUniqueOrThrow({ where: { id }, select: { endDate: true, weeklyHours: true } });
    expect(untouched.endDate).toBeNull();
    expect(untouched.weeklyHours?.toString()).toBe("40");

    const saved = await call(patchEmployee, { employeeId: id }, { endDate: "2031-02-28" });
    expect(saved.status).toBe(200);
    const stored = await prisma.employeeProfile.findUniqueOrThrow({ where: { id }, select: { endDate: true } });
    // The calendar day typed, at midday UTC — never rolled into March or shifted a day.
    expect(stored.endDate?.toISOString()).toBe("2031-02-28T12:00:00.000Z");
  });

  it("refuses probation ending before the stored start, on the field (FV-07)", async () => {
    const id = await newWorker();
    actAs(hr);
    const refused = await call(patchEmployee, { employeeId: id }, { probationEndDate: addDays(todayDay(), -3) });
    expect(refused.status).toBe(422);
    expect(refused.body?.error.details?.code).toBe("PROBATION_BEFORE_START");
    expect(refused.body?.error.fieldErrors?.probationEndDate).toBeDefined();
    expect((await prisma.employeeProfile.findUniqueOrThrow({ where: { id }, select: { probationEndDate: true } })).probationEndDate).toBeNull();
  });

  it("the server action takes the same payload rules as the route", () => {
    // An untouched form posts "" for a cleared field: null. A field the page did not render is absent: undefined.
    expect(updateEmployeeProfileSchema.parse({ employeeNumber: "", weeklyHours: "" })).toEqual({ employeeNumber: null, weeklyHours: null });
    expect(updateEmployeeProfileSchema.parse({})).toEqual({});
  });
});

describe("leave dates are calendar dates inside the employment (FV-07)", () => {
  it("refuses 2027-02-29 through the action with a field error and writes nothing", async () => {
    const id = await newWorker();
    actAs(hr);
    const before = await prisma.leaveRequest.count({ where: { employeeProfileId: id } });
    const result = await actions.createLeaveAction(form({ employeeId: id, leaveType: "UNPAID", startDate: "2027-02-29", endDate: "2027-03-02" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.startDate?.[0]).toMatch(/YYYY-MM-DD/);
    expect(await prisma.leaveRequest.count({ where: { employeeProfileId: id } })).toBe(before);
  });

  it("refuses leave starting before the employment does, on the start field; inside it saves the days typed", async () => {
    // A planned employment starting in two weeks: its start is stored on create.
    const startDay = monday(2);
    serial += 1;
    const { id } = await employees.createEmployeeProfile(
      hr,
      createEmployeeProfileSchema.parse({ subject: "NEW", firstName: `Planned${serial}`, lastName: `${PREFIX}Leka${serial}`, employmentType: "FULL_TIME", confirmNewPerson: true, startDate: startDay }),
    );
    expect((await prisma.employeeProfile.findUniqueOrThrow({ where: { id }, select: { startDate: true } })).startDate?.toISOString().slice(0, 10)).toBe(startDay);
    actAs(hr);
    const early = await actions.createLeaveAction(form({ employeeId: id, leaveType: "UNPAID", startDate: addDays(startDay, -7), endDate: addDays(startDay, 1) }));
    expect(early).toMatchObject({ ok: false, code: "LEAVE_OUTSIDE_EMPLOYMENT" });
    expect(early.ok === false && early.fieldErrors?.startDate).toBeDefined();
    expect(await prisma.leaveRequest.count({ where: { employeeProfileId: id } })).toBe(0);

    const inside = await actions.createLeaveAction(form({ employeeId: id, leaveType: "UNPAID", startDate: startDay, endDate: addDays(startDay, 1) }));
    expect(inside.ok).toBe(true);
    const stored = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeProfileId: id }, select: { startDate: true, endDate: true } });
    expect(stored.startDate.toISOString()).toBe(`${startDay}T12:00:00.000Z`);
    expect(stored.endDate.toISOString()).toBe(`${addDays(startDay, 1)}T12:00:00.000Z`);
  });

  it("refuses an end before the start on the end field", () => {
    const parsed = createLeaveSchema.safeParse({ leaveType: "UNPAID", startDate: "2027-03-10", endDate: "2027-03-09" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["endDate"]);
  });
});

describe("the leave reason is private (FV-05, FV-10, FV-20)", () => {
  async function draftWithReason() {
    const id = await newWorker({}, todayDay());
    const startDay = monday(3);
    const created = await leave.createLeave(hr, createLeaveSchema.parse({ employeeId: id, leaveType: "UNPAID", startDate: startDay, endDate: addDays(startDay, 1), reason: `${PREFIX}medical appointment` }));
    return { id: created.id, startDay };
  }

  it("a reader who may not see it keeps it by editing without it, and is refused when they send one", async () => {
    const { id, startDay } = await draftWithReason();
    // HR at CONTRIBUTE: may edit leave, may not read reasons (config/role-defaults.ts).
    const blind: UserContext = { ...hr, permissions: hr.permissions.filter((permission) => permission !== "hr.leave.reason.view") };
    expect("reason" in (await leave.getLeave(blind, id))).toBe(false);

    // Their form has no reason field: the edit omits it and the reason stays.
    await leave.updateLeave(blind, id, updateLeaveSchema.parse({ leaveType: "SICK", startDate: startDay, endDate: addDays(startDay, 1) }));
    let row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, select: { reason: true, leaveType: true } });
    expect(row).toEqual({ reason: `${PREFIX}medical appointment`, leaveType: "SICK" });

    // A forged reason — or a forged clear — is refused, and nothing at all is written.
    for (const reason of ["overwritten", ""]) {
      actAs(blind);
      const result = await actions.updateLeaveAction(id, form({ leaveType: "ANNUAL", startDate: startDay, endDate: addDays(startDay, 1), reason }));
      expect(result).toMatchObject({ ok: false, code: "LEAVE_REASON_NOT_VISIBLE" });
      row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, select: { reason: true, leaveType: true } });
      expect(row).toEqual({ reason: `${PREFIX}medical appointment`, leaveType: "SICK" });
    }
  });

  it("positive control: a reader of reasons changes and clears it", async () => {
    const { id, startDay } = await draftWithReason();
    actAs(hr);
    expect(await actions.updateLeaveAction(id, form({ leaveType: "UNPAID", startDate: startDay, endDate: addDays(startDay, 1), reason: `${PREFIX}changed` }))).toMatchObject({ ok: true });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, select: { reason: true } })).reason).toBe(`${PREFIX}changed`);
    expect(await actions.updateLeaveAction(id, form({ leaveType: "UNPAID", startDate: startDay, endDate: addDays(startDay, 1), reason: "" }))).toMatchObject({ ok: true });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, select: { reason: true } })).reason).toBeNull();
  });

  it("never reaches the activity trail", async () => {
    const { id } = await draftWithReason();
    const trail = await prisma.activity.findMany({ where: { entityId: id }, select: { message: true, metadata: true } });
    expect(trail.length).toBeGreaterThan(0);
    expect(JSON.stringify(trail)).not.toContain("medical appointment");
  });
});

describe("attendance (FV-05, FV-07)", () => {
  it("a PATCH of the status alone keeps the times and notes it does not name", async () => {
    const id = await newWorker({}, addDays(todayDay(), -10));
    const day = addDays(todayDay(), -1);
    actAs(hr);
    expect(await actions.createAttendanceAction(form({ employeeId: id, date: day, status: "PRESENT", checkIn: "07:00", checkOut: "15:30", notes: `${PREFIX}site B` }))).toMatchObject({ ok: true });
    const record = await prisma.attendanceRecord.findFirstOrThrow({ where: { employeeProfileId: id }, select: { id: true } });

    const response = await call(patchAttendance, { attendanceId: record.id }, { status: "REMOTE" });
    expect(response.status).toBe(200);
    const row = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id }, select: { status: true, checkIn: true, checkOut: true, workedMinutes: true, notes: true } });
    expect(row.status).toBe("REMOTE");
    expect(row.checkIn?.toISOString()).toBe(`${day}T07:00:00.000Z`);
    expect(row.workedMinutes).toBe(510);
    expect(row.notes).toBe(`${PREFIX}site B`);

    // A status that carries no times clears them: the "clear" policy, on the server.
    await call(patchAttendance, { attendanceId: record.id }, { status: "ABSENT" });
    const absent = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id }, select: { checkIn: true, checkOut: true, notes: true } });
    expect(absent).toEqual({ checkIn: null, checkOut: null, notes: `${PREFIX}site B` });
  });

  it("judges 'future' by the company's day in Tirana, at a fixed clock just after local midnight", async () => {
    const id = await newWorker({}, "2026-01-05");
    // 00:30 in Tirana on 15 Jan 2026 (UTC+1) is still 14 Jan in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-14T23:30:00.000Z"));
    actAs(hr);
    const today = await actions.createAttendanceAction(form({ employeeId: id, date: "2026-01-15", status: "PRESENT" }));
    expect(today).toMatchObject({ ok: true });
    const tomorrow = await actions.createAttendanceAction(form({ employeeId: id, date: "2026-01-16", status: "PRESENT" }));
    expect(tomorrow).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    const rows = await prisma.attendanceRecord.findMany({ where: { employeeProfileId: id }, select: { date: true } });
    expect(rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(["2026-01-15"]);
  });
});
