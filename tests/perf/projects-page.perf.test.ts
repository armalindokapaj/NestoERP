import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Projects page performance (E-05A §44, §69).
 *
 * A person with 600 visible projects across two companies, in a project table
 * of 5,600, with 40 favorites and a cover on a third of them. Times the first
 * page in the recommended order, a page deep into the cursor, and the filter
 * options. Targets: P95 < 500 ms each. And no N+1: the number of queries a
 * page takes does not grow with the number of cards on it.
 *
 * Opt-in (`NESTO_PERF=1`): it writes into the shared development database for
 * the length of the run and removes everything afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/projects-page.perf.test.ts
 */

// Every query the services send is counted: the application's client is taken
// from globalThis when one is there, so this one is put there before any
// service module loads.
const counter = await vi.hoisted(async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  const state = { queries: 0 };
  const client = new Client({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", () => {
    state.queries += 1;
  });
  (globalThis as unknown as { prisma: unknown }).prisma = client;
  return state;
});

const { listPortfolioProjects, portfolioFilterOptions } = await import("@/lib/modules/projects/project.portfolio");
const { portfolioQuerySchema } = await import("@/lib/modules/projects/project.schema");
const { cleanupSessions, loginAsMembership } = await import("../helpers");

const RUN = process.env.NESTO_PERF === "1";
const PREFIX = "perf_prj";
const db = new PrismaClient();

const MEMBERSHIPS = { A: { companyId: "company_demo_a", memberId: "member_multicompany_a" }, B: { companyId: "company_demo_b", memberId: "member_multicompany_b" } };
const VISIBLE_PER_COMPANY = 300;
const BACKGROUND = 5_000;

async function cleanup() {
  await db.userFavorite.deleteMany({ where: { entityId: { startsWith: PREFIX } } });
  await db.projectMember.deleteMany({ where: { projectId: { startsWith: PREFIX } } });
  await db.project.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function time(run: () => Promise<unknown>, attempts = 12): Promise<number[]> {
  await run();
  const timings: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const started = performance.now();
    await run();
    timings.push(performance.now() - started);
  }
  return timings;
}

describe.skipIf(!RUN)("the Projects page at 600 visible projects in a table of 5,600 (E-05A §69)", () => {
  beforeAll(async () => {
    await cleanup();
    const cover = await db.document.findFirst({ where: { companyId: "company_demo_a", status: "ACTIVE", storageStatus: "AVAILABLE", mimeType: { startsWith: "image/" } }, select: { id: true } });
    const now = Date.now();

    for (const [key, membership] of Object.entries(MEMBERSHIPS)) {
      const rows = Array.from({ length: VISIBLE_PER_COMPANY }, (_, index) => ({
        id: `${PREFIX}_${key}_${index}`,
        companyId: membership.companyId,
        code: `PERF-${key}-${index}`,
        name: `Perf ${key} project ${index.toString().padStart(3, "0")}`,
        status: (["PENDING", "ACTIVE", "FINISHED"] as const)[index % 3],
        projectType: index % 2 === 0 ? "RESIDENTIAL" : "COMMERCIAL",
        city: index % 4 === 0 ? "Tiranë" : "Durrës",
        country: "Albania",
        lastActivityAt: new Date(now - index * 60_000),
        coverImageDocumentId: key === "A" && cover && index % 3 === 0 ? cover.id : null,
        createdBy: "perf",
      }));
      await db.project.createMany({ data: rows });
      await db.projectMember.createMany({
        data: rows.map((row, index) => ({ companyId: membership.companyId, projectId: row.id, companyMemberId: membership.memberId, projectRole: index % 5 === 0 ? "Lead Architect" : "Architect", status: "ACTIVE" as const })),
      });
      await db.userFavorite.createMany({
        data: rows.slice(0, 20).map((row) => ({ companyId: membership.companyId, memberId: membership.memberId, entityType: "project", entityId: row.id })),
      });
    }

    for (let offset = 0; offset < BACKGROUND; offset += 1_000) {
      await db.project.createMany({
        data: Array.from({ length: 1_000 }, (_, index) => ({
          id: `${PREFIX}_bg_${offset + index}`,
          companyId: "company_demo_a",
          code: `PERF-BG-${offset + index}`,
          name: `Perf background ${offset + index}`,
          status: "ACTIVE" as const,
          lastActivityAt: new Date(now - (offset + index) * 1_000),
          createdBy: "perf",
        })),
      });
    }
  }, 300_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    await db.$disconnect();
  }, 300_000);

  it("serves the first page, a deep page and the filters inside 500 ms at P95", async () => {
    const session = await loginAsMembership(MEMBERSHIPS.A.memberId);
    const first = portfolioQuerySchema.parse({});

    const firstPage = await listPortfolioProjects(session, first);
    expect(firstPage.meta.visibleProjectCount).toBeGreaterThanOrEqual(VISIBLE_PER_COMPANY * 2);
    expect(firstPage.items).toHaveLength(24);
    expect(firstPage.items.slice(0, 24).every((item) => item.isFavorite)).toBe(true);

    let cursor = firstPage.pageInfo.nextCursor ?? undefined;
    for (let page = 0; page < 10 && cursor; page += 1) {
      cursor = (await listPortfolioProjects(session, portfolioQuerySchema.parse({ cursor }))).pageInfo.nextCursor ?? undefined;
    }
    const deep = portfolioQuerySchema.parse({ cursor });

    const results = {
      first: percentile(await time(() => listPortfolioProjects(session, first)), 95),
      deep: percentile(await time(() => listPortfolioProjects(session, deep)), 95),
      filtered: percentile(await time(() => listPortfolioProjects(session, portfolioQuerySchema.parse({ q: "project 1", status: "ACTIVE", projectType: "RESIDENTIAL" }))), 95),
      options: percentile(await time(() => portfolioFilterOptions(session)), 95),
    };
    console.info("[perf] projects page P95 (ms)", results);

    for (const [name, p95] of Object.entries(results)) expect(p95, name).toBeLessThan(500);
  }, 300_000);

  it("takes the same number of queries for 12 cards as for 60", async () => {
    const session = await loginAsMembership(MEMBERSHIPS.A.memberId);
    const count = async (limit: number) => {
      await listPortfolioProjects(session, portfolioQuerySchema.parse({ limit, sort: "name-asc" }));
      const before = counter.queries;
      await listPortfolioProjects(session, portfolioQuerySchema.parse({ limit, sort: "name-asc" }));
      return counter.queries - before;
    };
    const [large, small] = [await count(60), await count(12)];
    // A counter that saw nothing would make any two runs look equal.
    expect(small).toBeGreaterThan(3);
    expect(large).toBe(small);
  }, 120_000);
});
