import type { PrismaClient } from "@prisma/client";
import type { SeedMembers } from "./constants";

/**
 * Announcements, favorites and recent work demo data (PRD #45 §348).
 *
 * Company A: a pinned company announcement, an important Riverside project
 * notice with a dated crane lift, a Finance department timetable, an office
 * closure scheduled for later, and a site access policy update that asks the
 * company to acknowledge it — some have, some have read it, some have not.
 * The Engineer and Project Manager have a few favorites and recent records.
 * Company B has one announcement, for isolation. Dated relative to the day
 * the seed runs; re-running replaces the seeded rows.
 */
type Members = SeedMembers;

const COMPANY_A = "company_demo_a";
const FIXTURE_TENANT = "company_fixture_tenant";

export const ANNOUNCEMENT_SEED = {
  company: "announcement_company_welcome",
  project: "announcement_riverside_crane",
  department: "announcement_finance_close",
  scheduled: "announcement_office_closure",
  policy: "announcement_site_access_policy",
  companyB: "announcement_b_kickoff",
} as const;

export async function seedAnnouncementRecords(prisma: PrismaClient, members: Members) {
  const id = (key: string) => members.get(key)!;
  const owner = id("user_owner");
  const pm = id("user_pm");
  const hr = id("user_hr");
  const engineer = id("user_engineer");
  const now = Date.now();
  const days = (offset: number, hour = 9) => {
    const date = new Date(now + offset * 86_400_000);
    date.setUTCHours(hour, 0, 0, 0);
    return date;
  };
  const ids = Object.values(ANNOUNCEMENT_SEED);

  await prisma.attentionItem.deleteMany({ where: { entityType: "announcement", entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityType: "announcement", entityId: { in: ids } } });
  // Reminder rounds are claimed as `<announcement>:<round>`; re-seeded announcements start again.
  await prisma.jobIdempotencyKey.deleteMany({ where: { companyId: COMPANY_A, jobKey: "announcements.reminders", OR: ids.map((announcementId) => ({ key: { startsWith: `${announcementId}:` } })) } });
  await prisma.announcement.deleteMany({ where: { id: { in: ids } } });
  await prisma.productivitySettings.upsert({ where: { companyId: COMPANY_A }, update: {}, create: { companyId: COMPANY_A } });

  const finance = await prisma.department.findFirst({ where: { companyId: COMPANY_A, name: "Finance" }, select: { id: true } });
  const common = { companyId: COMPANY_A, status: "PUBLISHED" as const };

  await prisma.announcement.create({
    data: {
      ...common,
      id: ANNOUNCEMENT_SEED.company,
      title: "Planning, announcements and favorites are live in NESTO",
      body: "Every project now has a **Planning** tab with phases, milestones and a timeline.\n\n## What is new\n\n- Announcements like this one, addressed to the company, a department, a project or named people\n- A star on projects, tasks, meetings and documents you use often\n- Recent work in the search palette — press **Ctrl K**\n\nQuestions go to your project manager or the IT desk.",
      audienceType: "COMPANY",
      authorMemberId: owner,
      publishedByMemberId: owner,
      publishedAt: days(-6),
      pinned: true,
    },
  });
  await prisma.announcement.create({
    data: {
      ...common,
      id: ANNOUNCEMENT_SEED.project,
      title: "Crane lift restrictions on Block B",
      body: "The tower crane is lifting façade panels onto Block B.\n\n> The zone below the lift path is closed while the crane is working.\n\n1. Use the east gate for deliveries\n2. Keep the Block B walkway clear\n3. Report any unplanned lift to the site manager",
      priority: "IMPORTANT",
      audienceType: "PROJECT",
      projectId: "project_a",
      authorMemberId: pm,
      publishedByMemberId: pm,
      publishedAt: days(-1, 7),
      eventStartsAt: days(2, 6),
      eventEndsAt: days(2, 14),
      expiresAt: days(5),
    },
  });
  if (finance) {
    await prisma.announcement.create({
      data: {
        ...common,
        id: ANNOUNCEMENT_SEED.department,
        title: "Month-end close timetable",
        body: "Invoices and expense claims for this month are due by the **25th**. Late submissions move to next month's close.",
        audienceType: "DEPARTMENT",
        departmentId: finance.id,
        authorMemberId: owner,
        publishedByMemberId: owner,
        publishedAt: days(-3),
      },
    });
  }
  await prisma.announcement.create({
    data: {
      companyId: COMPANY_A,
      id: ANNOUNCEMENT_SEED.scheduled,
      status: "SCHEDULED",
      title: "Office closed for the public holiday",
      body: "The head office will be closed for the public holiday. Sites follow their own programme — check with your project manager.",
      priority: "IMPORTANT",
      audienceType: "COMPANY",
      authorMemberId: hr,
      publishAt: days(3, 7),
      eventStartsAt: days(10, 0),
      eventEndsAt: days(10, 23),
    },
  });
  await prisma.announcement.create({
    data: {
      ...common,
      id: ANNOUNCEMENT_SEED.policy,
      title: "Updated site access policy",
      body: "## Summary\n\nFrom next Monday every visitor to a live site signs in at the gate with photo ID, and is escorted at all times.\n\n## What changes for you\n\n1. Book visitors a day ahead\n2. Collect them at the gate\n3. Sign them out when they leave\n\nPlease read the policy and acknowledge below.",
      priority: "IMPORTANT",
      audienceType: "COMPANY",
      authorMemberId: hr,
      publishedByMemberId: hr,
      publishedAt: days(-2),
      requiresAcknowledgment: true,
    },
  });

  // Who was asked when the policy went out, and where each of them stands.
  const audience = await prisma.companyMember.findMany({ where: { companyId: COMPANY_A, status: "ACTIVE", id: { not: hr }, role: { permissions: { some: { permission: { key: "announcement.view" } } } } }, select: { id: true } });
  await prisma.announcementTarget.createMany({ data: audience.map((member) => ({ announcementId: ANNOUNCEMENT_SEED.policy, memberId: member.id, targetedAt: days(-2) })), skipDuplicates: true });
  const acknowledged = [owner, id("user_ceo"), id("user_qaqc")];
  await prisma.announcementAcknowledgment.createMany({ data: acknowledged.map((memberId) => ({ announcementId: ANNOUNCEMENT_SEED.policy, memberId, acknowledgedAt: days(-1, 10) })) });
  await prisma.announcementRead.createMany({
    data: [...acknowledged, id("user_finance")].map((memberId) => ({ announcementId: ANNOUNCEMENT_SEED.policy, memberId, firstReadAt: days(-1, 10), lastReadAt: days(-1, 10) })),
  });
  await prisma.announcementRead.createMany({ data: [owner, pm, engineer].map((memberId) => ({ announcementId: ANNOUNCEMENT_SEED.company, memberId, firstReadAt: days(-5), lastReadAt: days(-5) })) });

  await prisma.announcement.create({
    data: { companyId: FIXTURE_TENANT, id: ANNOUNCEMENT_SEED.companyB, status: "PUBLISHED", title: "Kick-off for the Munich office fit-out", body: "The fit-out starts next week.", audienceType: "COMPANY", authorMemberId: id("user_owner_b"), publishedAt: days(-1) },
  });

  // Personal shortcuts: a few stars and a recent trail for the Engineer and the Project Manager.
  const personal = [engineer, pm];
  await prisma.userFavorite.deleteMany({ where: { memberId: { in: personal } } });
  await prisma.recentItem.deleteMany({ where: { memberId: { in: personal } } });
  await prisma.userFavorite.createMany({
    data: [
      { companyId: COMPANY_A, memberId: engineer, entityType: "project", entityId: "project_a", createdAt: days(-4) },
      { companyId: COMPANY_A, memberId: engineer, entityType: "project_milestone", entityId: "milestone_riverside_structure", createdAt: days(-3) },
      { companyId: COMPANY_A, memberId: engineer, entityType: "task", entityId: "task_006", createdAt: days(-2) },
      { companyId: COMPANY_A, memberId: pm, entityType: "project", entityId: "project_a", createdAt: days(-5) },
      { companyId: COMPANY_A, memberId: pm, entityType: "project_milestone", entityId: "milestone_riverside_roof", createdAt: days(-4) },
    ],
  });
  const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000);
  await prisma.recentItem.createMany({
    data: [
      { companyId: COMPANY_A, memberId: engineer, entityType: "task", entityId: "task_001", lastAccessedAt: hoursAgo(2), accessCount: 3 },
      { companyId: COMPANY_A, memberId: engineer, entityType: "daily_log", entityId: "daily_log_riverside_locked", lastAccessedAt: hoursAgo(5) },
      { companyId: COMPANY_A, memberId: engineer, entityType: "project_milestone", entityId: "milestone_riverside_roof", lastAccessedAt: hoursAgo(26) },
      { companyId: COMPANY_A, memberId: pm, entityType: "project", entityId: "project_a", lastAccessedAt: hoursAgo(1), accessCount: 12 },
      { companyId: COMPANY_A, memberId: pm, entityType: "meeting", entityId: "meeting_riverside_000", lastAccessedAt: hoursAgo(20) },
    ],
  });

  return { announcements: finance ? 6 : 5, targets: audience.length, favorites: 5, recent: 5 };
}
