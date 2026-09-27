import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { prisma as appPrisma } from "@/lib/database/prisma";
import { parseClientListQuery, type ClientQueryDefaults } from "@/lib/modules/clients/client.query";
import * as clients from "@/lib/modules/clients/client.service";
import { parseProjectListQuery } from "@/lib/modules/projects/project.query";
import * as projects from "@/lib/modules/projects/project.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * AUD-08 — the Clients list and the archived Projects list (§3, §4; DT-02..DT-05, DT-22).
 *
 * Expected ids are written out from these tables (PRD §9). Enum order:
 * ClientType INDIVIDUAL < COMPANY < PUBLIC_ENTITY; ClientStatus ACTIVE < INACTIVE.
 *
 * | id | client name | type          | status   | other                          |
 * |----|-------------|---------------|----------|--------------------------------|
 * | c1 | Acme        | COMPANY       | ACTIVE   | has live project p1            |
 * | c2 | Acme        | INDIVIDUAL    | ACTIVE   |                                |
 * | c3 | Beta        | COMPANY       | INACTIVE |                                |
 * | c4 | Gamma       | PUBLIC_ENTITY | ARCHIVED | archived                       |
 * | c5 | Delta       | COMPANY       | ACTIVE   | company B                      |
 *
 * | id | project name | status   | start      | other    |
 * |----|--------------|----------|------------|----------|
 * | p1 | Live         | ACTIVE   | 2020-01-01 | client c1|
 * | p2 | Arch         | ARCHIVED | 2020-01-01 | archived |
 * | p3 | Arch         | ARCHIVED | —          | archived |
 * | p4 | Bold         | ARCHIVED | 2020-01-01 | archived |
 */

const CTAG = "aud08c-CL";
const PTAG = "aud08c-PL";
const c = { c1: "aud08c_client_1", c2: "aud08c_client_2", c3: "aud08c_client_3", c4: "aud08c_client_4", c5: "aud08c_client_5" };
const p = { p1: "aud08c_project_1", p2: "aud08c_project_2", p3: "aud08c_project_3", p4: "aud08c_project_4" };

let owner: UserContext;
const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
const listClients = (params: Record<string, string>, defaults: ClientQueryDefaults = {}) =>
  clients.listClients(owner, parseClientListQuery({ search: CTAG, ...params }, defaults));
const listArchived = (params: Record<string, string>) =>
  projects.listProjects(owner, parseProjectListQuery({ search: PTAG, ...params }, { archived: true }));

async function walk<T extends { id: string }>(read: (page: number) => Promise<{ data: T[]; pagination: { total: number; totalPages: number } }>) {
  const seen: string[] = [];
  const totals = new Set<number>();
  for (let page = 1; page < 20; page += 1) {
    const result = await read(page);
    totals.add(result.pagination.total);
    seen.push(...ids(result.data));
    if (page >= result.pagination.totalPages) break;
  }
  return { seen, totals: [...totals] };
}

async function cleanup() {
  await prisma.project.deleteMany({ where: { id: { in: Object.values(p) } } });
  await prisma.client.deleteMany({ where: { id: { in: Object.values(c) } } });
}

beforeAll(async () => {
  await cleanup();
  owner = await loginAs("OWNER");
  const fixed = new Date("2026-01-01T00:00:00.000Z");
  const client = (key: keyof typeof c, name: string, type: "INDIVIDUAL" | "COMPANY" | "PUBLIC_ENTITY", status: "ACTIVE" | "INACTIVE" | "ARCHIVED", companyId: string = COMPANY.a) =>
    prisma.client.create({
      data: { id: c[key], companyId, name: `${CTAG} ${name}`, type, status, archivedAt: status === "ARCHIVED" ? fixed : null, createdBy: "aud08c", updatedAt: fixed },
    });
  await client("c1", "Acme", "COMPANY", "ACTIVE");
  await client("c2", "Acme", "INDIVIDUAL", "ACTIVE");
  await client("c3", "Beta", "COMPANY", "INACTIVE");
  await client("c4", "Gamma", "PUBLIC_ENTITY", "ARCHIVED");
  await client("c5", "Delta", "COMPANY", "ACTIVE", COMPANY.b);

  const project = (key: keyof typeof p, name: string, extra: Record<string, unknown>) =>
    prisma.project.create({ data: { id: p[key], companyId: COMPANY.a, code: `AUD08C-${key.toUpperCase()}`, name: `${PTAG} ${name}`, createdBy: "aud08c", updatedAt: fixed, ...extra } });
  await project("p1", "Live", { status: "ACTIVE", startDate: new Date("2020-01-01T00:00:00.000Z"), clientId: c.c1 });
  await project("p2", "Arch", { status: "ARCHIVED", archivedAt: fixed, startDate: new Date("2020-01-01T00:00:00.000Z") });
  await project("p3", "Arch", { status: "ARCHIVED", archivedAt: fixed });
  await project("p4", "Bold", { status: "ARCHIVED", archivedAt: fixed, startDate: new Date("2020-01-01T00:00:00.000Z") });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

describe("Clients — DT-04 sorts are total orders across pages", () => {
  // Live clients of Aurelia with the tag: c1 c2 c3.
  it.each([
    ["name-asc", [c.c1, c.c2, c.c3]],
    ["name-desc", [c.c3, c.c1, c.c2]],
    ["type-asc", [c.c2, c.c1, c.c3]],
    ["status-asc", [c.c1, c.c2, c.c3]],
    ["updated-desc", [c.c1, c.c2, c.c3]],
  ])("%s", async (sort, expected) => {
    const { seen, totals } = await walk((page) => listClients({ sort: sort as string, limit: "1", page: String(page) }));
    expect(seen).toEqual(expected);
    expect(totals).toEqual([3]);
  });
});

describe("Clients — DT-03 filters and DT-02 sections", () => {
  it("type (COMPANY or INDIVIDUAL) AND status ACTIVE, then AND has an active project", async () => {
    const both = await listClients({ type: "COMPANY,INDIVIDUAL", status: "ACTIVE", sort: "name-asc", limit: "1" });
    expect(ids(both.data)).toEqual([c.c1]);
    expect(both.pagination.total).toBe(2);
    expect(ids((await listClients({ type: "COMPANY,INDIVIDUAL", status: "ACTIVE", hasActiveProject: "yes" })).data)).toEqual([c.c1]);
    expect(ids((await listClients({ hasActiveProject: "no", sort: "name-asc" })).data)).toEqual([c.c2, c.c3]);
  });

  it("the Active section keeps ACTIVE whatever status the URL names; Archived keeps archived", async () => {
    const ACTIVE: ClientQueryDefaults = { status: ["ACTIVE"] };
    expect(ids((await listClients({ status: "INACTIVE", sort: "name-asc" }, ACTIVE)).data)).toEqual([c.c1, c.c2]);
    // Positive control: on All Clients the status filter applies.
    expect(ids((await listClients({ status: "INACTIVE" })).data)).toEqual([c.c3]);
    expect(ids((await listClients({}, { archived: true })).data)).toEqual([c.c4]);
  });
});

describe("Clients — DT-05 and DT-22", () => {
  it("clamps a page past the end; an empty result is page 1 of 1", async () => {
    expect((await listClients({ sort: "name-asc", limit: "2", page: "7" })).pagination).toMatchObject({ page: 2, totalPages: 2, total: 3 });
    expect((await clients.listClients(owner, parseClientListQuery({ search: "aud08c-none", page: "3" }))).pagination).toMatchObject({ page: 1, total: 0 });
  });

  it("a foreign project id narrows to nothing; their own project finds its client", async () => {
    expect((await listClients({ projectId: PROJECT.b })).pagination.total).toBe(0);
    expect((await listClients({ projectId: PROJECT.companyB })).pagination.total).toBe(0);
    expect(ids((await listClients({ projectId: p.p1 })).data)).toEqual([c.c1]);
    expect(ids((await listClients({ search: `${CTAG} Delta` })).data)).toEqual([]);
  });

  it("the client's Projects tab states its true total beside the capped rows", async () => {
    const tab = await clients.listClientProjectsWithTotal(owner, c.c1);
    expect(ids(tab.rows)).toEqual([p.p1]);
    expect(tab.total).toBe(1);
    expect(tab.cap).toBe(100);
  });
});

describe("Archived projects — DT-04, DT-02, DT-05", () => {
  it.each([
    ["name-asc", [p.p2, p.p3, p.p4]],
    ["name-desc", [p.p4, p.p2, p.p3]],
    // A project without a start date sorts last; equal dates fall to the id.
    ["start-asc", [p.p2, p.p4, p.p3]],
  ])("%s", async (sort, expected) => {
    const { seen, totals } = await walk((page) => listArchived({ sort: sort as string, limit: "2", page: String(page) }));
    expect(seen).toEqual(expected);
    expect(totals).toEqual([3]);
  });

  it("the archived section never lists a live project; a page past the end is clamped", async () => {
    expect(ids((await listArchived({ sort: "name-asc" })).data)).not.toContain(p.p1);
    expect((await listArchived({ sort: "name-asc", limit: "2", page: "5" })).pagination).toMatchObject({ page: 2, totalPages: 2, total: 3 });
  });
});
