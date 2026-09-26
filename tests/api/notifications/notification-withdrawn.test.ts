import { afterAll, describe, expect, it } from "vitest";

import { canReadRecord } from "@/lib/core/records/record.registry";
import { listNotifications, WITHDRAWN_TITLE } from "@/lib/core/notifications/notification.service";
import { listActivity } from "@/lib/modules/activity/activity-center.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * AUD-06 RP-18: a notification's stored title names a record. Once the reader
 * can no longer open that record, the list and the Activity Center withhold
 * the title and body, and a search never answers with it. A positive control
 * keeps a readable record's notification exactly as written.
 */

const MARK = `aud06_${Date.now().toString(36)}`;
const taskIds: string[] = [];
const notificationIds: string[] = [];
const projectIds: string[] = [];

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("notifications about records the reader can no longer open (RP-18)", () => {
  it("withholds the title, body and link, and search does not find it; a readable one is unchanged", async () => {
    // A project-scoped reader: the engineer on Riverside Residences.
    const pm = await loginAs("ENGINEER");

    // A project of the same company the engineer is not on: a fixture of this test.
    const hidden = `${MARK}_project`;
    await prisma.project.create({ data: { id: hidden, companyId: pm.companyId, code: MARK.slice(-10).toUpperCase(), name: `${MARK} elsewhere`, status: "ACTIVE", createdBy: "aud06" } });
    projectIds.push(hidden);
    expect(await canReadRecord(pm, "project", hidden)).toBe(false);

    const creator = pm.membershipId;
    const [secret, visible] = await Promise.all([
      prisma.task.create({ data: { companyId: pm.companyId, projectId: hidden, title: `${MARK} secret`, status: "TODO", priority: "MEDIUM", createdByMemberId: creator, createdBy: "aud06" }, select: { id: true } }),
      prisma.task.create({ data: { companyId: pm.companyId, projectId: PROJECT.a, title: `${MARK} visible`, status: "TODO", priority: "MEDIUM", createdByMemberId: creator, createdBy: "aud06", assigneeMemberId: pm.membershipId }, select: { id: true } }),
    ]);
    taskIds.push(secret.id, visible.id);
    // The fixture is what it claims: one task out of reach, one within it.
    expect(await canReadRecord(pm, "task", secret.id)).toBe(false);
    expect(await canReadRecord(pm, "task", visible.id)).toBe(true);

    const note = (taskId: string, title: string) =>
      prisma.notification.create({
        data: {
          companyId: pm.companyId,
          recipientMemberId: pm.membershipId,
          eventType: "TASK_ASSIGNED",
          moduleKey: "tasks",
          entityType: "task",
          entityId: taskId,
          title,
          body: `${title}: the details`,
          priority: "NORMAL",
          readState: "UNREAD",
          dedupeKey: `${MARK}:${taskId}`,
        },
        select: { id: true },
      });
    const [secretNote, visibleNote] = await Promise.all([note(secret.id, `${MARK} Codename Falcon`), note(visible.id, `${MARK} Pour the slab`)]);
    notificationIds.push(secretNote.id, visibleNote.id);

    const page = await listNotifications(pm, { limit: 100 });
    const secretRow = page.data.find((row) => row.id === secretNote.id);
    const visibleRow = page.data.find((row) => row.id === visibleNote.id);
    expect(secretRow).toMatchObject({ title: WITHDRAWN_TITLE, body: null, href: null });
    expect(JSON.stringify(page.data)).not.toContain("Codename Falcon");
    expect(visibleRow).toMatchObject({ title: `${MARK} Pour the slab`, href: `/notifications/${visibleNote.id}/open` });

    const activity = await listActivity(pm, { type: "NOTIFICATION", limit: 50 });
    const inStream = activity.items.find((item) => item.id === secretNote.id);
    if (inStream) expect(inStream).toMatchObject({ title: WITHDRAWN_TITLE, bodyPreview: null, href: null, recordId: null });
    expect(JSON.stringify(activity.items)).not.toContain("Codename Falcon");

    // Searching for the withheld words answers nothing; the readable one is found.
    const searched = await listActivity(pm, { q: "Codename Falcon" });
    expect(searched.items.map((item) => item.id)).not.toContain(secretNote.id);
    const control = await listActivity(pm, { q: `${MARK} Pour the slab` });
    expect(control.items.map((item) => item.id)).toContain(visibleNote.id);
  });
});
