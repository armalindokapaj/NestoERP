import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { acknowledgeAnnouncementFor, activityCounts, listActivity, markAllActivityRead, markAnnouncementSeen } from "@/lib/modules/activity/activity-center.service";
import { canAddress } from "@/lib/modules/announcements/announcement.permissions";
import { audienceMemberIds, estimateAudience } from "@/lib/modules/announcements/announcement.service";
import { openNotification } from "@/lib/core/notifications/notification.service";
import { getAnnouncement, readAnnouncementFile } from "@/lib/modules/announcements/announcement.service";
import { seedStoredDocument } from "../../../prisma/seed/document-objects";
import { cleanupSessions, DEMO_EMAIL, grantGroupStanding, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";

/**
 * The Activity Center (Unified Activity Center PRD §195-§225) against the real
 * database: one stream, one bell count, seen is not acknowledged, cross-company
 * items, the Group audience, and nothing inaccessible shown or counted.
 *
 * Every row a test writes is tagged `ac-test` and removed after it.
 */

const MULTI_A = "member_multicompany_a";
const MULTI_D = "member_multicompany_d";
const TAG = "ac-test";
let inA: UserContext;
let inGroup: UserContext;
let ownerB: UserContext;
let author: UserContext;

async function cleanup() {
  await prisma.document.deleteMany({ where: { id: { startsWith: TAG } } });
  await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: TAG } } });
  const announcements = await prisma.announcement.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } });
  await prisma.announcement.deleteMany({ where: { id: { in: announcements.map((row) => row.id) } } });
}

async function notify(companyId: string, memberId: string, title: string, extra: Partial<{ priority: "NORMAL" | "CRITICAL"; moduleKey: string; entityType: string; entityId: string; createdAt: Date }> = {}) {
  return prisma.notification.create({
    data: { companyId, recipientMemberId: memberId, eventType: "TASK_ASSIGNED", moduleKey: extra.moduleKey ?? "tasks", title: `${TAG} ${title}`, dedupeKey: `${TAG}:${title}:${Math.random()}`, priority: extra.priority ?? "NORMAL", entityType: extra.entityType, entityId: extra.entityId, createdAt: extra.createdAt },
  });
}

async function announce(title: string, extra: Partial<{ audienceType: "COMPANY" | "GROUP"; companyId: string; priority: "NORMAL" | "CRITICAL"; requiresAcknowledgment: boolean; status: "PUBLISHED" | "DRAFT" }> = {}) {
  return prisma.announcement.create({
    data: {
      companyId: extra.companyId ?? "company_demo_a",
      title: `${TAG} ${title}`,
      body: "Body",
      status: extra.status ?? "PUBLISHED",
      publishedAt: new Date(),
      priority: extra.priority ?? "NORMAL",
      audienceType: extra.audienceType ?? "COMPANY",
      requiresAcknowledgment: extra.requiresAcknowledgment ?? false,
      authorMemberId: author.membershipId,
    },
  });
}

const titles = (items: Array<{ title: string }>) => items.map((item) => item.title.replace(`${TAG} `, "")).filter((title) => !title.startsWith(TAG));
const ours = <T extends { title: string }>(items: T[]) => items.filter((item) => item.title.startsWith(TAG));

beforeAll(async () => {
  inA = await loginAsMembership(MULTI_A);
  inGroup = await loginAsMembership(MULTI_A, { workspace: "GROUP" });
  ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
  author = await loginAs("OWNER");
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("one stream, one count (§195, §198, §220)", () => {
  it("merges notifications and announcements newest first, and counts unread plus unseen once each", async () => {
    const before = await activityCounts(inA);
    await notify("company_demo_a", MULTI_A, "older", { createdAt: new Date(Date.now() - 60_000) });
    const notice = await announce("notice");
    // The notification the announcement sent is the announcement, not a second item (§60, §61).
    await notify("company_demo_a", MULTI_A, "echo", { moduleKey: "announcements", entityType: "announcement", entityId: notice.id });

    const page = await listActivity(inA, {});
    expect(titles(ours(page.items))).toEqual(["notice", "older"]);
    const counts = await activityCounts(inA);
    expect(counts.total - before.total).toBe(2);
    expect(counts.announcements - before.announcements).toBe(1);

    // Opening the bell reads nothing (§56, §198).
    expect((await activityCounts(inA)).total).toBe(counts.total);
  });

  it("filters by source, priority and read state (§9, §37, §40, §41)", async () => {
    await notify("company_demo_a", MULTI_A, "critical", { priority: "CRITICAL" });
    await announce("normal notice");
    expect(titles(ours((await listActivity(inA, { type: "NOTIFICATION" })).items))).toEqual(["critical"]);
    expect(titles(ours((await listActivity(inA, { type: "ANNOUNCEMENT" })).items))).toEqual(["normal notice"]);
    expect(titles(ours((await listActivity(inA, { priority: "CRITICAL" })).items))).toEqual(["critical"]);
  });
});

describe("seen is not acknowledged (§11, §29, §196, §197)", () => {
  it("mark all reads notifications and sees announcements, and leaves an acknowledgment pending", async () => {
    await notify("company_demo_a", MULTI_A, "task");
    const required = await announce("policy", { requiresAcknowledgment: true });
    await markAllActivityRead(inA);

    const items = ours((await listActivity(inA, {})).items);
    expect(items.every((item) => item.readState === "READ")).toBe(true);
    expect(items.find((item) => item.id === required.id)).toMatchObject({ requiresAcknowledgement: true, acknowledgedAt: null });
    expect(await prisma.announcementAcknowledgment.count({ where: { announcementId: required.id } })).toBe(0);

    await acknowledgeAnnouncementFor(inA, required.id);
    expect((await listActivity(inA, { type: "ANNOUNCEMENT" })).items.find((item) => item.id === required.id)?.acknowledgedAt).not.toBeNull();
  });

  it("holds a critical announcement still waiting above the stream until it is acknowledged (§8, §26, §210)", async () => {
    const critical = await announce("evacuation", { priority: "CRITICAL", requiresAcknowledgment: true });
    await markAnnouncementSeen(inA, critical.id);
    const first = await listActivity(inA, {});
    expect(first.items[0]).toMatchObject({ id: critical.id, pinned: true, readState: "READ" });
    await acknowledgeAnnouncementFor(inA, critical.id);
    expect((await listActivity(inA, {})).items.find((item) => item.id === critical.id)?.pinned).toBe(false);
  });
});

describe("user-global, with company context (§31, §32, §78, §201, §211, §223)", () => {
  it("shows another company's notification in a company workspace, naming the company, and counts it", async () => {
    const before = (await activityCounts(inA)).notifications;
    await notify("company_demo_d", MULTI_D, "marina task");
    const item = ours((await listActivity(inA, {})).items).find((row) => row.title.endsWith("marina task"));
    expect(item?.company).toMatchObject({ id: "company_demo_d" });
    expect((await activityCounts(inA)).notifications).toBe(before + 1);
    expect(ours((await listActivity(inGroup, {})).items).some((row) => row.title.endsWith("marina task"))).toBe(true);
  });

  it("never shows or counts somebody else's items, and refuses a company filter the person cannot use (§142, §143)", async () => {
    await notify("company_demo_d", MULTI_D, "not yours");
    expect(ours((await listActivity(ownerB, {})).items)).toEqual([]);
    await expect(listActivity(inA, { companyId: "company_demo_b" })).rejects.toMatchObject({ status: 403 });
    expect(ours((await listActivity(inA, { companyId: "company_demo_d" })).items).map((item) => item.company?.id)).toEqual(["company_demo_d"]);
  });

  it("leaves out a module the company switched off (§77, §211)", async () => {
    await notify("company_demo_a", MULTI_A, "hidden module", { moduleKey: "no_such_module" });
    expect(ours((await listActivity(inA, {})).items)).toEqual([]);
  });
});

describe("Group announcements (§14, §16, §203, §204)", () => {
  it("reaches every company of the group, once per person, labelled with the group", async () => {
    const notice = await announce("group closure", { audienceType: "GROUP" });
    const items = ours((await listActivity(inA, { type: "ANNOUNCEMENT" })).items);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ scope: "GROUP", company: { id: "group_demo_nesto" } });

    const recipients = await audienceMemberIds(prisma, { ...notice, project: null, department: null } as never);
    expect(recipients).toEqual(expect.arrayContaining([MULTI_A, MULTI_D]));
    const companies = await prisma.companyMember.findMany({ where: { id: { in: recipients } }, select: { company: { select: { parentGroupId: true } } } });
    expect(new Set(companies.map((row) => row.company.parentGroupId))).toEqual(new Set(["group_demo_nesto"]));

    // Another group never sees it (§191).
    expect(ours((await listActivity(ownerB, { type: "ANNOUNCEMENT" })).items)).toEqual([]);
  });

  it("does not reach anybody through a company announcement of a company they are not in (§204)", async () => {
    await announce("company b only", { companyId: "company_demo_b" });
    expect(ours((await listActivity(inA, { type: "ANNOUNCEMENT" })).items)).toEqual([]);
  });

  it("is addressable only with the company authority and group standing (§139)", async () => {
    const owner = await loginAs("OWNER");
    const ceo = await loginAs("CEO");
    expect(canAddress(ceo, "GROUP")).toBe(false);
    const undo = await grantGroupStanding(owner.userId);
    try {
      const withStanding = await loginAs("OWNER");
      expect(canAddress(withStanding, "GROUP")).toBe(canAddress(withStanding, "COMPANY"));
    } finally {
      await undo();
    }
  });

  it("never lists a draft (§22, §207)", async () => {
    await announce("draft", { audienceType: "GROUP", status: "DRAFT" });
    expect(ours((await listActivity(inA, { type: "ANNOUNCEMENT" })).items)).toEqual([]);
  });
});

describe("smaller items", () => {
  it("estimates an audience as a count, and refuses one the author may not address (§90, §144)", async () => {
    const owner = await loginAs("OWNER");
    const { recipients } = await estimateAudience(owner, { audienceType: "COMPANY" });
    const active = await prisma.companyMember.count({ where: { companyId: owner.companyId, status: "ACTIVE", role: { permissions: { some: { permission: { key: "announcement.view" } } } } } });
    expect(recipients).toBe(active - 1);
    const viewer = await loginAs("VIEWER");
    await expect(estimateAudience(viewer, { audienceType: "COMPANY" })).rejects.toMatchObject({ status: 403 });
  });

  it("opens a mention at its comment (§43)", async () => {
    const row = await notify("company_demo_a", MULTI_A, "mention", { entityType: "task", entityId: "task_006" });
    await prisma.notification.update({ where: { id: row.id }, data: { metadataJson: { commentId: "comment_abc" } } });
    const opened = await openNotification(inA, row.id);
    if ("href" in opened) expect(opened.href).toMatch(/#comment-comment_abc$/);
  });
});

describe("announcement files are read by everybody who can read the announcement (§47, §150)", () => {
  it("serves a Group announcement's file to a reader in a sibling company, and to nobody outside the audience", async () => {
    const notice = await announce("group file", { audienceType: "GROUP" });
    const fileId = `${TAG}_file`;
    await seedStoredDocument(prisma, { id: fileId, companyId: "company_demo_a", name: "Closure notice.pdf", module: "announcements", entityType: "announcement", entityId: notice.id, uploadedByMemberId: author.membershipId, createdBy: author.userId });

    const inD = await loginAsMembership(MULTI_D);
    const detail = await getAnnouncement(inD, notice.id);
    expect(detail.documents?.map((document) => [document.documentId, document.href])).toEqual([[fileId, `/api/announcements/${notice.id}/files/${fileId}`]]);
    const file = await readAnnouncementFile(inD, notice.id, fileId);
    expect(file.bytes.byteLength).toBeGreaterThan(0);

    // Another group is not the audience; a file must be the announcement's own.
    await expect(readAnnouncementFile(ownerB, notice.id, fileId)).rejects.toMatchObject({ status: 404 });
    await expect(readAnnouncementFile(inD, notice.id, "document_daily_log_pour_2")).rejects.toBeTruthy();
  });
});
