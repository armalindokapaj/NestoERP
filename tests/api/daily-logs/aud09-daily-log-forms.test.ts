import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { createDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 — the daily log's header and entry forms over their routes, against
 * the real database (§4; FV-04, FV-05, FV-07, FV-22). A throwaway site in
 * company A, with the Engineer on its team, keeps the seeded logs untouched.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { PATCH } = await import("@/app/api/daily-logs/[dailyLogId]/route");
const { POST: ADD } = await import("@/app/api/daily-logs/[dailyLogId]/[section]/route");

const ZONE = "Europe/Tirane";
const SITE = "aud09b_site";
let engineer: UserContext;

async function removeSite() {
  const logs = await prisma.dailyLog.findMany({ where: { projectId: SITE }, select: { id: true } });
  const ids = logs.map((row) => row.id);
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.dailyLog.deleteMany({ where: { id: { in: ids } } });
  await prisma.projectDailyLogSettings.deleteMany({ where: { projectId: SITE } });
  await prisma.projectMember.deleteMany({ where: { projectId: SITE } });
  await prisma.project.deleteMany({ where: { id: SITE } });
}

beforeAll(async () => {
  engineer = await loginAs("ENGINEER");
  await removeSite();
  await prisma.project.create({ data: { id: SITE, companyId: COMPANY.a, code: "AUD09B-SITE", name: "AUD-09 site", status: "ACTIVE", projectManagerMemberId: "member_owner", createdBy: "test" } });
  await prisma.projectMember.create({ data: { companyId: COMPANY.a, projectId: SITE, companyMemberId: "member_engineer", status: "ACTIVE" } });
});

afterEach(async () => {
  actAs(null);
  const logs = await prisma.dailyLog.findMany({ where: { projectId: SITE }, select: { id: true } });
  await prisma.activity.deleteMany({ where: { entityId: { in: logs.map((row) => row.id) } } });
  await prisma.dailyLog.deleteMany({ where: { projectId: SITE } });
});

afterAll(async () => {
  await removeSite();
  await cleanupSessions();
  await prisma.$disconnect();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function patch(dailyLogId: string, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/daily-logs/${dailyLogId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ dailyLogId }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function add(dailyLogId: string, section: string, body: unknown) {
  const response = await ADD(
    new Request(`http://localhost/api/daily-logs/${dailyLogId}/${section}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ dailyLogId, section }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

const today = () => localDate(new Date(), ZONE);

describe("the log's notes are a partial update (FV-05)", () => {
  it("a PATCH naming only the summary keeps every other note", async () => {
    const { id } = await createDailyLog(engineer, { projectId: SITE, workDate: today() });
    actAs(engineer);

    const first = await patch(id, { expectedVersion: 1, summary: "Formwork on level 2", generalNotes: "Crane inspection due", weatherSummary: "Dry", siteCondition: "DRY", siteConditionNotes: "Good access" });
    expect(first.status).toBe(200);
    const version = first.body.data.version as number;

    // Before AUD-09 every note the request did not repeat was erased.
    expect((await patch(id, { expectedVersion: version, summary: "Formwork and rebar on level 2" })).status).toBe(200);
    expect(await prisma.dailyLog.findUniqueOrThrow({ where: { id } })).toMatchObject({
      summary: "Formwork and rebar on level 2",
      generalNotes: "Crane inspection due",
      weatherSummary: "Dry",
      siteCondition: "DRY",
      siteConditionNotes: "Good access",
    });

    // `null` and `""` clear, on purpose.
    expect((await patch(id, { expectedVersion: version + 1, generalNotes: "", siteCondition: null })).status).toBe(200);
    expect(await prisma.dailyLog.findUniqueOrThrow({ where: { id } })).toMatchObject({ generalNotes: null, siteCondition: null, summary: "Formwork and rebar on level 2", weatherSummary: "Dry" });

    // Refusals name their field and write nothing.
    const refused = await patch(id, { expectedVersion: version + 2, summary: "s".repeat(5_001) });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details).toHaveProperty("summary");
    const badCondition = await patch(id, { expectedVersion: version + 2, siteCondition: "LAVA" });
    expect(badCondition.status).toBe(422);
    expect(badCondition.body.error.details).toHaveProperty("siteCondition");
    expect((await prisma.dailyLog.findUniqueOrThrow({ where: { id } })).version).toBe(version + 2);
  });
});

describe("entry times (FV-04, FV-07)", () => {
  it("refuses a visitor who left before arriving and a delay that ended before it started, on the right field", async () => {
    const { id } = await createDailyLog(engineer, { projectId: SITE, workDate: today() });
    actAs(engineer);

    const visitor = await add(id, "visitors", { name: "Building inspector", arrivedTime: "10:30", departedTime: "10:00" });
    expect(visitor.status).toBe(422);
    expect(visitor.body.error.details).toHaveProperty("departedTime");
    const delay = await add(id, "delays", { category: "WEATHER", title: "Rain stop", startedTime: "13:00", endedTime: "13:00" });
    expect(delay.status).toBe(422);
    expect(delay.body.error.details).toHaveProperty("endedTime");
    const badTime = await add(id, "visitors", { name: "Surveyor", arrivedTime: "24:10" });
    expect(badTime.status).toBe(422);
    expect(badTime.body.error.details).toHaveProperty("arrivedTime");
    const badDate = await add(id, "deliveries", { description: "Rebar", deliveredDate: "2031-02-30" });
    expect(badDate.status).toBe(422);
    expect(badDate.body.error.details).toHaveProperty("deliveredDate");
    expect(await prisma.dailyLogVisitorEntry.count({ where: { dailyLogId: id } })).toBe(0);

    // Positive controls.
    expect((await add(id, "visitors", { name: "Building inspector", arrivedTime: "10:00", departedTime: "10:30" })).status).toBe(201);
    expect((await add(id, "delays", { category: "WEATHER", title: "Rain stop", startedTime: "13:00", endedTime: "13:45" })).status).toBe(201);
    expect(await prisma.dailyLogVisitorEntry.count({ where: { dailyLogId: id } })).toBe(1);
  });
});
