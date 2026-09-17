import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { addFavorite, FAVORITES_LIMIT, listFavorites, removeFavorite } from "@/lib/modules/productivity/favorites.service";
import { resolveNavigable } from "@/lib/modules/productivity/navigable.registry";
import { clearRecentWork, listRecentWork, pruneRecentWork, RECENT_CAP, recordRecentAccess } from "@/lib/modules/productivity/recent-work.service";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Favorites and Recent Work against the real database (PRD #45 §315-§319).
 *
 * The Architect, Viewer and Finance have no seeded favorites or recent items;
 * everything a test writes for them is removed after it.
 */

let architect: UserContext;
let viewer: UserContext;
let finance: UserContext;
let pm: UserContext;
let ownerB: UserContext;
const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
const TEMPORARY_MILESTONE = "Temporary milestone";

async function cleanup() {
  const memberIds = [architect, viewer, finance, ownerB].map((context) => context.membershipId);
  await prisma.userFavorite.deleteMany({ where: { memberId: { in: memberIds } } });
  await prisma.recentItem.deleteMany({ where: { memberId: { in: memberIds } } });
  await prisma.projectMember.updateMany({ where: { projectId: PROJECT.a, companyMemberId: viewer.membershipId }, data: { status: "ACTIVE" } });
  await prisma.productivitySettings.updateMany({ where: { companyId: "company_demo_a" }, data: { favoritesEnabled: true, recentWorkEnabled: true, recentWorkRetentionDays: 90 } });
  const milestones = await prisma.projectMilestone.findMany({ where: { projectId: PROJECT.a, name: TEMPORARY_MILESTONE }, select: { id: true } });
  await prisma.projectMilestone.deleteMany({ where: { id: { in: milestones.map((row) => row.id) } } });
}

beforeAll(async () => {
  [architect, viewer, finance, pm] = await Promise.all((["ARCHITECT", "VIEWER", "FINANCE", "PROJECT_MANAGER"] as const).map((role) => loginAs(role)));
  ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("favorites (§69-§93, §315)", () => {
  it("adds a record the member can open, once, resolves it and removes it", async () => {
    const added = await addFavorite(architect, { entityType: "project", entityId: PROJECT.a });
    expect(added).toMatchObject({ entityType: "project", title: "Riverside Residences", href: `/projects/${PROJECT.a}` });
    await addFavorite(architect, { entityType: "project", entityId: PROJECT.a });
    expect(await prisma.userFavorite.count({ where: { memberId: architect.membershipId } })).toBe(1);
    await addFavorite(architect, { entityType: "project_milestone", entityId: "milestone_riverside_structure" });
    expect((await listFavorites(architect)).map((item) => item.entityType)).toEqual(["project_milestone", "project"]);
    await removeFavorite(architect, { entityType: "project", entityId: PROJECT.a });
    expect((await listFavorites(architect)).map((item) => item.entityId)).toEqual(["milestone_riverside_structure"]);
  });

  it("refuses records the member cannot open, in this company or another", async () => {
    await expect(addFavorite(architect, { entityType: "project", entityId: PROJECT.b })).rejects.toMatchObject(code("FAVORITE_NOT_FOUND"));
    await expect(addFavorite(architect, { entityType: "project", entityId: PROJECT.companyB })).rejects.toMatchObject(code("FAVORITE_NOT_FOUND"));
    await expect(addFavorite(ownerB, { entityType: "project", entityId: PROJECT.a })).rejects.toMatchObject(code("FAVORITE_NOT_FOUND"));
    await expect(addFavorite(finance, { entityType: "daily_log", entityId: "daily_log_riverside_locked" })).rejects.toMatchObject(code("FAVORITE_NOT_FOUND"));
  });

  it("hides a favorite the moment access is lost, and an archived record with it", async () => {
    await addFavorite(viewer, { entityType: "project", entityId: PROJECT.a });
    await prisma.projectMember.updateMany({ where: { projectId: PROJECT.a, companyMemberId: viewer.membershipId }, data: { status: "INACTIVE" } });
    const refreshed = await loginAs("VIEWER");
    expect(await listFavorites(refreshed)).toEqual([]);
    expect(await prisma.userFavorite.count({ where: { memberId: viewer.membershipId } })).toBe(1);

    const milestone = await prisma.projectMilestone.create({ data: { companyId: "company_demo_a", projectId: PROJECT.a, name: TEMPORARY_MILESTONE, milestoneType: "OTHER", sortOrder: 1, createdByMemberId: pm.membershipId } });
    await prisma.userFavorite.create({ data: { companyId: "company_demo_a", memberId: finance.membershipId, entityType: "project_milestone", entityId: milestone.id } });
    expect((await listFavorites(finance)).map((item) => item.entityId)).toContain(milestone.id);
    await prisma.projectMilestone.update({ where: { id: milestone.id }, data: { archivedAt: new Date() } });
    expect((await listFavorites(finance)).map((item) => item.entityId)).not.toContain(milestone.id);
  });

  it("caps favorites and honours the company switch", async () => {
    await prisma.userFavorite.createMany({ data: Array.from({ length: FAVORITES_LIMIT }, (_, index) => ({ companyId: "company_demo_a", memberId: architect.membershipId, entityType: "task", entityId: `missing_task_${index}` })) });
    await expect(addFavorite(architect, { entityType: "project", entityId: PROJECT.a })).rejects.toMatchObject(code("FAVORITES_LIMIT"));
    await prisma.productivitySettings.updateMany({ where: { companyId: "company_demo_a" }, data: { favoritesEnabled: false } });
    await expect(addFavorite(viewer, { entityType: "project", entityId: PROJECT.a })).rejects.toMatchObject(code("FAVORITES_DISABLED"));
    expect(await listFavorites(architect)).toEqual([]);
  });
});

describe("recent work (§94-§115, §316)", () => {
  it("records meaningful access at most every ten minutes, newest first, only for records the member can open", async () => {
    const now = new Date();
    expect(await recordRecentAccess(architect, "task", "task_004", { now })).toBe(true);
    expect(await recordRecentAccess(architect, "task", "task_004", { now: new Date(now.getTime() + 60_000) })).toBe(false);
    expect(await recordRecentAccess(architect, "task", "task_004", { now: new Date(now.getTime() + 11 * 60_000) })).toBe(true);
    expect((await prisma.recentItem.findFirstOrThrow({ where: { memberId: architect.membershipId, entityId: "task_004" } })).accessCount).toBe(2);

    expect(await recordRecentAccess(architect, "project_milestone", "milestone_riverside_roof", { now: new Date(now.getTime() + 12 * 60_000) })).toBe(true);
    expect((await listRecentWork(architect)).map((item) => item.entityId)).toEqual(["milestone_riverside_roof", "task_004"]);

    expect(await recordRecentAccess(architect, "project", PROJECT.b)).toBe(false);
    expect(await recordRecentAccess(architect, "leave_request", "leave_1")).toBe(false);
    expect(await recordRecentAccess(ownerB, "project", PROJECT.a)).toBe(false);
    expect(await prisma.recentItem.count({ where: { memberId: { in: [architect.membershipId, ownerB.membershipId] }, entityId: { in: [PROJECT.a, PROJECT.b] } } })).toBe(0);

    await clearRecentWork(architect);
    expect(await listRecentWork(architect)).toEqual([]);
  });

  it("prunes past the company's retention and past the hundred newest per member", async () => {
    const old = new Date(Date.now() - 120 * 86_400_000);
    await prisma.recentItem.create({ data: { companyId: "company_demo_a", memberId: viewer.membershipId, entityType: "project", entityId: PROJECT.a, lastAccessedAt: old } });
    await prisma.recentItem.createMany({ data: Array.from({ length: RECENT_CAP + 5 }, (_, index) => ({ companyId: "company_demo_a", memberId: finance.membershipId, entityType: "task", entityId: `pruned_task_${index}`, lastAccessedAt: new Date(Date.now() - index * 60_000) })) });
    await pruneRecentWork();
    expect(await prisma.recentItem.count({ where: { memberId: viewer.membershipId } })).toBe(0);
    expect(await prisma.recentItem.count({ where: { memberId: finance.membershipId } })).toBe(RECENT_CAP);
    expect(await prisma.recentItem.count({ where: { memberId: finance.membershipId, entityId: "pruned_task_0" } })).toBe(1);
  });

  it("resolves navigable records in batches and drops what the reader cannot open", async () => {
    const items = await resolveNavigable(architect, [
      { entityType: "project", entityId: PROJECT.a },
      { entityType: "project", entityId: PROJECT.b },
      { entityType: "unknown", entityId: "x" },
      { entityType: "meeting", entityId: "meeting_riverside_000" },
      { entityType: "project", entityId: PROJECT.companyB },
    ]);
    expect(items.map((item) => `${item.entityType}:${item.entityId}`)).toEqual([`project:${PROJECT.a}`, "meeting:meeting_riverside_000"]);
  });
});
