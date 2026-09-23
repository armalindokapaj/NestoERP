import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { addFavoriteForWorkspace, removeFavoriteForWorkspace } from "@/lib/modules/productivity/favorites.service";
import { listMyWork, searchHome } from "@/lib/modules/productivity/my-work.service";
import { clearRecentWorkForWorkspace, pruneStaleReferences, recordRecentAccessForWorkspace } from "@/lib/modules/productivity/recent-work.service";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * Fast Re-entry (Recent Work, Favorites & Fast Record Re-entry PRD §200-§230)
 * against the real database: user-global lists, company attribution, the
 * search home, My Work filters and paging, dedup and privacy.
 *
 * The multi-company Architect works in Company A and Company D; each company
 * keeps its own rows for its own membership.
 */

const MULTI_A = "member_multicompany_a";
const MULTI_D = "member_multicompany_d";
let inA: UserContext;
let inGroup: UserContext;
let viewer: UserContext;
const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });

async function cleanup() {
  await prisma.userFavorite.deleteMany({ where: { memberId: { in: [MULTI_A, MULTI_D, viewer.membershipId] } } });
  await prisma.recentItem.deleteMany({ where: { memberId: { in: [MULTI_A, MULTI_D, viewer.membershipId] } } });
}

beforeAll(async () => {
  inA = await loginAsMembership(MULTI_A);
  inGroup = await loginAsMembership(MULTI_A, { workspace: "GROUP" });
  viewer = await loginAs("VIEWER");
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("user-global favorites and recent work (§38, §39, §124, §206, §210)", () => {
  it("shows another company's record in a company workspace, naming its company, and stores it with that company's membership", async () => {
    await addFavoriteForWorkspace(inA, { entityType: "project", entityId: PROJECT.d });
    await recordRecentAccessForWorkspace(inA, "project", PROJECT.a);

    const stored = await prisma.userFavorite.findFirstOrThrow({ where: { entityId: PROJECT.d } });
    expect(stored).toMatchObject({ companyId: "company_demo_d", memberId: MULTI_D });

    const home = await searchHome(inA);
    expect(home.workspace).toEqual({ scopeType: "COMPANY", companyId: "company_demo_a" });
    expect(home.favorites.map((item) => [item.entityId, item.company?.id, item.moduleKey])).toEqual([[PROJECT.d, "company_demo_d", "projects"]]);
    expect(home.recent.map((item) => [item.entityId, item.company?.id])).toEqual([[PROJECT.a, "company_demo_a"]]);

    // The same lists from the Group workspace: the workspace changes nothing (§124).
    const fromGroup = await searchHome(inGroup);
    expect(fromGroup.favorites.map((item) => item.entityId)).toEqual([PROJECT.d]);
    expect(fromGroup.workspace.scopeType).toBe("GROUP");
  });

  it("removes a favorite from any workspace, and a second removal is still safe (§77, §186)", async () => {
    await addFavoriteForWorkspace(inA, { entityType: "project", entityId: PROJECT.d });
    expect(await removeFavoriteForWorkspace(inA, { entityType: "project", entityId: PROJECT.d })).toBe(true);
    expect(await removeFavoriteForWorkspace(inA, { entityType: "project", entityId: PROJECT.d })).toBe(false);
  });

  it("never favorites or records a record the person cannot open (§103, §104, §190)", async () => {
    await expect(addFavoriteForWorkspace(inA, { entityType: "project", entityId: PROJECT.b })).rejects.toMatchObject(code("FAVORITE_NOT_FOUND"));
    await expect(addFavoriteForWorkspace(viewer, { entityType: "project", entityId: PROJECT.d })).rejects.toMatchObject(code("FAVORITE_NOT_FOUND"));
    expect(await recordRecentAccessForWorkspace(viewer, "project", PROJECT.d)).toBe(false);
    expect(await prisma.recentItem.count({ where: { memberId: viewer.membershipId } })).toBe(0);
  });
});

describe("recent work dedup and order (§21, §72, §204, §205)", () => {
  it("keeps one row per record and moves a reopened record to the top", async () => {
    await recordRecentAccessForWorkspace(inA, "project", PROJECT.a);
    await recordRecentAccessForWorkspace(inA, "non_conformance_report", "ncr_001");
    await recordRecentAccessForWorkspace(inA, "project", PROJECT.a);
    const rows = await prisma.recentItem.findMany({ where: { memberId: MULTI_A } });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.entityId === PROJECT.a)?.accessCount).toBe(2);
    expect((await searchHome(inA)).recent.map((item) => item.entityId)).toEqual([PROJECT.a, "ncr_001"]);
  });

  it("clears recent work without touching favorites (§79, §218)", async () => {
    await addFavoriteForWorkspace(inA, { entityType: "project", entityId: PROJECT.a });
    await recordRecentAccessForWorkspace(inA, "project", PROJECT.d);
    await clearRecentWorkForWorkspace(inA);
    expect(await prisma.recentItem.count({ where: { memberId: { in: [MULTI_A, MULTI_D] } } })).toBe(0);
    expect(await prisma.userFavorite.count({ where: { memberId: MULTI_A } })).toBe(1);
  });
});

describe("My Work (§59-§67, §135, §165-§169, §219, §220)", () => {
  it("filters by company, module and text, pages by cursor, and never moves the workspace", async () => {
    await recordRecentAccessForWorkspace(inA, "project", PROJECT.a);
    await recordRecentAccessForWorkspace(inA, "non_conformance_report", "ncr_001");
    await recordRecentAccessForWorkspace(inA, "project", PROJECT.d);

    const all = await listMyWork(inA, { tab: "recent" });
    expect(all.items.map((item) => item.entityId)).toEqual([PROJECT.d, "ncr_001", PROJECT.a]);
    expect(all.facets.companies.map((company) => company.id).sort()).toEqual(["company_demo_a", "company_demo_d"]);
    expect(all.facets.modules).toEqual(["projects", "qaqc"]);

    expect((await listMyWork(inA, { tab: "recent", companyId: "company_demo_d" })).items.map((item) => item.entityId)).toEqual([PROJECT.d]);
    expect((await listMyWork(inA, { tab: "recent", module: "qaqc" })).items.map((item) => item.entityId)).toEqual(["ncr_001"]);
    expect((await listMyWork(inA, { tab: "recent", q: "marina" })).items.map((item) => item.entityId)).toEqual([PROJECT.d]);
    expect(inA.workspace.scopeType).toBe("COMPANY");
    expect(inA.companyId).toBe("company_demo_a");

    const first = await listMyWork(inA, { tab: "recent", limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = await listMyWork(inA, { tab: "recent", limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.entityId)).toEqual([PROJECT.a]);
    expect(second.nextCursor).toBeNull();
  });

  it("ignores a company filter the person cannot use, rather than naming or counting it (§37, §168)", async () => {
    await recordRecentAccessForWorkspace(inA, "project", PROJECT.a);
    const page = await listMyWork(inA, { tab: "recent", companyId: "company_demo_b" });
    expect(page.items.map((item) => item.entityId)).toEqual([PROJECT.a]);
    expect(page.facets.companies.map((company) => company.id)).not.toContain("company_demo_b");
  });

  it("omits a record once access is lost, without a count or a hint (§35-§37, §207)", async () => {
    await addFavoriteForWorkspace(viewer, { entityType: "project", entityId: PROJECT.a });
    await prisma.projectMember.updateMany({ where: { projectId: PROJECT.a, companyMemberId: viewer.membershipId }, data: { status: "INACTIVE" } });
    try {
      const refreshed = await loginAs("VIEWER");
      const page = await listMyWork(refreshed, { tab: "favorites" });
      expect(page.items).toEqual([]);
      expect(JSON.stringify(page)).not.toContain(PROJECT.a);
    } finally {
      await prisma.projectMember.updateMany({ where: { projectId: PROJECT.a, companyMemberId: viewer.membershipId }, data: { status: "ACTIVE" } });
    }
  });
});

describe("housekeeping (§119, §177-§179)", () => {
  it("removes references to deleted records and unknown types, keeps live ones, and reports keys only for search stars", async () => {
    await addFavoriteForWorkspace(inA, { entityType: "project", entityId: PROJECT.a });
    await prisma.userFavorite.create({ data: { companyId: "company_demo_a", memberId: MULTI_A, entityType: "task", entityId: "task_that_was_deleted" } });
    await prisma.recentItem.create({ data: { companyId: "company_demo_a", memberId: MULTI_A, entityType: "retired_type", entityId: "x", lastAccessedAt: new Date() } });
    expect((await searchHome(inA)).favoriteKeys).toEqual(expect.arrayContaining([`project:${PROJECT.a}`]));

    await pruneStaleReferences();
    expect(await prisma.userFavorite.findMany({ where: { memberId: MULTI_A }, select: { entityId: true } })).toEqual([{ entityId: PROJECT.a }]);
    expect(await prisma.recentItem.count({ where: { memberId: MULTI_A, entityType: "retired_type" } })).toBe(0);
  });
});
