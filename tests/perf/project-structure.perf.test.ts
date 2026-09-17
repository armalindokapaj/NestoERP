import { writeFileSync } from "node:fs";

import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Project structure performance (E-05B §107-§111, §141).
 *
 * One project of 10,000 units: 10 buildings × 25 floors × 40 units. Times the
 * tree, the first page of the whole project, a page deep into it, one floor, a
 * filtered and sorted page, and a search. Targets: P95 < 500 ms each. And no
 * N+1: the tree takes the same number of queries for 10,000 units as for 126,
 * and a page of units the same number whatever is on it.
 *
 * Opt-in (`NESTO_PERF=1`): it writes into the shared development database for
 * the length of the run and removes everything afterwards.
 *
 *   NESTO_PERF=1 npx vitest run tests/perf/project-structure.perf.test.ts
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

const { getProjectStructure, listProjectUnits } = await import("@/lib/modules/project-structure/structure.service");
const { parseUnitListQuery } = await import("@/lib/modules/project-structure/structure.schema");
const { structureKey, floorKeyOf } = await import("@/lib/modules/project-structure/structure.rules");
const { cleanupSessions, loginAs } = await import("../helpers");

const RUN = process.env.NESTO_PERF === "1";
const PROJECT = "perf_structure_project";
const COMPANY = "company_demo_a";
const BUILDINGS = 10;
const FLOORS = 25;
const UNITS = 40;
const db = new PrismaClient();

async function cleanup() {
  await db.projectUnit.deleteMany({ where: { projectId: PROJECT } });
  await db.projectFloor.deleteMany({ where: { projectId: PROJECT } });
  await db.projectBuilding.deleteMany({ where: { projectId: PROJECT } });
  await db.project.deleteMany({ where: { id: PROJECT } });
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

async function queriesOf(run: () => Promise<unknown>): Promise<number> {
  const before = counter.queries;
  await run();
  return counter.queries - before;
}

describe.skipIf(!RUN)("a project of 10,000 units (E-05B §107, §141)", () => {
  beforeAll(async () => {
    await cleanup();
    const createdBy = (await db.user.findFirstOrThrow({ where: { username: "owner" }, select: { id: true } })).id;
    await db.project.create({ data: { id: PROJECT, companyId: COMPANY, code: "PERF-STRUCTURE", name: "Perf structure", status: "ACTIVE", createdBy } });
    const types = await db.projectUnitType.findMany({ where: { companyId: COMPANY, code: { in: ["APARTMENT", "OFFICE", "PARKING"] } }, select: { id: true } });

    await db.projectBuilding.createMany({
      data: Array.from({ length: BUILDINGS }, (_, b) => ({ id: `${PROJECT}_b${b}`, companyId: COMPANY, projectId: PROJECT, name: `Tower ${b}`, nameKey: structureKey(`Tower ${b}`), sortOrder: b + 1, createdBy })),
    });
    await db.projectFloor.createMany({
      data: Array.from({ length: BUILDINGS * FLOORS }, (_, index) => {
        const b = Math.floor(index / FLOORS);
        const f = index % FLOORS;
        return { id: `${PROJECT}_b${b}_f${f}`, companyId: COMPANY, projectId: PROJECT, buildingId: `${PROJECT}_b${b}`, number: f, name: `Floor ${f}`, levelType: f === 0 ? ("GROUND" as const) : ("STANDARD" as const), floorKey: floorKeyOf(f === 0 ? "GROUND" : "STANDARD", f, `Floor ${f}`), sortOrder: f + 1, createdBy };
      }),
    });
    for (let b = 0; b < BUILDINGS; b += 1) {
      await db.projectUnit.createMany({
        data: Array.from({ length: FLOORS * UNITS }, (_, index) => {
          const f = Math.floor(index / UNITS);
          const u = index % UNITS;
          const code = `T${b}-${f}${String(u).padStart(2, "0")}`;
          return {
            companyId: COMPANY,
            projectId: PROJECT,
            floorId: `${PROJECT}_b${b}_f${f}`,
            unitCode: code,
            unitCodeKey: structureKey(code),
            unitTypeId: types[index % types.length]!.id,
            orientation: (["N", "E", "S", "W"] as const)[u % 4],
            internalArea: new Prisma.Decimal(40 + ((index * 7) % 120)),
            saleableArea: new Prisma.Decimal(48 + ((index * 7) % 130)),
            bedrooms: u % 4,
            sortOrder: u + 1,
            createdBy,
          };
        }),
      });
    }
  }, 240_000);

  afterAll(async () => {
    await cleanup();
    await cleanupSessions();
    await db.$disconnect();
  });

  it("answers the tree, pages, a floor, filters and search under 500 ms at P95", async () => {
    const owner = await loginAs("OWNER");
    expect((await getProjectStructure(owner, PROJECT)).totals).toEqual({ buildings: BUILDINGS, floors: BUILDINGS * FLOORS, units: BUILDINGS * FLOORS * UNITS });

    const cases: Array<[string, () => Promise<unknown>]> = [
      ["tree", () => getProjectStructure(owner, PROJECT)],
      ["first page", () => listProjectUnits(owner, PROJECT, parseUnitListQuery(new URLSearchParams()))],
      ["page 150", () => listProjectUnits(owner, PROJECT, parseUnitListQuery(new URLSearchParams("page=150")))],
      ["one floor", () => listProjectUnits(owner, PROJECT, parseUnitListQuery(new URLSearchParams(`floorId=${PROJECT}_b7_f19`)))],
      ["filtered and sorted", () => listProjectUnits(owner, PROJECT, parseUnitListQuery(new URLSearchParams(`buildingId=${PROJECT}_b3&orientation=S&saleableAreaMin=80&saleableAreaMax=120&sort=-saleableArea`)))],
      ["search", () => listProjectUnits(owner, PROJECT, parseUnitListQuery(new URLSearchParams("q=T4-12")))],
    ];
    const report: string[] = [];
    for (const [label, run] of cases) {
      const p95 = percentile(await time(run), 95);
      report.push(`${label}: ${p95.toFixed(1)} ms`);
      expect(p95, label).toBeLessThan(500);
    }
    writeFileSync(process.env.PERF_REPORT ?? "/dev/null", report.join("\n"));
  }, 120_000);

  it("takes the same number of queries for 10,000 units as for the seeded 126", async () => {
    const owner = await loginAs("OWNER");
    const large = await queriesOf(() => getProjectStructure(owner, PROJECT));
    const small = await queriesOf(() => getProjectStructure(owner, "project_a"));
    expect(large).toBe(small);

    const page = await queriesOf(() => listProjectUnits(owner, PROJECT, parseUnitListQuery(new URLSearchParams("limit=100"))));
    const few = await queriesOf(() => listProjectUnits(owner, PROJECT, parseUnitListQuery(new URLSearchParams("limit=5"))));
    expect(page).toBe(few);
  });
});
