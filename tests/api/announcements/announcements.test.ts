import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { loadRecord } from "@/lib/core/records/record.registry";
import { prisma as app } from "@/lib/database/prisma";
import { globalSearch } from "@/lib/core/search/search.service";
import { announcementCalendarProvider } from "@/lib/modules/announcements/announcement.calendar-provider";
import { archiveAnnouncement, publishAnnouncement, runAcknowledgmentReminders, runAnnouncementSchedule, scheduleAnnouncement, setPinned, unscheduleAnnouncement } from "@/lib/modules/announcements/announcement.publish";
import { createAnnouncementSchema, feedQuerySchema, updateAnnouncementSchema } from "@/lib/modules/announcements/announcement.schema";
import {
  acknowledgeAnnouncement,
  acknowledgmentList,
  announcementMetrics,
  criticalAnnouncementBanner,
  createAnnouncement,
  dashboardAnnouncements,
  duplicateAnnouncement,
  getAnnouncement,
  listAnnouncements,
  markRead,
  updateAnnouncement,
} from "@/lib/modules/announcements/announcement.service";
import { canAttachToDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { ANNOUNCEMENT_SEED } from "../../../prisma/seed/announcements";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Announcements against the real database (PRD #45 §300-§314, §320).
 *
 * Every announcement a test writes is removed after it, with its reads,
 * acknowledgments, targets, notifications and attention; the seeded ones are
 * only read — apart from the pin, which is put back.
 */

const SEEDED = Object.values(ANNOUNCEMENT_SEED) as string[];
let owner: UserContext;
let hr: UserContext;
let pm: UserContext;
let engineer: UserContext;
let architect: UserContext;
let viewer: UserContext;
let finance: UserContext;
let inventory: UserContext;
let it_: UserContext;
let ownerB: UserContext;

const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
const feed = (context: UserContext, tab: string, extra: Record<string, unknown> = {}) => listAnnouncements(context, feedQuerySchema.parse({ tab, limit: 100, ...extra }));
const ids = async (context: UserContext, tab: string) => (await feed(context, tab)).items.map((item) => item.id);

async function cleanup() {
  const rows = await prisma.announcement.findMany({ where: { id: { notIn: SEEDED }, companyId: { in: [COMPANY.a, COMPANY.tenant] } }, select: { id: true } });
  const created = rows.map((row) => row.id);
  await prisma.attentionItem.deleteMany({ where: { entityType: "announcement", entityId: { in: created } } });
  await prisma.notification.deleteMany({ where: { entityType: "announcement", entityId: { in: created } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityType: "announcement", entityId: { in: created } } });
  // Reminder rounds are claimed per announcement (PRD #51 §15-§19). The reminder test's clock also reaches the
  // seeded policy's rounds, which would otherwise stay claimed, and reminded, ahead of the real date.
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: "announcements.reminders", OR: [...created, ...SEEDED].map((id) => ({ key: { startsWith: `${id}:` } })) } });
  await prisma.notificationEventOutbox.deleteMany({ where: { eventType: "ANNOUNCEMENT_REMINDER", entityType: "announcement", entityId: { in: SEEDED } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
  await prisma.announcement.deleteMany({ where: { id: { in: created } } });
  await prisma.announcement.update({ where: { id: ANNOUNCEMENT_SEED.company }, data: { pinned: true } });
}

beforeAll(async () => {
  [owner, hr, pm, engineer, architect, viewer, finance, inventory, it_] = await Promise.all((["OWNER", "HR", "PROJECT_MANAGER", "ENGINEER", "ARCHITECT", "VIEWER", "FINANCE", "INVENTORY", "GROUP_IT"] as const).map((role) => loginAs(role)));
  ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function draft(context: UserContext, input: Record<string, unknown> = {}) {
  return (await createAnnouncement(context, createAnnouncementSchema.parse({ title: "Site induction refresh", body: "Everyone completes the **new** induction by Friday.", ...input }))).id;
}

async function published(context: UserContext, input: Record<string, unknown> = {}) {
  const id = await draft(context, input);
  await publishAnnouncement(context, id, { expectedVersion: 1 });
  return id;
}

const version = async (id: string) => (await prisma.announcement.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;

describe("drafting and publishing (§20, §34, §142, §154, §300)", () => {
  it("keeps a draft to its author and managers, publishes it to the company, and records the read once the detail is opened", async () => {
    const id = await draft(owner, { title: "Quarterly safety week" });
    await expect(getAnnouncement(engineer, id)).rejects.toMatchObject(code("ANNOUNCEMENT_NOT_FOUND"));
    expect((await getAnnouncement(hr, id)).capabilities.canPublish).toBe(true);
    expect(await ids(owner, "manage")).toContain(id);

    await publishAnnouncement(owner, id, { expectedVersion: 1 });
    expect(await ids(engineer, "for_me")).toContain(id);
    expect(await ids(engineer, "unread")).toContain(id);
    expect(await ids(viewer, "for_me")).toContain(id);
    await expect(getAnnouncement(ownerB, id)).rejects.toBeTruthy();

    const detail = await getAnnouncement(engineer, id);
    expect(detail).toMatchObject({ status: "PUBLISHED", read: false, audience: { label: "Company" }, capabilities: { canEdit: false, canViewMetrics: false } });
    await markRead(engineer, id);
    await markRead(engineer, id);
    expect(await prisma.announcementRead.count({ where: { announcementId: id, memberId: engineer.membershipId } })).toBe(1);
    expect(await ids(engineer, "unread")).not.toContain(id);
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "ANNOUNCEMENT_PUBLISHED" } })).toBe(1);
    expect(await prisma.activity.count({ where: { entityId: id, action: "ANNOUNCEMENT_PUBLISHED" } })).toBe(1);
    // A normal announcement is a feed item, not a notification (§45).
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id } })).toBe(0);
  });

  it("gives each audience its own grant, and refuses people from outside the company", async () => {
    await expect(draft(engineer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(draft(pm)).rejects.toMatchObject(code("ANNOUNCEMENT_AUDIENCE_FORBIDDEN"));
    await expect(draft(pm, { audienceType: "PROJECT", projectId: PROJECT.c })).rejects.toMatchObject(code("ANNOUNCEMENT_PROJECT_INVALID"));
    await expect(draft(pm, { audienceType: "PROJECT", projectId: PROJECT.companyB })).rejects.toMatchObject(code("ANNOUNCEMENT_PROJECT_INVALID"));
    await expect(draft(owner, { audienceType: "SELECTED_MEMBERS", selectedMemberIds: [engineer.membershipId, ownerB.membershipId] })).rejects.toMatchObject(code("ANNOUNCEMENT_MEMBERS_INVALID"));
    await expect(draft(it_, { audienceType: "DEPARTMENT", departmentId: finance.department!.id })).rejects.toMatchObject(code("ANNOUNCEMENT_AUDIENCE_FORBIDDEN"));
    expect(await draft(it_)).toBeTruthy();
    expect(await draft(hr, { audienceType: "DEPARTMENT", departmentId: finance.department!.id })).toBeTruthy();
  });

  it("publishes once when two people press Publish together (§294)", async () => {
    const id = await draft(owner);
    const outcomes = await Promise.allSettled([publishAnnouncement(owner, id, { expectedVersion: 1 }), publishAnnouncement(hr, id, { expectedVersion: 1 })]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "ANNOUNCEMENT_PUBLISHED" } })).toBe(1);
  });
});

describe("audiences (§28-§32, §301-§305)", () => {
  it("reaches a project's people and nobody the project does not reach — and opens nothing else", async () => {
    const id = await published(pm, { audienceType: "PROJECT", projectId: PROJECT.a, priority: "IMPORTANT" });
    expect(await ids(engineer, "for_me")).toContain(id);
    expect(await ids(architect, "for_me")).toContain(id);
    expect(await ids(inventory, "for_me")).not.toContain(id);
    await expect(getAnnouncement(inventory, id)).rejects.toMatchObject(code("ANNOUNCEMENT_NOT_FOUND"));
    expect(await loadRecord(inventory, "project", PROJECT.a)).toBeNull();
    // Important: the project's people are told (§45).
    const event = await prisma.notificationEventOutbox.findFirstOrThrow({ where: { entityId: id, eventType: "ANNOUNCEMENT_PUBLISHED" } });
    expect((event.payloadJson as { memberIds: string[] }).memberIds).toEqual(expect.arrayContaining([engineer.membershipId, architect.membershipId]));
    expect((event.payloadJson as { memberIds: string[] }).memberIds).not.toContain(inventory.membershipId);
  });

  it("reaches a department's members, its managers, and the exact people named", async () => {
    const department = await published(owner, { audienceType: "DEPARTMENT", departmentId: finance.department!.id });
    expect(await ids(finance, "for_me")).toContain(department);
    expect(await ids(hr, "for_me")).toContain(department);
    expect(await ids(engineer, "for_me")).not.toContain(department);

    const named = await published(owner, { audienceType: "SELECTED_MEMBERS", selectedMemberIds: [engineer.membershipId] });
    expect(await ids(engineer, "for_me")).toContain(named);
    expect(await ids(architect, "for_me")).not.toContain(named);
    expect(await ids(hr, "for_me")).not.toContain(named);
    expect((await getAnnouncement(owner, named)).selectedMembers).toEqual([expect.objectContaining({ memberId: engineer.membershipId })]);
    expect((await getAnnouncement(engineer, named)).selectedMembers).toBeNull();
  });
});

describe("acknowledgment (§14-§16, §46-§50, §135-§140, §159, §306-§308, §312)", () => {
  it("captures targets at publication, takes acknowledgments from each member for themselves, and shows counts only to managers", async () => {
    const id = await published(hr, { priority: "IMPORTANT", requiresAcknowledgment: true, title: "Updated PPE policy" });
    const targets = await prisma.announcementTarget.findMany({ where: { announcementId: id }, select: { memberId: true } });
    expect(targets.map((target) => target.memberId)).toEqual(expect.arrayContaining([engineer.membershipId, architect.membershipId, owner.membershipId]));
    expect(targets.map((target) => target.memberId)).not.toContain(hr.membershipId);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "ANNOUNCEMENT_ACK_REQUIRED" } })).toBe(1);
    expect(await ids(engineer, "acknowledge")).toContain(id);

    const first = await acknowledgeAnnouncement(engineer, id);
    const second = await acknowledgeAnnouncement(engineer, id);
    expect(second.acknowledgedAt).toBe(first.acknowledgedAt);
    expect(await ids(engineer, "acknowledge")).not.toContain(id);
    expect((await getAnnouncement(engineer, id)).acknowledgedAt).toBe(first.acknowledgedAt);

    await expect(announcementMetrics(architect, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(acknowledgmentList(engineer, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const metrics = await announcementMetrics(hr, id);
    expect(metrics).toMatchObject({ audience: targets.length, acknowledged: 1, pending: targets.length - 1, requiresAcknowledgment: true });
    const list = await acknowledgmentList(hr, id);
    expect(list.find((row) => row.memberId === engineer.membershipId)?.acknowledgedAt).toBe(first.acknowledgedAt);
    expect(list.find((row) => row.memberId === architect.membershipId)?.acknowledgedAt).toBeNull();

    await expect(acknowledgeAnnouncement(engineer, await published(owner))).rejects.toMatchObject(code("ANNOUNCEMENT_ACK_NOT_REQUIRED"));
  });

  it("raises attention for the members still to acknowledge and resolves each on acknowledgment", async () => {
    const id = await published(hr, { priority: "IMPORTANT", requiresAcknowledgment: true, title: "Fire drill procedure" });
    await reconcileAttention({ companyId: hr.companyId });
    expect(await prisma.attentionItem.count({ where: { entityId: id, recipientMemberId: architect.membershipId, conditionKey: "ANNOUNCEMENT_ACK_REQUIRED", status: "ACTIVE" } })).toBe(1);
    await acknowledgeAnnouncement(architect, id);
    expect(await prisma.attentionItem.count({ where: { entityId: id, recipientMemberId: architect.membershipId, status: "ACTIVE" } })).toBe(0);
    await reconcileAttention({ companyId: hr.companyId });
    expect(await prisma.attentionItem.count({ where: { entityId: id, recipientMemberId: architect.membershipId, status: "ACTIVE" } })).toBe(0);
    expect(await prisma.attentionItem.count({ where: { entityId: id, recipientMemberId: viewer.membershipId, status: "ACTIVE" } })).toBe(1);
  });

  it("keeps the historical target when somebody leaves the department (§138)", async () => {
    const original = finance.department!.id;
    const id = await published(owner, { audienceType: "DEPARTMENT", departmentId: original, requiresAcknowledgment: true });
    const engineering = await prisma.department.findFirstOrThrow({ where: { companyId: finance.companyId, name: "Engineering" } });
    try {
      await prisma.companyMember.update({ where: { id: finance.membershipId }, data: { departmentId: engineering.id } });
      // Aurelia's Finance department: the group head and Aurelia's own accountant.
      expect((await announcementMetrics(owner, id)).audience).toBe(2);
      expect((await acknowledgmentList(owner, id)).map((row) => row.memberId).sort()).toEqual([finance.membershipId, "member_finance_a"].sort());
    } finally {
      await prisma.companyMember.update({ where: { id: finance.membershipId }, data: { departmentId: original } });
    }
  });

  it("reminds those who have not acknowledged, once per round (§46)", async () => {
    const id = await published(hr, { requiresAcknowledgment: true });
    await acknowledgeAnnouncement(engineer, id);
    const later = new Date(Date.now() + 4 * 86_400_000);
    await runAcknowledgmentReminders(later);
    await runAcknowledgmentReminders(later);
    const reminders = await prisma.notificationEventOutbox.findMany({ where: { entityId: id, eventType: "ANNOUNCEMENT_REMINDER" } });
    expect(reminders).toHaveLength(1);
    const memberIds = (reminders[0].payloadJson as { memberIds: string[] }).memberIds;
    expect(memberIds).toContain(architect.membershipId);
    expect(memberIds).not.toContain(engineer.membershipId);
  });
});

describe("schedule, expiry, pinning, editing and archive (§21-§25, §51-§53, §145-§153, §309, §310)", () => {
  it("publishes a due schedule once, and expires once", async () => {
    const id = await draft(owner, { priority: "IMPORTANT" });
    await expect(scheduleAnnouncement(owner, id, { expectedVersion: 1, publishAt: new Date(Date.now() - 60_000) })).rejects.toMatchObject(code("ANNOUNCEMENT_PUBLISH_AT_PAST"));
    await scheduleAnnouncement(owner, id, { expectedVersion: 1, publishAt: new Date(Date.now() + 60_000) });
    await expect(getAnnouncement(engineer, id)).rejects.toBeTruthy();
    const soon = new Date(Date.now() + 120_000);
    expect((await runAnnouncementSchedule(soon)).published).toBeGreaterThanOrEqual(1);
    await runAnnouncementSchedule(soon);
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "ANNOUNCEMENT_PUBLISHED" } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "ANNOUNCEMENT_PUBLISHED" } })).toBe(1);
    expect(await ids(engineer, "for_me")).toContain(id);

    const brief = await draft(owner, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await publishAnnouncement(owner, brief, { expectedVersion: 1 });
    const after = new Date(Date.now() + 120_000);
    expect((await runAnnouncementSchedule(after)).expired).toBeGreaterThanOrEqual(1);
    await runAnnouncementSchedule(after);
    expect(await prisma.auditEvent.count({ where: { entityId: brief, actionKey: "ANNOUNCEMENT_EXPIRED" } })).toBe(1);
    expect(await ids(engineer, "for_me")).not.toContain(brief);
    expect(await ids(engineer, "history")).toContain(brief);
    expect((await getAnnouncement(owner, brief)).capabilities.canEdit).toBe(false);

    const back = await draft(owner);
    await scheduleAnnouncement(owner, back, { expectedVersion: 1, publishAt: new Date(Date.now() + 3_600_000) });
    await unscheduleAnnouncement(owner, back, { expectedVersion: 2 });
    expect((await getAnnouncement(owner, back)).status).toBe("DRAFT");
  });

  it("keeps at most three pinned per audience", async () => {
    const [a, b, c] = [await published(owner), await published(owner), await published(owner)];
    await setPinned(owner, a, true, { expectedVersion: await version(a) });
    await setPinned(owner, b, true, { expectedVersion: await version(b) });
    await expect(setPinned(owner, c, true, { expectedVersion: await version(c) })).rejects.toMatchObject(code("ANNOUNCEMENT_PIN_LIMIT"));
    const items = (await feed(engineer, "pinned")).items.map((item) => item.id);
    expect(items).toEqual(expect.arrayContaining([ANNOUNCEMENT_SEED.company, a, b]));
    await expect(setPinned(engineer, a, false, { expectedVersion: await version(a) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("corrects a published announcement but keeps its audience, and its content once acknowledged", async () => {
    const id = await published(owner, { requiresAcknowledgment: true });
    const base = { title: "Site induction refresh", body: "Everyone completes the new induction by Friday.", priority: "NORMAL", audienceType: "COMPANY", requiresAcknowledgment: true };
    await updateAnnouncement(owner, id, updateAnnouncementSchema.parse({ ...base, expectedVersion: await version(id), body: "Everyone completes the new induction by **Thursday**." }));
    expect((await getAnnouncement(engineer, id)).edited).toBe(true);
    await expect(updateAnnouncement(owner, id, updateAnnouncementSchema.parse({ ...base, expectedVersion: await version(id), audienceType: "SELECTED_MEMBERS", selectedMemberIds: [engineer.membershipId] }))).rejects.toMatchObject(code("ANNOUNCEMENT_AUDIENCE_LOCKED"));
    await expect(updateAnnouncement(owner, id, updateAnnouncementSchema.parse({ ...base, expectedVersion: 1 }))).rejects.toMatchObject(code("ANNOUNCEMENT_STALE"));
    await acknowledgeAnnouncement(engineer, id);
    await expect(updateAnnouncement(owner, id, updateAnnouncementSchema.parse({ ...base, expectedVersion: await version(id), title: "Changed after acknowledgment" }))).rejects.toMatchObject(code("ANNOUNCEMENT_ACKNOWLEDGED_LOCKED"));
    await expect(updateAnnouncement(engineer, id, updateAnnouncementSchema.parse({ ...base, expectedVersion: await version(id) }))).rejects.toMatchObject({ code: "FORBIDDEN" });

    const copy = await duplicateAnnouncement(owner, id);
    expect(await getAnnouncement(owner, copy.id)).toMatchObject({ status: "DRAFT", title: "Site induction refresh", requiresAcknowledgment: true, acknowledgedAt: null });
  });

  it("archives out of every feed, leaving it with its managers", async () => {
    const id = await published(owner);
    await archiveAnnouncement(owner, id, { expectedVersion: await version(id) });
    expect(await ids(engineer, "history")).not.toContain(id);
    await expect(getAnnouncement(engineer, id)).rejects.toMatchObject(code("ANNOUNCEMENT_NOT_FOUND"));
    expect((await getAnnouncement(owner, id)).status).toBe("ARCHIVED");
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "ANNOUNCEMENT_ARCHIVED" } })).toBe(1);
  });
});

describe("critical notices, calendar, search, documents and dashboard (§27, §37-§45, §65-§68, §125, §311-§314)", () => {
  it("sends a critical notice to everyone addressed whatever their preferences, and shows one banner until acknowledged", async () => {
    const id = await published(owner, { priority: "CRITICAL", requiresAcknowledgment: true, title: "Site closed: gas leak on Riverside" });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "ANNOUNCEMENT_CRITICAL" } })).toBe(1);
    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityId: id, recipientMemberId: engineer.membershipId, eventType: "ANNOUNCEMENT_CRITICAL" } })).toBe(1);
    expect((await criticalAnnouncementBanner(engineer))).toMatchObject({ id, requiresAcknowledgment: true });
    expect((await dashboardAnnouncements(engineer))[0].id).toBe(id);
    await markRead(engineer, id);
    expect((await criticalAnnouncementBanner(engineer))?.id).toBe(id);
    await acknowledgeAnnouncement(engineer, id);
    expect((await criticalAnnouncementBanner(engineer))?.id).not.toBe(id);
    expect((await criticalAnnouncementBanner(ownerB))).toBeNull();
  });

  it("the shell reads one banner row and no unread count (NAV-02 S11)", async () => {
    await published(owner, { priority: "CRITICAL", requiresAcknowledgment: true, title: "Evacuation drill at noon" });
    const count = vi.spyOn(app.announcement, "count");
    const findFirst = vi.spyOn(app.announcement, "findFirst");
    try {
      expect(await criticalAnnouncementBanner(engineer)).not.toBeNull();
      expect(count).not.toHaveBeenCalled();
      expect(findFirst).toHaveBeenCalledTimes(1);
    } finally {
      count.mockRestore();
      findFirst.mockRestore();
    }
  });

  it("a critical notice that asks nothing stops being the banner once it is read (NAV-02 S13)", async () => {
    const id = await published(owner, { priority: "CRITICAL", requiresAcknowledgment: false, title: "Crane inspection today" });
    expect((await criticalAnnouncementBanner(engineer))?.id).toBe(id);
    await markRead(engineer, id);
    expect((await criticalAnnouncementBanner(engineer))?.id).not.toBe(id);
  });

  it("between two critical notices published at the same moment, every instance shows the same one (NAV-02 S16)", async () => {
    const first = await published(owner, { priority: "CRITICAL", requiresAcknowledgment: true, title: "Tower crane out of service" });
    const second = await published(owner, { priority: "CRITICAL", requiresAcknowledgment: true, title: "Site gate B closed" });
    const moment = new Date();
    await prisma.announcement.updateMany({ where: { id: { in: [first, second] } }, data: { publishedAt: moment } });
    const expected = [first, second].sort().at(-1);
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await criticalAnnouncementBanner(engineer))?.id).toBe(expected);
  });

  it("puts only event-dated announcements on the calendar of their audience", async () => {
    const start = new Date(Date.now() + 2 * 86_400_000);
    const dated = await published(pm, { audienceType: "PROJECT", projectId: PROJECT.a, eventStartsAt: start.toISOString(), eventEndsAt: new Date(start.getTime() + 3_600_000).toISOString() });
    const undated = await published(pm, { audienceType: "PROJECT", projectId: PROJECT.a });
    const range = { from: new Date(Date.now()), to: new Date(Date.now() + 4 * 86_400_000) };
    const events = await announcementCalendarProvider.getEvents({ context: engineer, range, filters: {}, timezone: "Europe/Tirane" });
    expect(events.find((event) => event.sourceId === dated)).toMatchObject({ category: "COMPANY", href: `/announcements/${dated}`, allDay: false });
    expect(events.some((event) => event.sourceId === undated)).toBe(false);
    expect((await announcementCalendarProvider.getEvents({ context: inventory, range, filters: {}, timezone: "Europe/Tirane" })).some((event) => event.sourceId === dated)).toBe(false);
  });

  it("finds announcements only within the reader's audience", async () => {
    await published(pm, { audienceType: "PROJECT", projectId: PROJECT.a, title: "Scaffold tagging blitz", body: "Every scaffold on Riverside gets a fresh tag." });
    expect((await globalSearch(engineer, "Scaffold tagging")).results.some((result) => result.entityType === "announcement")).toBe(true);
    expect((await globalSearch(inventory, "Scaffold tagging")).results.some((result) => result.entityType === "announcement")).toBe(false);
    expect((await globalSearch(ownerB, "Scaffold tagging")).results.some((result) => result.entityType === "announcement")).toBe(false);
  });

  it("takes attachments from its managers while it is live, and never from readers", async () => {
    const id = await draft(owner);
    const ref = (announcementId: string) => ({ projectId: null, clientId: null, module: "announcements", entityType: "announcement", entityId: announcementId });
    expect(await canAttachToDocumentParent(owner, ref(id))).toBe(true);
    await publishAnnouncement(owner, id, { expectedVersion: 1 });
    expect(await canAttachToDocumentParent(owner, ref(id))).toBe(true);
    expect(await canAttachToDocumentParent(engineer, ref(id))).toBe(false);
    expect(await canAttachToDocumentParent(pm, ref(id))).toBe(false);
    expect(await loadRecord(engineer, "announcement", id)).toMatchObject({ href: `/announcements/${id}` });
    expect(await loadRecord(ownerB, "announcement", id)).toBeNull();
  });
});
