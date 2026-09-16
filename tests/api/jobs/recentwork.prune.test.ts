import type { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { prisma as servicePrisma } from "@/lib/database/prisma";
import { RECENT_CAP } from "@/lib/modules/productivity/recent-work.service";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * `recentwork.prune` (PRD #45 §104, §105; PRD #51 §145, §165, §173-§181).
 *
 * Recent items belong to members of this file's own making — the table keys a
 * member by id without a relation — so nothing a seeded member opened is
 * counted or removed, and every row is deleted after each test. Retention is
 * the seeded ninety days.
 */

const JOB = "recentwork.prune";
const PREFIX = `jobtest_recent_${process.pid}_${Date.now().toString(36)}`;
const DAY = 86_400_000;
let members = 0;
let retentionBefore: number | null = null;

const member = () => `${PREFIX}_member_${(members += 1)}`;

/** `fresh` rows opened a minute apart, newest first, and `old` rows past retention. */
async function recentItems(companyId: string, memberId: string, counts: { fresh?: number; old?: number }) {
  const now = Date.now();
  const rows = [
    ...Array.from({ length: counts.fresh ?? 0 }, (_, index) => ({ companyId, memberId, entityType: "task", entityId: `${memberId}_fresh_${index}`, lastAccessedAt: new Date(now - (index + 1) * 60_000) })),
    ...Array.from({ length: counts.old ?? 0 }, (_, index) => ({ companyId, memberId, entityType: "task", entityId: `${memberId}_old_${index}`, lastAccessedAt: new Date(now - (120 + index) * DAY) })),
  ];
  await prisma.recentItem.createMany({ data: rows });
}

const remaining = async (memberId: string) =>
  (await prisma.recentItem.findMany({ where: { memberId }, orderBy: { entityId: "asc" }, select: { entityId: true, companyId: true } })).map((row) => row.entityId);

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.recentItem.deleteMany({ where: { memberId: { startsWith: PREFIX } } });
  if (retentionBefore !== null) {
    await prisma.productivitySettings.update({ where: { companyId: COMPANY_A }, data: { recentWorkRetentionDays: retentionBefore } });
    retentionBefore = null;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recentwork.prune", () => {
  describe("idempotency", () => {
    it("drops what is past retention and past the hundred newest, and a second run removes nothing more", async () => {
      const memberId = member();
      await recentItems(COMPANY_A, memberId, { fresh: RECENT_CAP + 5, old: 2 });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const kept = await remaining(memberId);
      expect(kept).toHaveLength(RECENT_CAP);
      expect(kept).toContain(`${memberId}_fresh_0`);
      expect(kept).toContain(`${memberId}_fresh_${RECENT_CAP - 1}`);
      expect(kept).not.toContain(`${memberId}_fresh_${RECENT_CAP}`);
      expect(kept.some((entityId) => entityId.includes("_old_"))).toBe(false);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await remaining(memberId)).toEqual(kept);
    });

    it("keeps a record opened after the line was drawn, rather than everything outside the hundred it read", async () => {
      const memberId = member();
      await recentItems(COMPANY_A, memberId, { fresh: RECENT_CAP + 5 });
      const reopened = `${memberId}_fresh_${RECENT_CAP + 2}`;
      const deleteMany = servicePrisma.recentItem.deleteMany.bind(servicePrisma.recentItem);
      vi.spyOn(servicePrisma.recentItem, "deleteMany").mockImplementation((async (args: Prisma.RecentItemDeleteManyArgs) => {
        // The member opens an old record between the job's read and its delete.
        if (args.where?.memberId === memberId) await prisma.recentItem.update({ where: { memberId_entityType_entityId: { memberId, entityType: "task", entityId: reopened } }, data: { lastAccessedAt: new Date() } });
        return deleteMany(args);
      }) as never);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      const kept = await remaining(memberId);
      expect(kept).toContain(reopened);
      expect(kept).toHaveLength(RECENT_CAP + 1);
    });
  });

  describe("dry run", () => {
    it("counts what it would remove and removes nothing", async () => {
      const baseline = await invokeJob(JOB, { companyIds: [COMPANY_A], dryRun: true });
      const memberId = member();
      await recentItems(COMPANY_A, memberId, { fresh: RECENT_CAP + 5, old: 2 });

      const result = await invokeJob(JOB, { companyIds: [COMPANY_A], dryRun: true });

      expect(result.processed - baseline.processed).toBe(7);
      expect(result.detail).toMatchObject({ dryRun: true });
      expect(await remaining(memberId)).toHaveLength(RECENT_CAP + 7);
    });
  });

  describe("company isolation", () => {
    it("a run for company A prunes only A's members, and never moves a row between companies", async () => {
      const inA = member();
      const inB = member();
      await recentItems(COMPANY_A, inA, { fresh: 1, old: 2 });
      await recentItems(COMPANY_B, inB, { fresh: 1, old: 2 });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await remaining(inA)).toEqual([`${inA}_fresh_0`]);
      expect(await remaining(inB)).toHaveLength(3);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await remaining(inB)).toEqual([`${inB}_fresh_0`]);
      expect(await prisma.recentItem.findMany({ where: { memberId: { in: [inA, inB] } }, orderBy: { memberId: "asc" }, select: { companyId: true } })).toEqual([{ companyId: COMPANY_A }, { companyId: COMPANY_B }]);
    });
  });

  describe("suspended company", () => {
    it("prunes a suspended company's recent work too: housekeeping is included", async () => {
      const memberId = member();
      await recentItems(COMPANY_SUSPENDED, memberId, { fresh: 1, old: 3 });

      const result = await withCompanyStatus(COMPANY_SUSPENDED, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] }));

      expect(result.processed).toBeGreaterThanOrEqual(3);
      expect(await remaining(memberId)).toEqual([`${memberId}_fresh_0`]);
    });
  });

  describe("failure", () => {
    it("still prunes the companies after one whose settings cannot be applied, and fails the run", async () => {
      const inA = member();
      const inB = member();
      await recentItems(COMPANY_A, inA, { old: 2 });
      await recentItems(COMPANY_B, inB, { old: 2 });
      retentionBefore = (await prisma.productivitySettings.findUniqueOrThrow({ where: { companyId: COMPANY_A } })).recentWorkRetentionDays;
      // A retention no date can be computed from: company A's run throws on its first query.
      await prisma.productivitySettings.update({ where: { companyId: COMPANY_A }, data: { recentWorkRetentionDays: 2_000_000_000 } });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A, COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await remaining(inA)).toHaveLength(2);
      expect(await remaining(inB)).toHaveLength(0);
    });
  });
});
