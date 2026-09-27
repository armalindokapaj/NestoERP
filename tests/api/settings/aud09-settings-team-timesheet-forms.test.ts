import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { updateMemberSchema } from "@/lib/modules/team/team.schema";
import { workLogInputSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { createWorkLog } from "@/lib/modules/timesheets/timesheet.worklogs";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 (Forms & Validation) for Settings, Team and Timesheets: disabled and
 * unrendered controls post nothing, and nothing they did not post is reset
 * (FV-05, FV-10); a refused parse is said on its field, not thrown (FV-04).
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const settings = await import("@/lib/actions/settings");
const { PATCH: patchMember } = await import("@/app/api/team/[memberId]/route");
const { PATCH: patchWorkLog } = await import("@/app/api/worklogs/[workLogId]/route");

const TARGET = { moduleKey: "finance", entityType: "invoice" } as const;
const startedAt = new Date();
let owner: UserContext;
let hse: UserContext;
let member: { jobTitle: string | null; departmentId: string | null; roleId: string };
const workLogs: string[] = [];

beforeAll(async () => {
  owner = await loginAs("OWNER");
  hse = await loginAs("HSE");
  member = await prisma.companyMember.findUniqueOrThrow({ where: { id: "member_engineer" }, select: { jobTitle: true, departmentId: true, roleId: true } });
});

afterEach(() => actAs(null));

afterAll(async () => {
  const scheme = await prisma.companyNumberingScheme.findUniqueOrThrow({ where: { companyId_moduleKey_entityType: { companyId: owner.companyId, ...TARGET } } });
  await prisma.companyNumberingScheme.update({ where: { id: scheme.id }, data: { mode: "AUTO", prefix: "INV", separator: "-", yearMode: "YYYY", padding: 4, resetSequenceYearly: scheme.resetSequenceYearly } });
  await prisma.auditEvent.deleteMany({ where: { actionKey: AuditAction.COMPANY_NUMBERING_CHANGED, companyId: owner.companyId, createdAt: { gte: startedAt } } });
  await prisma.companyMember.update({ where: { id: "member_engineer" }, data: member });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ["member_engineer", ...workLogs] }, createdAt: { gte: startedAt } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ["member_engineer", ...workLogs] }, createdAt: { gte: startedAt } } });
  await prisma.workLog.deleteMany({ where: { id: { in: workLogs } } });
  const empties = await prisma.timesheet.findMany({ where: { memberId: hse.membershipId, createdAt: { gte: startedAt }, workLogs: { none: {} } }, select: { id: true } });
  await prisma.timesheet.deleteMany({ where: { id: { in: empties.map((row) => row.id) } } });
  await cleanupSessions();
});

async function patch<P>(handler: (request: Request, context: { params: Promise<P> }) => Promise<Response>, params: P, body: unknown) {
  const response = await handler(new Request("http://localhost/api/test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("numbering scheme (FV-05, FV-10 omit/preserve)", () => {
  it("switches to manual with the format fields disabled — absent — and keeps the format", async () => {
    actAs(owner);
    // A manual scheme's form disables prefix, separator, year, digits and reset: none is posted.
    const result = await settings.updateNumberingSchemeAction(form({ ...TARGET, mode: "MANUAL" }));
    expect(result).toEqual({ ok: true });
    const row = await prisma.companyNumberingScheme.findUniqueOrThrow({ where: { companyId_moduleKey_entityType: { companyId: owner.companyId, ...TARGET } }, select: { mode: true, prefix: true, separator: true, yearMode: true, padding: true } });
    expect(row).toEqual({ mode: "MANUAL", prefix: "INV", separator: "-", yearMode: "YYYY", padding: 4 });
  });

  it("refuses an out-of-range value on its field instead of throwing, and writes nothing", async () => {
    actAs(owner);
    const result = await settings.updateNumberingSchemeAction(form({ ...TARGET, mode: "AUTO", prefix: "INV", separator: "-", yearMode: "YYYY", padding: "2" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.padding?.[0]).toBe("At least 3 digits");
    expect((await prisma.companyNumberingScheme.findUniqueOrThrow({ where: { companyId_moduleKey_entityType: { companyId: owner.companyId, ...TARGET } }, select: { padding: true } })).padding).toBe(4);
  });
});

describe("team member edit (FV-05)", () => {
  it("keeps the department and title a PATCH does not name", async () => {
    actAs(owner);
    const kept = await patch(patchMember, { memberId: "member_engineer" }, { roleId: member.roleId });
    expect(kept.status).toBe(200);
    expect(await prisma.companyMember.findUniqueOrThrow({ where: { id: "member_engineer" }, select: { jobTitle: true, departmentId: true } })).toEqual({ jobTitle: member.jobTitle, departmentId: member.departmentId });
    // No placement was made: the employment's history has no row from this edit.
    expect(await prisma.employmentAssignment.count({ where: { employeeProfile: { companyMemberId: "member_engineer" }, createdAt: { gte: startedAt } } })).toBe(0);
  });

  it("reads empty as a clear and absent as unchanged (the payload contract; a clear is a placement, not exercised on seeded people)", () => {
    expect(updateMemberSchema.parse({ roleId: "r", jobTitle: "", departmentId: null })).toEqual({ roleId: "r", jobTitle: null, departmentId: null });
    expect(updateMemberSchema.parse({ roleId: "r" })).toEqual({ roleId: "r" });
  });
});

describe("timesheet entry edit (FV-05)", () => {
  it("keeps the project, task, description and overtime flag a PATCH does not carry", async () => {
    const workDate = localDate(new Date(), "Europe/Tirane");
    const created = await createWorkLog(hse, workLogInputSchema.parse({ workDate, workType: "PROJECT_WORK", projectId: PROJECT.a, taskId: "task_009", minutes: 90, description: "aud09c2_ pour check", overtimeFlag: true }));
    workLogs.push(created.workLogId);

    actAs(hse);
    const response = await patch(patchWorkLog, { workLogId: created.workLogId }, { workDate, workType: "PROJECT_WORK", minutes: 120 });
    expect(response.status).toBe(200);
    const row = await prisma.workLog.findUniqueOrThrow({ where: { id: created.workLogId }, select: { minutes: true, projectId: true, taskId: true, description: true, overtimeFlag: true } });
    expect(row).toEqual({ minutes: 120, projectId: PROJECT.a, taskId: "task_009", description: "aud09c2_ pour check", overtimeFlag: true });

    // Null clears what it names.
    await patch(patchWorkLog, { workLogId: created.workLogId }, { workDate, workType: "PROJECT_WORK", minutes: 120, taskId: null, description: null });
    const cleared = await prisma.workLog.findUniqueOrThrow({ where: { id: created.workLogId }, select: { projectId: true, taskId: true, description: true } });
    expect(cleared).toEqual({ projectId: PROJECT.a, taskId: null, description: null });
  });
});
