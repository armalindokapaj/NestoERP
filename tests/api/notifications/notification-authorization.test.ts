import { afterAll, afterEach, describe, expect, it } from "vitest";

import { attentionConditionDefinitions, readerAllowed } from "@/lib/core/notifications/attention.conditions";
import { countReadableAttention, listReadableAttention } from "@/lib/core/notifications/attention.service";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent, getUnreadCount, listNotifications } from "@/lib/core/notifications/notification.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * Notification and attention authorisation (PRD #47 §26, §74, §77, §78, §175).
 *
 * A notification or an attention item is a note about a record, written at one
 * moment. These tests hold the read side to current access: a discussion
 * message reaches only people its thread admits, counts and lists drop what the
 * reader can no longer open, and a condition about another module's work asks
 * for that module's grant.
 */

const TEST_CONDITION = "AUTHZ_TEST_CONDITION";
const outboxIds: string[] = [];
const dedupePrefixes: string[] = [];
const attentionIds: string[] = [];
const notificationIds: string[] = [];

afterEach(async () => {
  if (outboxIds.length > 0) await prisma.notificationEventOutbox.deleteMany({ where: { id: { in: outboxIds } } });
  for (const prefix of dedupePrefixes) await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: prefix } } });
  if (attentionIds.length > 0) await prisma.attentionItem.deleteMany({ where: { id: { in: attentionIds } } });
  if (notificationIds.length > 0) await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
  outboxIds.length = 0;
  dedupePrefixes.length = 0;
  attentionIds.length = 0;
  notificationIds.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const unique = () => `authz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Enqueues one event and drains the outbox until that event has been settled. */
async function dispatchEvent(input: Parameters<typeof enqueueNotificationEvent>[1]) {
  await prisma.$transaction((tx) => enqueueNotificationEvent(tx, input));
  const row = await prisma.notificationEventOutbox.findFirstOrThrow({
    where: { companyId: input.companyId, eventType: input.eventType, entityId: input.entityId, payloadJson: { path: ["commentId"], equals: input.payload.commentId as string } },
    select: { id: true },
  });
  outboxIds.push(row.id);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
    if (current.status === "PROCESSED" || current.status === "FAILED") return current.status;
    await dispatchNotifications();
  }
  throw new Error("The test event was never dispatched.");
}

async function addAttention(context: Awaited<ReturnType<typeof loginAs>>, input: { conditionKey?: string; moduleKey: string; entityType: string; entityId: string }) {
  const row = await prisma.attentionItem.create({
    data: {
      companyId: context.companyId,
      recipientMemberId: context.membershipId,
      conditionKey: input.conditionKey ?? TEST_CONDITION,
      moduleKey: input.moduleKey,
      entityType: input.entityType,
      entityId: input.entityId,
      title: "Authorization fixture",
      // Most urgent first, so the fixture always sits inside the counted window.
      priority: "CRITICAL",
      dedupeKey: unique(),
    },
    select: { id: true },
  });
  attentionIds.push(row.id);
  return row.id;
}

describe("discussion notifications follow the thread's own requirements (PRD #38 §28, PRD #47 §78)", () => {
  it("does not tell a reader of an employee record about its HR discussion unless they manage employee records", async () => {
    const owner = await loginAs("OWNER");
    const hr = await loginAs("HR");
    // The CEO reads every employee record but does not hold hr.employee.update.
    const ceo = await loginAs("CEO");
    const commentId = unique();
    dedupePrefixes.push(`COMMENT_MENTIONED:${commentId}:`);

    const status = await dispatchEvent({
      companyId: owner.companyId,
      eventType: NotificationEvent.COMMENT_MENTIONED,
      moduleKey: "hr",
      entityType: "employee",
      entityId: "member_engineer",
      actorMemberId: owner.membershipId,
      payload: { commentId, recordLabel: "Employee record", actorName: "Owner", preview: "confidential", mentionedMemberIds: [hr.membershipId, ceo.membershipId] },
    });
    expect(status).toBe("PROCESSED");

    const recipients = (await prisma.notification.findMany({ where: { dedupeKey: { startsWith: `COMMENT_MENTIONED:${commentId}:` } }, select: { recipientMemberId: true } })).map((row) => row.recipientMemberId);
    expect(recipients).toContain(hr.membershipId);
    expect(recipients).not.toContain(ceo.membershipId);
  });

  it("tells nobody about a discussion on a record type that has none", async () => {
    const owner = await loginAs("OWNER");
    const hr = await loginAs("HR");
    const leave = await prisma.leaveRequest.findFirstOrThrow({ where: { companyId: owner.companyId }, select: { id: true } });
    const commentId = unique();
    dedupePrefixes.push(`COMMENT_REPLY:${commentId}:`);

    await dispatchEvent({
      companyId: owner.companyId,
      eventType: NotificationEvent.COMMENT_REPLY,
      moduleKey: "hr",
      entityType: "leave_request",
      entityId: leave.id,
      actorMemberId: owner.membershipId,
      payload: { commentId, recordLabel: "Leave request", actorName: "Owner", preview: "reply", replyToAuthorMemberId: hr.membershipId },
    });

    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `COMMENT_REPLY:${commentId}:` } } })).toBe(0);
  });
});

describe("attention is served and counted from what the reader can open (PRD #47 §77, §175)", () => {
  it("leaves out, and does not count, items whose record the reader cannot open", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const before = await countReadableAttention(pm);

    const readable = await addAttention(pm, { moduleKey: "projects", entityType: "project", entityId: PROJECT.a });
    // A project the manager is not on, and an invoice their role cannot read.
    const foreignProject = await addAttention(pm, { moduleKey: "projects", entityType: "project", entityId: PROJECT.c });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { companyId: pm.companyId }, select: { id: true } });
    const unreadableInvoice = await addAttention(pm, { moduleKey: "finance", entityType: "invoice", entityId: invoice.id });

    const after = await countReadableAttention(pm);
    expect(after.active - before.active).toBe(1);
    expect(after.critical - before.critical).toBe(1);
    expect((await getUnreadCount(pm)).activeAttention).toBe(after.active);

    const listed = (await listReadableAttention(pm, 100)).map((item) => item.id);
    expect(listed).toContain(readable);
    expect(listed).not.toContain(foreignProject);
    expect(listed).not.toContain(unreadableInvoice);
  });

  it("does not count or list a notification from a module the reader cannot open", async () => {
    const engineer = await loginAs("ENGINEER");
    const before = await getUnreadCount(engineer);

    const make = async (moduleKey: string) => {
      const row = await prisma.notification.create({
        data: {
          companyId: engineer.companyId,
          recipientMemberId: engineer.membershipId,
          eventType: "AUTHZ_TEST",
          moduleKey,
          title: "Authorization fixture",
          priority: "CRITICAL",
          dedupeKey: unique(),
        },
        select: { id: true },
      });
      notificationIds.push(row.id);
      return row.id;
    };
    const open = await make("tasks");
    // Engineers have no Sales access at all.
    const closed = await make("sales");

    const after = await getUnreadCount(engineer);
    expect(after.unread - before.unread).toBe(1);
    expect(after.criticalUnread - before.criticalUnread).toBe(1);

    const listed = (await listNotifications(engineer, { limit: 100 })).data.map((item) => item.id);
    expect(listed).toContain(open);
    expect(listed).not.toContain(closed);
  });
});

describe("a missing daily log asks for the Daily Logs grant, not just the project (PRD #43 §103, PRD #47 §26)", () => {
  it("keeps the item from somebody who can open the project but not read its logs", async () => {
    const condition = attentionConditionDefinitions().find((row) => row.key === "DAILY_LOG_MISSING")!;
    const finance = await loginAs("FINANCE");
    const pm = await loginAs("PROJECT_MANAGER");

    expect(readerAllowed(finance, condition)).toBe(false);
    expect(readerAllowed(pm, condition)).toBe(true);

    const financeBefore = await countReadableAttention(finance);
    const pmBefore = await countReadableAttention(pm);
    await addAttention(finance, { conditionKey: "DAILY_LOG_MISSING", moduleKey: "projects", entityType: "project", entityId: PROJECT.a });
    await addAttention(pm, { conditionKey: "DAILY_LOG_MISSING", moduleKey: "projects", entityType: "project", entityId: PROJECT.a });

    expect((await countReadableAttention(finance)).active).toBe(financeBefore.active);
    expect((await countReadableAttention(pm)).active).toBe(pmBefore.active + 1);
  });
});
