import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { addEntry, updateEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { SECTION_SCHEMAS, projectSettingsSchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { createDailyLog, getDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { resolveDailyLogSettings, updateProjectDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * Daily log authorization regressions (PRD #47 §47, §50, §51, §60, §62).
 *
 * A project's daily log rules are reached through the same door as its logs,
 * and a delivery links only the purchase orders and receipts its writer can
 * open. Everything is written on the Logistics Hub (project_d), whose manager
 * is the Owner and where the Engineer keeps the logs; the Project Manager is
 * not on it. Every log and setting a test leaves there is removed after it.
 */

const SITE = PROJECT.d;
const ZONE = "Europe/Tirane";

let owner: UserContext;
let engineer: UserContext;
let pm: UserContext;
let finance: UserContext;

const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
const settings = (reviewerMemberId: string | null = null) => projectSettingsSchema.parse({ logsRequired: true, reviewerMemberId, workingDays: [1, 2, 3, 4, 5] });
const delivery = (value: Record<string, unknown>) => SECTION_SCHEMAS.deliveries.parse({ description: "Rebar", ...value }) as never;
const withGrant = (context: UserContext, ...grants: string[]) => ({ ...context, permissions: [...context.permissions, ...grants] }) as UserContext;

async function cleanup() {
  const logs = await prisma.dailyLog.findMany({ where: { projectId: SITE }, select: { id: true } });
  const ids = logs.map((row) => row.id);
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: ids } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.dailyLog.deleteMany({ where: { id: { in: ids } } });
  await prisma.projectDailyLogSettings.deleteMany({ where: { projectId: { in: [SITE, PROJECT.archived, PROJECT.b] } } });
}

beforeAll(async () => {
  [owner, engineer, pm, finance] = await Promise.all([loginAs("OWNER"), loginAs("ENGINEER"), loginAs("PROJECT_MANAGER"), loginAs("FINANCE")]);
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("project daily log settings (PRD #47 §47, §60)", () => {
  it("answers a project outside the writer's scope exactly like one that does not exist", async () => {
    // The Engineer is not on Central Office Tower: it used to answer 403 there and 404 for a made-up id.
    await expect(updateProjectDailyLogSettings(engineer, PROJECT.b, settings())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateProjectDailyLogSettings(engineer, "project_that_does_not_exist", settings())).rejects.toMatchObject({ code: "NOT_FOUND" });
    // On their own project the answer is about permission, as before.
    await expect(updateProjectDailyLogSettings(engineer, SITE, settings())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.projectDailyLogSettings.count({ where: { projectId: { in: [SITE, PROJECT.b] } } })).toBe(0);
  });

  it("keeps a project-scoped settings grant inside its projects, and archived projects read-only", async () => {
    // A custom project-scoped role holding the settings grant reaches only its own projects.
    await expect(updateProjectDailyLogSettings(withGrant(pm, "daily_log.settings.manage"), SITE, settings())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateProjectDailyLogSettings(owner, PROJECT.archived, settings())).rejects.toMatchObject(code("DAILY_LOG_PROJECT_ARCHIVED"));
    expect(await prisma.projectDailyLogSettings.count({ where: { projectId: { in: [SITE, PROJECT.archived] } } })).toBe(0);
  });

  it("names only a reviewer who could review this project's logs", async () => {
    // Finance has no daily logs; the Project Manager reviews logs but cannot open this project; the Engineer cannot review.
    for (const candidate of [finance, pm, engineer]) {
      await expect(updateProjectDailyLogSettings(owner, SITE, settings(candidate.membershipId))).rejects.toMatchObject(code("DAILY_LOG_REVIEWER_INVALID"));
    }
    expect(await prisma.projectDailyLogSettings.count({ where: { projectId: SITE } })).toBe(0);
    await updateProjectDailyLogSettings(owner, SITE, settings(owner.membershipId));
    expect((await resolveDailyLogSettings(owner.companyId, SITE)).reviewerMemberId).toBe(owner.membershipId);
  });
});

describe("delivery links (PRD #47 §50, §62)", () => {
  it("links a purchase order only for a writer who can open it, and keeps one already on the entry", async () => {
    const { id } = await createDailyLog(engineer, { projectId: SITE, workDate: localDate(new Date(), ZONE) });
    // The Engineer holds no purchase order grant: a real order on this very project is refused like a missing one.
    await expect(addEntry(engineer, id, "deliveries", delivery({ purchaseOrderId: "order_011" }))).rejects.toMatchObject(code("DAILY_LOG_PURCHASE_ORDER_INVALID"));
    await expect(addEntry(engineer, id, "deliveries", delivery({ purchaseOrderId: "order_005" }))).rejects.toMatchObject(code("DAILY_LOG_PURCHASE_ORDER_INVALID"));

    const added = await addEntry(owner, id, "deliveries", delivery({ purchaseOrderId: "order_011" }));
    const entry = (await getDailyLog(engineer, id)).deliveries[0];
    // Editing the description keeps the order the Owner attached, without the Engineer being able to read it.
    await updateEntry(engineer, id, "deliveries", added.id, Object.assign(delivery({ description: "Rebar, 12 t", purchaseOrderId: "order_011" }) as object, { updatedAt: entry.updatedAt }) as never);
    expect(await prisma.dailyLogDeliveryEntry.findUniqueOrThrow({ where: { id: added.id }, select: { description: true, purchaseOrderId: true } })).toEqual({ description: "Rebar, 12 t", purchaseOrderId: "order_011" });
    // But not a different one.
    await expect(updateEntry(engineer, id, "deliveries", added.id, delivery({ purchaseOrderId: "order_016" }))).rejects.toMatchObject(code("DAILY_LOG_PURCHASE_ORDER_INVALID"));
  });
});
