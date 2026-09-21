import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as searchRoute } from "@/app/api/search/route";
import { globalSearch, globalSearchForWorkspace } from "@/lib/core/search/search.service";
import type { GlobalSearchResponseDTO } from "@/lib/core/search/search.types";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * Global search in the Group workspace (Workspace Context §40, §99).
 *
 * Real sessions, real resolver, real database. The Owner is a member of every
 * company of the demo group and holds group standing; two of the seeded
 * projects share a word ("Residences": Riverside Residences in Aurelia, Adriatic
 * Hotel & Residences in Nova), which is what lets one query find records in two
 * companies.
 */

const RESIDENCES = { limitPerProvider: 20, totalLimit: 50 };
const restore: Array<() => Promise<unknown>> = [];
let names: Record<string, string> = {};

const projectRows = (response: GlobalSearchResponseDTO) => response.results.filter((row) => row.entityType === "project");

beforeAll(async () => {
  names = Object.fromEntries((await prisma.company.findMany({ select: { id: true, name: true } })).map((company) => [company.id, company.name]));
});

afterEach(async () => {
  actAs(null);
  for (const undo of restore.splice(0).reverse()) await undo();
  await cleanupSessions();
});
afterAll(() => prisma.$disconnect());

describe("group search (§40, §99)", () => {
  it("finds records in more than one company, each labelled with its company", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    expect(owner.workspace.scopeType).toBe("GROUP");

    const found = projectRows(await globalSearchForWorkspace(owner, "Residences", RESIDENCES));
    const byId = new Map(found.map((row) => [row.entityId, row]));

    expect([...byId.keys()].sort()).toEqual([PROJECT.a, PROJECT.e].sort());
    expect(byId.get(PROJECT.a)?.company).toEqual({ id: COMPANY.a, name: names[COMPANY.a] });
    expect(byId.get(PROJECT.e)?.company).toEqual({ id: COMPANY.e, name: names[COMPANY.e] });
    // The href is the company's own page: opening it goes through the enter-company hop.
    expect(byId.get(PROJECT.e)?.href).toBe(`/projects/${PROJECT.e}`);
  });

  it("labels every company-scoped row of every module, not only projects", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const response = await globalSearchForWorkspace(owner, "in", RESIDENCES);
    expect(response.results.length).toBeGreaterThan(0);
    const groupCompanies: string[] = [COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e];
    for (const row of response.results) {
      // A group's person belongs to no company; everything else does.
      if (row.entityType === "person" || row.entityType === "person_qualification") {
        expect(row.company).toBeUndefined();
      } else {
        expect(row.company, `${row.entityType} ${row.entityId}`).toBeDefined();
        expect(groupCompanies).toContain(row.company!.id);
        expect(row.company!.name).toBe(names[row.company!.id]);
      }
    }
    expect(new Set(response.results.filter((row) => row.company).map((row) => row.company!.id)).size).toBeGreaterThan(1);
  });

  it("answers a company workspace from the selected company only, with no company on the row", async () => {
    const owner = await loginAs("OWNER");
    expect(owner.workspace.scopeType).toBe("COMPANY");

    const scoped = await globalSearchForWorkspace(owner, "Residences", RESIDENCES);
    expect(projectRows(scoped).map((row) => row.entityId)).toEqual([PROJECT.a]);
    expect(scoped.results.every((row) => row.company === undefined)).toBe(true);
    // Unchanged: the workspace-aware entry point is `globalSearch` for a company.
    expect(scoped).toEqual(await globalSearch(owner, "Residences", RESIDENCES));
  });

  it("leaves out a company where the module is off, and keeps the rest", async () => {
    const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.e, module: { key: "projects" } } });
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
    restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));

    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const found = projectRows(await globalSearchForWorkspace(owner, "Residences", RESIDENCES));
    expect(found.map((result) => result.entityId)).toEqual([PROJECT.a]);
  });

  it("searches a multi-company person's own two companies, and no other (§7, §60, §62)", async () => {
    // Working in two companies opens the group; it searches exactly those two.
    const architect = await loginAsMembership("member_multicompany_a", { workspace: "GROUP" });
    expect(architect.workspace.scopeType).toBe("GROUP");

    expect(projectRows(await globalSearchForWorkspace(architect, "Residences", RESIDENCES)).map((row) => row.entityId)).toEqual([PROJECT.a]);
    // Forma is theirs, so Marina is found and names its company.
    const marina = projectRows(await globalSearchForWorkspace(architect, "Marina", RESIDENCES));
    expect(marina.map((row) => row.entityId)).toContain(PROJECT.d);
    expect(marina.find((row) => row.entityId === PROJECT.d)?.company?.id).toBe(COMPANY.d);
    // Nova is not theirs at all, whichever workspace they ask from.
    expect((await globalSearchForWorkspace(architect, "Hotel", RESIDENCES)).results.map((row) => row.entityId)).not.toContain(PROJECT.e);
  });

  it("gives a company-only employee their own company however the session was asked (§16, §91)", async () => {
    const pm = await loginAs("PROJECT_MANAGER", { workspace: "GROUP" });
    expect(pm.workspace.scopeType).toBe("COMPANY");

    const own = await globalSearchForWorkspace(pm, "Residences", RESIDENCES);
    expect(projectRows(own).map((row) => row.entityId)).toEqual([PROJECT.a]);
    expect(own.results.every((row) => row.company === undefined)).toBe(true);
  });

  it("narrows to one company by filter, and ignores a company the person may not read", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });

    const narrowed = await globalSearchForWorkspace(owner, "Residences", { ...RESIDENCES, companyId: COMPANY.e });
    expect(projectRows(narrowed).map((row) => row.entityId)).toEqual([PROJECT.e]);
    expect(narrowed.results.filter((row) => row.company).every((row) => row.company!.id === COMPANY.e)).toBe(true);

    const everything = await globalSearchForWorkspace(owner, "Residences", RESIDENCES);
    // Another group's company, and one that does not exist: no filter, and no error that says which.
    for (const companyId of [COMPANY.tenant, "company_that_is_not_there"]) {
      const ignored = await globalSearchForWorkspace(owner, "Residences", { ...RESIDENCES, companyId });
      expect(ignored.results.map((row) => `${row.entityType}:${row.entityId}`)).toEqual(everything.results.map((row) => `${row.entityType}:${row.entityId}`));
      expect(ignored.results.map((row) => row.entityId)).not.toContain("project_b_one");
    }

    // A company workspace has no company filter to offer: it stays its own company (§86).
    const inCompany = await globalSearchForWorkspace(await loginAs("OWNER"), "Residences", { ...RESIDENCES, companyId: COMPANY.e });
    expect(projectRows(inCompany).map((row) => row.entityId)).toEqual([PROJECT.a]);
  });

  it("finds a person of the group once, with no company, and narrows people by the directory's own company filter", async () => {
    // Klea Marku works in Meridian only; the directory is the group's, so she is one row, not one per company.
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const people = (response: GlobalSearchResponseDTO) => response.results.filter((row) => row.entityType === "person" && row.entityId === "person_pm_b");

    const found = people(await globalSearchForWorkspace(owner, "Marku", RESIDENCES));
    expect(found).toHaveLength(1);
    expect(found[0].company).toBeUndefined();
    expect(found[0].href).toBe("/people/person_pm_b");

    expect(people(await globalSearchForWorkspace(owner, "Marku", { ...RESIDENCES, companyId: COMPANY.b }))).toHaveLength(1);
    expect(people(await globalSearchForWorkspace(owner, "Marku", { ...RESIDENCES, companyId: COMPANY.a }))).toHaveLength(0);
  });

  it("keeps the same per-provider allowance, so a group of five is not five times slower", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    const started = Date.now();
    const response = await globalSearchForWorkspace(owner, "in", RESIDENCES);
    const elapsed = Date.now() - started;
    expect(response.partial).toBe(false);
    // Companies run in parallel: the whole search stays within a few provider timeouts (700 ms each), never one per company.
    expect(elapsed).toBeLessThan(4 * 700);
  });

  it("is reachable in the Group workspace through the API and carries the company and the filter", async () => {
    actAs(await loginAs("OWNER", { workspace: "GROUP" }));
    const call = (query: string) => searchRoute(new Request(`http://nesto.test/api/search?q=Residences&limit=50${query}`));

    const response = await call("");
    expect(response.status).toBe(200);
    const body = (await response.json()) as GlobalSearchResponseDTO;
    expect(projectRows(body).map((row) => row.company?.id).sort()).toEqual([COMPANY.a, COMPANY.e].sort());

    const narrowed = (await (await call(`&company=${COMPANY.a}`)).json()) as GlobalSearchResponseDTO;
    expect(projectRows(narrowed).map((row) => row.entityId)).toEqual([PROJECT.a]);

    const foreign = await call(`&company=${COMPANY.tenant}`);
    expect(foreign.status).toBe(200);
    expect(projectRows((await foreign.json()) as GlobalSearchResponseDTO).map((row) => row.entityId)).toEqual(projectRows(body).map((row) => row.entityId));
  });

  it("answers the same route from the company's own search in a company workspace", async () => {
    actAs(await loginAs("OWNER"));
    const response = await searchRoute(new Request("http://nesto.test/api/search?q=Residences&limit=50"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as GlobalSearchResponseDTO;
    expect(projectRows(body).map((row) => row.entityId)).toEqual([PROJECT.a]);
    expect(body.results.every((row) => row.company === undefined)).toBe(true);
  });
});
