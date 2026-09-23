import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { prisma as servicePrisma } from "@/lib/database/prisma";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * `productivity.stale-references` (Fast Re-entry §118, §119, §177, §179; PRD #51 §173-§181).
 *
 * Favorites and recent items belong to members of this file's own making, and
 * point either at a seeded record that exists (`project_a`, kept) or at ids no
 * table holds (removed). Every row is deleted after each test.
 */

const JOB = "productivity.stale-references";
const PREFIX = `jobtest_stale_${process.pid}_${Date.now().toString(36)}`;
let members = 0;
const member = () => `${PREFIX}_member_${(members += 1)}`;

async function references(companyId: string, memberId: string) {
  await prisma.recentItem.createMany({
    data: [
      { companyId, memberId, entityType: "project", entityId: "project_a", lastAccessedAt: new Date() },
      { companyId, memberId, entityType: "task", entityId: `${memberId}_gone`, lastAccessedAt: new Date() },
      { companyId, memberId, entityType: "retired_type", entityId: `${memberId}_x`, lastAccessedAt: new Date() },
    ],
  });
  await prisma.userFavorite.createMany({
    data: [
      { companyId, memberId, entityType: "project", entityId: "project_a" },
      { companyId, memberId, entityType: "invoice", entityId: `${memberId}_gone` },
    ],
  });
}

const left = async (memberId: string) => ({
  recent: (await prisma.recentItem.findMany({ where: { memberId }, select: { entityId: true } })).map((row) => row.entityId).sort(),
  favorites: (await prisma.userFavorite.findMany({ where: { memberId }, select: { entityId: true } })).map((row) => row.entityId).sort(),
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.recentItem.deleteMany({ where: { memberId: { startsWith: PREFIX } } });
  await prisma.userFavorite.deleteMany({ where: { memberId: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("productivity.stale-references", () => {
  describe("idempotency", () => {
    it("removes references to missing records and retired types, keeps live ones, and a second run removes nothing", async () => {
      const memberId = member();
      await references(COMPANY_A, memberId);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await left(memberId)).toEqual({ recent: ["project_a"], favorites: ["project_a"] });

      const again = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(again.detail).toMatchObject({ removed: 0 });
      expect(await left(memberId)).toEqual({ recent: ["project_a"], favorites: ["project_a"] });
    });

    it("counts in a dry run and removes nothing", async () => {
      const memberId = member();
      await references(COMPANY_A, memberId);
      const result = await invokeJob(JOB, { companyIds: [COMPANY_A], dryRun: true });
      expect(result.processed).toBeGreaterThanOrEqual(3);
      expect((await left(memberId)).recent).toHaveLength(3);
    });
  });

  describe("company isolation", () => {
    it("a run for company A touches only A's rows", async () => {
      const inA = member();
      const inB = member();
      await references(COMPANY_A, inA);
      await references(COMPANY_B, inB);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await left(inA)).recent).toEqual(["project_a"]);
      expect((await left(inB)).recent).toHaveLength(3);
    });
  });

  describe("suspended company", () => {
    it("cleans a suspended company's references too: housekeeping is included", async () => {
      const memberId = member();
      await references(COMPANY_SUSPENDED, memberId);
      await withCompanyStatus(COMPANY_SUSPENDED, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] }));
      expect((await left(memberId)).favorites).toEqual(["project_a"]);
    });
  });

  describe("failure", () => {
    it("still cleans the companies after one that fails, and fails the run", async () => {
      const inA = member();
      const inB = member();
      await references(COMPANY_A, inA);
      await references(COMPANY_B, inB);
      const findMany = servicePrisma.recentItem.findMany.bind(servicePrisma.recentItem);
      vi.spyOn(servicePrisma.recentItem, "findMany").mockImplementation(((args: { where?: { companyId?: string } }) => {
        if (args?.where?.companyId === COMPANY_A) throw new Error("boom");
        return findMany(args as never);
      }) as never);

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A, COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect((await left(inA)).recent).toHaveLength(3);
      expect((await left(inB)).recent).toEqual(["project_a"]);
    });
  });
});
