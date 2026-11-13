/**
 * Re-dresses the standard demo as Arvela Group, an invented group of
 * companies (see dataset.ts), after the standard seed has run on the demo
 * database.
 *
 * Steps, in order: rewrite the prose every module wrote with the standard
 * names, give the group, companies, projects and people their Arvela
 * identities, add the companies and projects the standard seed has no slot
 * for, start conversations with @mentions on each project, and set how
 * people sign in. Idempotent: run twice, it changes nothing the second time.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { defaultProjectTypeRows } from "../../../config/project-types";
import { DEFAULT_MAX_FILE_BYTES } from "../../../lib/core/storage";
import { GROUP_USERS } from "../demo/users";
import { roleIds, seedCompanyModules, seedDepartmentBranches, syncMemberPlaces, upsertAccount, upsertCompany, upsertMembership } from "../organization-helpers";
import {
  SHOWCASE_COMPANIES,
  SHOWCASE_EMAIL_DOMAIN,
  SHOWCASE_EXTRA_COMPANIES,
  SHOWCASE_EXTRA_PROJECTS,
  SHOWCASE_GROUP,
  SHOWCASE_NEW_PEOPLE,
  SHOWCASE_PEOPLE,
  SHOWCASE_PROJECTS,
  showcaseReplacements,
  usernameOf,
} from "./dataset";
import { SHOWCASE_CONVERSATIONS } from "./conversations";
import { fillShowcase } from "./fill";
import { proseReplacementSql } from "./prose";

/** `temporary`: everyone must choose their own password at first sign-in. `shared`: everyone keeps the demo password. */
export type ShowcaseSignIn = "temporary" | "shared";

const DAY = 86_400_000;
/** How long a temporary password works after a reset. */
const TEMPORARY_DAYS = 30;

export async function applyShowcaseDemo(
  prisma: PrismaClient,
  options: { passwordHash: string; adminPasswordHash: string; signIn: ShowcaseSignIn; now?: Date },
) {
  const now = options.now ?? new Date();
  await removeTestFixtures(prisma);
  await replaceProse(prisma);
  await dressGroupAndCompanies(prisma);
  await dressProjects(prisma);
  await dressPeople(prisma);
  const added = await addCompanies(prisma, options.passwordHash, now);
  await addProjects(prisma);
  const comments = await addConversations(prisma, now);
  const filled = await fillShowcase(prisma, now);
  await syncMemberPlaces(prisma);
  const people = await setSignIn(prisma, options, now);
  return { companies: Object.keys(SHOWCASE_COMPANIES).length + added, projects: Object.keys(SHOWCASE_PROJECTS).length + SHOWCASE_EXTRA_PROJECTS.length, people, comments, filled };
}

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                               */
/* -------------------------------------------------------------------------- */

/** The standard seed's test tenants (other groups, for isolation tests) have no place in a selling demo. */
const FIXTURE_GROUPS = ["group_fixture", "group_fixture_solo"];

async function removeTestFixtures(prisma: PrismaClient) {
  const companies = await prisma.company.findMany({ where: { parentGroupId: { in: FIXTURE_GROUPS } }, select: { id: true } });
  const groups = await prisma.parentGroup.findMany({ where: { id: { in: FIXTURE_GROUPS } }, select: { id: true } });
  if (companies.length === 0 && groups.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`select platform_purge_tenants($1::text[], $2::text[])::text as purged`, companies.map((row) => row.id), groups.map((row) => row.id));
  });
}

/* -------------------------------------------------------------------------- */
/* Prose                                                                       */
/* -------------------------------------------------------------------------- */

/** Every text and JSON column rewritten through the replacements (prose.ts). */
async function replaceProse(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(proseReplacementSql(showcaseReplacements()));
}

/* -------------------------------------------------------------------------- */
/* Identities                                                                  */
/* -------------------------------------------------------------------------- */

async function dressGroupAndCompanies(prisma: PrismaClient) {
  await prisma.parentGroup.update({
    where: { id: SHOWCASE_GROUP.id },
    data: { slug: SHOWCASE_GROUP.slug, name: SHOWCASE_GROUP.name, legalName: SHOWCASE_GROUP.legalName, registrationNumber: SHOWCASE_GROUP.registrationNumber, city: SHOWCASE_GROUP.city, country: SHOWCASE_GROUP.country, isDemo: true },
  });
  for (const company of Object.values(SHOWCASE_COMPANIES)) {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        slug: company.slug, name: company.name, legalName: company.legalName, registrationNumber: company.nipt, taxNumber: company.nipt,
        industry: company.industry, country: SHOWCASE_GROUP.country, address: company.address,
        email: `info@${company.domain}`, phone: null, website: `https://${company.domain}`,
      },
    });
  }
}

async function projectTypeId(prisma: PrismaClient, companyId: string, name: string): Promise<string | null> {
  if ((await prisma.projectType.count({ where: { companyId } })) === 0) {
    await prisma.projectType.createMany({ data: defaultProjectTypeRows(companyId), skipDuplicates: true });
  }
  return (await prisma.projectType.findFirst({ where: { companyId, name }, select: { id: true } }))?.id ?? null;
}

async function dressProjects(prisma: PrismaClient) {
  for (const [id, project] of Object.entries(SHOWCASE_PROJECTS)) {
    const row = await prisma.project.findUniqueOrThrow({ where: { id }, select: { companyId: true } });
    await prisma.project.update({
      where: { id },
      data: {
        name: project.name, code: project.code, description: project.description, address: project.address, city: project.city,
        country: SHOWCASE_GROUP.country, builtArea: project.builtArea, projectTypeId: await projectTypeId(prisma, row.companyId!, project.type),
        isKeyProject: id === "project_a" || id === "project_e",
      },
    });
  }
}

/** The name-shaped sign-in, numbered when two people share a name. */
async function freeUsername(prisma: PrismaClient, userId: string, wanted: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const candidate = attempt === 1 ? wanted : `${wanted}${attempt}`;
    const holder = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!holder || holder.id === userId) return candidate;
  }
}

async function dressPerson(prisma: PrismaClient, userId: string, person: { firstName: string; lastName: string; jobTitle?: string }) {
  const username = userId === "user_admin" ? "platform-admin" : await freeUsername(prisma, userId, usernameOf(person));
  const email = `${username}@${SHOWCASE_EMAIL_DOMAIN}`;
  const user = await prisma.user.update({
    where: { id: userId },
    data: { firstName: person.firstName, lastName: person.lastName, username, email },
    select: { personProfileId: true },
  });
  if (user.personProfileId) {
    await prisma.personProfile.update({
      where: { id: user.personProfileId },
      data: { firstName: person.firstName, lastName: person.lastName, workEmail: email, ...(person.jobTitle ? { jobTitle: person.jobTitle } : {}) },
    });
  }
  if (person.jobTitle) await prisma.companyMember.updateMany({ where: { userId }, data: { jobTitle: person.jobTitle } });
}

async function dressPeople(prisma: PrismaClient) {
  for (const [userId, person] of Object.entries(SHOWCASE_PEOPLE)) await dressPerson(prisma, userId, person);
  // Everyone else keeps their invented name, under the demo's domain and a name-shaped sign-in.
  const others = await prisma.user.findMany({
    where: { id: { notIn: Object.keys(SHOWCASE_PEOPLE) }, OR: [{ memberships: { some: { company: { parentGroupId: SHOWCASE_GROUP.id } } } }, { parentGroupMemberships: { some: { parentGroupId: SHOWCASE_GROUP.id } } }] },
    select: { id: true, firstName: true, lastName: true },
  });
  for (const user of others) await dressPerson(prisma, user.id, user);
}

/* -------------------------------------------------------------------------- */
/* What the standard seed has no slot for                                       */
/* -------------------------------------------------------------------------- */

async function addCompanies(prisma: PrismaClient, passwordHash: string, now: Date): Promise<number> {
  const roles = await roleIds(prisma);
  for (const person of SHOWCASE_NEW_PEOPLE) {
    const username = await freeUsername(prisma, person.id, usernameOf(person));
    await upsertAccount(prisma, { id: person.id, username, email: `${username}@${SHOWCASE_EMAIL_DOMAIN}`, firstName: person.firstName, lastName: person.lastName, jobTitle: person.jobTitle }, { passwordHash, parentGroupId: SHOWCASE_GROUP.id });
  }
  const documentsPlan = await prisma.entitlementPlan.findUnique({ where: { id: "plan_documents" }, select: { id: true } });

  for (const company of SHOWCASE_EXTRA_COMPANIES) {
    await upsertCompany(prisma, {
      id: company.id, parentGroupId: SHOWCASE_GROUP.id, slug: company.slug, name: company.name, legalName: company.legalName,
      registrationNumber: company.nipt, taxNumber: company.nipt, industry: company.industry, country: SHOWCASE_GROUP.country, address: company.address,
      email: `info@${company.domain}`, phone: null, website: `https://${company.domain}`, status: "ACTIVE",
    });
    await seedCompanyModules(prisma, company.id);
    await prisma.projectType.createMany({ data: defaultProjectTypeRows(company.id), skipDuplicates: true });
    await prisma.companySettings.upsert({ where: { companyId: company.id }, update: {}, create: { companyId: company.id, timezone: "Europe/Tirane", baseCurrency: "EUR" } });
    await prisma.companyStorageQuota.upsert({ where: { companyId: company.id }, update: {}, create: { companyId: company.id, maxStorageBytes: null, maxSingleFileBytes: BigInt(DEFAULT_MAX_FILE_BYTES) } });
    if (company.documentsOnly && documentsPlan) {
      await prisma.companyEntitlement.upsert({ where: { companyId: company.id }, update: { planId: documentsPlan.id }, create: { companyId: company.id, planId: documentsPlan.id } });
    }
    const branches = await seedDepartmentBranches(prisma, company.id, SHOWCASE_GROUP.id);
    const suffix = company.slug.replace(/-/g, "_");

    // The group's own people work in every company of it, as they do in the standard five.
    for (const user of GROUP_USERS) {
      await upsertMembership(prisma, {
        id: `member_${user.id.replace(/^user_/, "")}__${suffix}`, companyId: company.id, userId: user.id, role: user.role, roleId: roles,
        departmentId: user.department ? (branches.get(user.department) ?? null) : null, jobTitle: SHOWCASE_PEOPLE[user.id]?.jobTitle ?? user.jobTitle, createdAt: new Date(now.getTime() - 300 * DAY),
      });
    }
    if (company.head) {
      const head = await prisma.user.findUniqueOrThrow({ where: { id: company.head }, select: { id: true } });
      await upsertMembership(prisma, {
        id: `member_${head.id.replace(/^user_/, "")}__${suffix}`, companyId: company.id, userId: head.id, role: "CEO", roleId: roles,
        departmentId: branches.get("executive") ?? null, jobTitle: SHOWCASE_NEW_PEOPLE.find((person) => person.id === head.id)?.jobTitle ?? "Chief Executive Officer", createdAt: new Date(now.getTime() - 300 * DAY),
      });
    }
    await prisma.companyMember.updateMany({ where: { companyId: company.id, joinedAt: null }, data: { joinedAt: new Date(now.getTime() - 300 * DAY) } });
  }
  return SHOWCASE_EXTRA_COMPANIES.length;
}

async function addProjects(prisma: PrismaClient) {
  for (const project of SHOWCASE_EXTRA_PROJECTS) {
    const manager = await prisma.companyMember.findFirst({ where: { companyId: project.companyId, userId: "user_pm_b" }, select: { id: true } });
    const data = {
      companyId: project.companyId, code: project.code, name: project.name, description: project.description, status: project.status,
      address: project.address, city: project.city, country: SHOWCASE_GROUP.country, builtArea: project.builtArea,
      projectTypeId: await projectTypeId(prisma, project.companyId, project.type), projectManagerMemberId: manager?.id ?? null, createdBy: "user_pm_b",
    } satisfies Prisma.ProjectUncheckedCreateInput;
    await prisma.project.upsert({ where: { id: project.id }, update: data, create: { id: project.id, ...data } });
  }
}

/* -------------------------------------------------------------------------- */
/* Conversations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A thread on each project: people writing to each other and @mentioning
 * colleagues, in the platform's own mention markup, so the demo opens on a
 * group already at work. Deterministic ids: a rerun replaces nothing.
 */
async function addConversations(prisma: PrismaClient, now: Date): Promise<number> {
  let written = 0;
  for (const conversation of SHOWCASE_CONVERSATIONS) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: conversation.projectId }, select: { companyId: true } });
    const companyId = project.companyId!;
    const memberOf = async (userId: string) => {
      const member = await prisma.companyMember.findFirst({ where: { companyId, userId, status: "ACTIVE" }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
      if (!member) throw new Error(`Showcase demo: ${userId} has no membership in ${companyId}.`);
      return { id: member.id, name: `${member.user.firstName} ${member.user.lastName}` };
    };
    const threadId = `thread_showcase_${conversation.projectId}`;
    const last = new Date(now.getTime() - conversation.comments[conversation.comments.length - 1].daysAgo * DAY);
    await prisma.collaborationThread.upsert({
      where: { id: threadId },
      update: { commentCount: conversation.comments.length, lastCommentAt: last },
      create: { id: threadId, companyId, parentType: "project", parentId: conversation.projectId, commentCount: conversation.comments.length, lastCommentAt: last },
    });
    for (const [index, comment] of conversation.comments.entries()) {
      const author = await memberOf(comment.author);
      const mentioned = await Promise.all(comment.mentions.map(memberOf));
      // "{0}" in the text is the first person mentioned, "{1}" the second, as the editor writes them.
      const body = comment.text.replace(/\{(\d)\}/g, (_whole, at: string) => {
        const person = mentioned[Number(at)];
        return `@[${person.name}](${person.id})`;
      });
      const id = `comment_showcase_${conversation.projectId}_${index + 1}`;
      const createdAt = new Date(now.getTime() - comment.daysAgo * DAY);
      await prisma.comment.upsert({ where: { id }, update: { body }, create: { id, companyId, threadId, authorMemberId: author.id, body, createdAt } });
      for (const person of mentioned) {
        await prisma.mention.upsert({
          where: { commentId_mentionedMemberId: { commentId: id, mentionedMemberId: person.id } },
          update: {},
          create: { companyId, commentId: id, mentionedMemberId: person.id, createdAt },
        });
      }
      written += 1;
    }
  }
  return written;
}

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everyone in the demo group, and the demo's Platform Admin, as the owner chose
 * (2026-11-13: temporary passwords). The Platform Admin's password is a secret
 * of its own, so a prospect given the demo password cannot become them.
 */
async function setSignIn(prisma: PrismaClient, options: { passwordHash: string; adminPasswordHash: string; signIn: ShowcaseSignIn }, now: Date): Promise<number> {
  const temporary = options.signIn === "temporary";
  const expires = temporary ? new Date(now.getTime() + TEMPORARY_DAYS * DAY) : null;
  const people = await prisma.user.updateMany({
    where: { id: { not: "user_admin" }, OR: [{ memberships: { some: { company: { parentGroupId: SHOWCASE_GROUP.id } } } }, { parentGroupMemberships: { some: { parentGroupId: SHOWCASE_GROUP.id } } }] },
    data: { passwordHash: options.passwordHash, mustChangePassword: temporary, temporaryPasswordExpiresAt: expires, passwordChangedAt: now },
  });
  await prisma.user.update({
    where: { id: "user_admin" },
    data: { passwordHash: options.adminPasswordHash, mustChangePassword: true, temporaryPasswordExpiresAt: new Date(now.getTime() + TEMPORARY_DAYS * DAY), passwordChangedAt: now },
  });
  return people.count;
}
