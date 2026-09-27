import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as getDocument } from "@/app/api/documents/[documentId]/route";
import { GET as listDocumentsRoute, POST as uploadDocumentRoute } from "@/app/api/documents/route";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import type { UserContext } from "@/lib/context/types";
import { documentListQuerySchema, type DocumentListQuery } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import {
  documentFilterOptionsForWorkspace,
  getDocumentOverviewForWorkspace,
  listDocumentCompanies,
  listDocumentsForWorkspace,
  listMyUploadsForWorkspace,
  listRecentForWorkspace,
  workspaceExperience,
} from "@/lib/modules/documents/document.workspace";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * Documents in the Group workspace (Workspace Context §35, §45, §86, §87).
 *
 * Real sessions, real per-company contexts, real database. The Owner of the
 * five-company demo group reads Documents in every company; each fixture below
 * is a project file in a different company, so a group list has to bring each
 * one in through *that company's* own access clause. Nothing here uploads a
 * file: a group list reads rows, and a row opens in its own company.
 */

const TAG = "WS Documents Fixture";
const YEAR_AHEAD = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

const created: string[] = [];
const restore: Array<() => Promise<unknown>> = [];

/** Filing ids never collide: a fixture is found again by its name prefix. */
async function fixture(input: {
  companyId: string;
  label: string;
  projectId?: string;
  uploadedByMemberId?: string | null;
  archived?: boolean;
  updatedAt?: Date;
}): Promise<string> {
  const row = await prisma.document.create({
    data: {
      companyId: input.companyId,
      name: `${TAG} ${input.label}`,
      originalFileName: `${input.label}.pdf`,
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(1024),
      status: input.archived ? "ARCHIVED" : "ACTIVE",
      archivedAt: input.archived ? new Date() : null,
      storageStatus: "AVAILABLE",
      projectId: input.projectId ?? null,
      uploadedByMemberId: input.uploadedByMemberId ?? null,
      createdBy: "group-workspace-test",
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    },
    select: { id: true },
  });
  created.push(row.id);
  return row.id;
}

const query = (overrides: Partial<Record<keyof DocumentListQuery, unknown>> = {}) =>
  documentListQuerySchema.parse({ search: TAG, limit: 100, ...overrides });

const namesOf = (rows: Array<{ name: string }>) => rows.map((row) => row.name.replace(`${TAG} `, "")).sort();

/** The person's own context in one company: the same as a sign-in there. */
async function inCompany(group: UserContext, companyId: string): Promise<UserContext> {
  const readers = await resolveWorkspaceContexts(group, { module: "documents", permission: "document.view" });
  const reader = readers.find((context) => context.companyId === companyId);
  if (!reader) throw new Error(`${companyId} is not a company this person reads`);
  return loginAsMembership(reader.membershipId);
}

/** Turns a module off for one company and puts the flag back afterwards. */
async function switchModule(companyId: string, key: string, enabled: boolean) {
  const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId, module: { key } } });
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled } });
  restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: row.enabled } }));
}

let owner: UserContext;
let ownerAsMemberOfA: string;
let ownerAsMemberOfB: string;
let documentA: string;
let documentB: string;
let documentD: string;
let documentTenant: string;
let archivedC: string;

beforeAll(async () => {
  owner = await loginAs("OWNER", { workspace: "GROUP" });
  const readers = await resolveWorkspaceContexts(owner, { module: "documents", permission: "document.view" });
  ownerAsMemberOfA = readers.find((context) => context.companyId === COMPANY.a)!.membershipId;
  ownerAsMemberOfB = readers.find((context) => context.companyId === COMPANY.b)!.membershipId;

  // Newest of anything in the database, so "recent" has them on top.
  documentA = await fixture({ companyId: COMPANY.a, label: "Aurelia site plan", projectId: PROJECT.a, uploadedByMemberId: ownerAsMemberOfA, updatedAt: YEAR_AHEAD });
  documentB = await fixture({ companyId: COMPANY.b, label: "Meridian tower brief", projectId: PROJECT.b, uploadedByMemberId: ownerAsMemberOfB, updatedAt: YEAR_AHEAD });
  documentD = await fixture({ companyId: COMPANY.d, label: "Forma marina survey", projectId: PROJECT.d, updatedAt: YEAR_AHEAD });
  archivedC = await fixture({ companyId: COMPANY.c, label: "Terra retired lease", projectId: PROJECT.c, archived: true });
  // Another group entirely: nobody in the demo group may ever read it.
  documentTenant = await fixture({ companyId: COMPANY.tenant, label: "Tenant private file", projectId: PROJECT.companyB, updatedAt: YEAR_AHEAD });
}, 60_000);

afterEach(async () => {
  actAs(null);
  for (const undo of restore.splice(0).reverse()) await undo();
});

afterAll(async () => {
  actAs(null);
  for (const undo of restore.splice(0).reverse()) await undo();
  await prisma.document.deleteMany({ where: { OR: [{ id: { in: created } }, { name: { startsWith: TAG } }] } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("the group list (§35, §45)", () => {
  it("reads the documents of every company the person may read, each row naming its own company", async () => {
    const result = await listDocumentsForWorkspace(owner, query());

    expect(namesOf(result.data)).toEqual(["Aurelia site plan", "Forma marina survey", "Meridian tower brief"]);
    expect(result.pagination.total).toBe(3);

    const company = (id: string) => result.data.find((row) => row.id === id)?.company;
    expect(company(documentA)).toEqual({ id: COMPANY.a, name: "Aurelia Construction" });
    expect(company(documentB)).toEqual({ id: COMPANY.b, name: "Meridian Developments" });
    expect(company(documentD)).toEqual({ id: COMPANY.d, name: "Forma Engineering" });
  });

  it("never brings in another group's file, or an archived one, and no company is named outside the group", async () => {
    const all = await listDocumentsForWorkspace(owner, query({ limit: 100 }));
    const ids = all.data.map((row) => row.id);
    expect(ids).not.toContain(documentTenant);
    expect(ids).not.toContain(archivedC);
    for (const row of all.data) expect(row.company?.id).not.toBe(COMPANY.tenant);
  });

  it("is, company by company, exactly the list that company's own page gives", async () => {
    const group = await listDocumentsForWorkspace(owner, query({ search: undefined, limit: 100 }));
    const companies = await listDocumentCompanies(owner);
    expect(companies.length).toBeGreaterThan(1);

    let total = 0;
    for (const company of companies) {
      const own = await documents.listDocuments(await inCompany(owner, company.id), documentListQuerySchema.parse({ limit: 100 }));
      total += own.pagination.total;

      const inGroup = await listDocumentsForWorkspace(owner, query({ search: undefined, limit: 100, companyId: company.id }));
      expect(inGroup.data.map((row) => row.id).sort(), company.name).toEqual(own.data.map((row) => row.id).sort());
      expect(inGroup.data.every((row) => row.company?.id === company.id)).toBe(true);
    }
    // The union is the sum of the companies: nothing lost at a boundary, nothing counted twice.
    expect(group.pagination.total).toBe(total);
  });

  it("paginates over the whole union in the list's own sort, so a file is never on two pages", async () => {
    // All three fixtures share one updatedAt, so only the tiebreak keeps the pages apart.
    const whole = await listDocumentsForWorkspace(owner, query({ sort: "updated-desc", limit: 3, page: 1 }));
    const first = await listDocumentsForWorkspace(owner, query({ sort: "updated-desc", limit: 2, page: 1 }));
    const second = await listDocumentsForWorkspace(owner, query({ sort: "updated-desc", limit: 2, page: 2 }));

    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    expect([...first.data, ...second.data].map((row) => row.id)).toEqual(whole.data.map((row) => row.id));
    expect(new Set(whole.data.map((row) => row.company?.id)).size).toBe(3);
    expect(first.pagination.total).toBe(3);

    const byName = await listDocumentsForWorkspace(owner, query({ sort: "name-asc" }));
    expect(byName.data.map((row) => row.name)).toEqual(["Aurelia site plan", "Forma marina survey", "Meridian tower brief"].map((name) => `${TAG} ${name}`));
  });

  it("searches inside what each company allows: a project's name finds its files only in its company", async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: PROJECT.b }, select: { name: true } });
    const byProject = await listDocumentsForWorkspace(owner, query({ search: project.name }));
    expect(byProject.data.some((row) => row.id === documentB)).toBe(true);
    expect(byProject.data.every((row) => row.company !== undefined)).toBe(true);
  });
});

describe("one company's own workspace (§4, §86)", () => {
  it("lists only that company's documents, unlabelled, exactly as before", async () => {
    const inB = await loginAsMembership(ownerAsMemberOfB);
    expect(inB.workspace.scopeType).toBe("COMPANY");

    const result = await listDocumentsForWorkspace(inB, query());
    expect(namesOf(result.data)).toEqual(["Meridian tower brief"]);
    expect(result.data[0]).not.toHaveProperty("company");

    const direct = await documents.listDocuments(inB, query());
    expect(result).toEqual(direct);
  });

  it("locks the company filter: a company workspace cannot be pointed at another company", async () => {
    const inB = await loginAsMembership(ownerAsMemberOfB);
    const pointed = await listDocumentsForWorkspace(inB, query({ companyId: COMPANY.a }));
    expect(namesOf(pointed.data)).toEqual(["Meridian tower brief"]);
    expect(await listDocumentCompanies(inB)).toEqual([]);
  });

  it("offers the same overview, recents, filters and tabs it always did", async () => {
    const inB = await loginAsMembership(ownerAsMemberOfB);
    expect(await getDocumentOverviewForWorkspace(inB)).toEqual(await documents.getDocumentOverview(inB));
    expect(await listRecentForWorkspace(inB)).toEqual(await documents.listRecent(inB));
    const experience = resolveModuleExperience(inB, "documents");
    expect(workspaceExperience(inB, experience)).toBe(experience);
    const options = await documentFilterOptionsForWorkspace(inB);
    expect(options.projects.every((project) => !project.name.includes("·"))).toBe(true);
  });
});

describe("a company that does not offer Documents (§60, §92)", () => {
  it("contributes nothing while the module is off there, and its files leave the group list", async () => {
    await switchModule(COMPANY.b, "documents", false);
    const fresh = await loginAs("OWNER", { workspace: "GROUP" });

    expect((await listDocumentCompanies(fresh)).map((company) => company.id)).not.toContain(COMPANY.b);
    const result = await listDocumentsForWorkspace(fresh, query());
    expect(namesOf(result.data)).toEqual(["Aurelia site plan", "Forma marina survey"]);
    expect(result.data.map((row) => row.id)).not.toContain(documentB);
  });

  // AUD-08 §3, DT-22: a company whose Documents are off answers no rows; it
  // used to be ignored, answering every other company's files instead.
  it("a company filter that names it answers no rows; the group still reads the rest", async () => {
    await switchModule(COMPANY.b, "documents", false);
    const fresh = await loginAs("OWNER", { workspace: "GROUP" });

    const unfiltered = await listDocumentsForWorkspace(fresh, query());
    const named = await listDocumentsForWorkspace(fresh, query({ companyId: COMPANY.b }));
    expect(named.data.map((row) => row.id)).toEqual([]);
    expect(named.pagination.total).toBe(0);
    expect(unfiltered.data.length).toBeGreaterThan(0);
    expect(unfiltered.data.map((row) => row.id)).not.toContain(documentB);
  });

  it("is refused, not shown as empty, to a person who holds Documents nowhere", async () => {
    for (const company of [COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e]) await switchModule(company, "documents", false);
    const fresh = await loginAs("OWNER", { workspace: "GROUP" });
    await expect(listDocumentsForWorkspace(fresh, query())).rejects.toMatchObject({ code: expect.stringMatching(/MODULE_UNAVAILABLE|FORBIDDEN/) });
  });
});

describe("the company filter (§86, §87)", () => {
  it("narrows the group to one company", async () => {
    const onlyA = await listDocumentsForWorkspace(owner, query({ companyId: COMPANY.a }));
    expect(namesOf(onlyA.data)).toEqual(["Aurelia site plan"]);
    expect(onlyA.pagination.total).toBe(1);

    const onlyD = await listDocumentsForWorkspace(owner, query({ companyId: COMPANY.d }));
    expect(namesOf(onlyD.data)).toEqual(["Forma marina survey"]);
  });

  // AUD-08 §3, DT-22: unreadable, unknown and malformed companies all answer
  // the same empty list — nothing broadens, and nothing says which it was.
  it("a company the person may not read, one that does not exist and a malformed id all answer no rows", async () => {
    const unfiltered = await listDocumentsForWorkspace(owner, query());
    expect(unfiltered.pagination.total).toBeGreaterThan(0);
    for (const companyId of [COMPANY.tenant, COMPANY.works, COMPANY.suspended, "company_that_does_not_exist", "x".repeat(300)]) {
      const result = await listDocumentsForWorkspace(owner, query({ companyId }));
      expect(result.data.map((row) => row.id), companyId).toEqual([]);
      expect(result.pagination.total, companyId).toBe(0);
    }
  });

  it("offers only the companies the group reads, and narrows the other dropdowns with it", async () => {
    const companies = await listDocumentCompanies(owner);
    expect(companies.map((company) => company.id)).toEqual(expect.arrayContaining([COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e]));
    expect(companies.map((company) => company.id)).not.toContain(COMPANY.tenant);

    const all = await documentFilterOptionsForWorkspace(owner);
    const projectA = all.projects.find((project) => project.id === PROJECT.a);
    const projectB = all.projects.find((project) => project.id === PROJECT.b);
    // Two companies can each have a "Tower A": the option says whose it is.
    expect(projectA?.name).toMatch(/· Aurelia Construction$/);
    expect(projectB?.name).toMatch(/· Meridian Developments$/);

    const onlyA = await documentFilterOptionsForWorkspace(owner, COMPANY.a);
    expect(onlyA.projects.find((project) => project.id === PROJECT.a)).toBeTruthy();
    expect(onlyA.projects.find((project) => project.id === PROJECT.b)).toBeUndefined();
    expect(onlyA.projects.every((project) => !project.name.includes("· Meridian"))).toBe(true);
  });
});

describe("a person without group standing (§16, §62)", () => {
  it("reads the two companies they work in, and nothing another company holds", async () => {
    // Architect in Aurelia and in Forma. Working in two opens the group (§7),
    // and it unions exactly those two, each read with its own rules (§60, §62).
    const architect = await loginAsEmail(DEMO_EMAIL.multiCompany, { workspace: "GROUP" });
    expect(architect.workspace.scopeType).toBe("GROUP");

    const result = await listDocumentsForWorkspace(architect, query());
    expect(result.data.map((row) => row.id)).not.toContain(documentB);
    for (const row of result.data) expect([COMPANY.a, COMPANY.d]).toContain(row.company?.id);
    expect((await listDocumentCompanies(architect)).map((company) => company.id).sort()).toEqual([COMPANY.a, COMPANY.d].sort());
  });

  it("a company employee's list is their company's, whatever they ask for", async () => {
    const pm = await loginAs("PROJECT_MANAGER", { workspace: "GROUP" });
    expect(pm.workspace.scopeType).toBe("COMPANY");
    const result = await listDocumentsForWorkspace(pm, query({ companyId: COMPANY.d }));
    expect(result.data.map((row) => row.id)).not.toContain(documentD);
  });
});

describe("the overview (§35)", () => {
  it("counts, in each company, what that company lets this person open", async () => {
    const group = await getDocumentOverviewForWorkspace(owner);
    const companies = await listDocumentCompanies(owner);

    const sum = { visible: 0, addedThisMonth: 0, projectDocuments: 0, archived: 0 };
    for (const company of companies) {
      const own = await documents.getDocumentOverview(await inCompany(owner, company.id));
      sum.visible += own.visible;
      sum.addedThisMonth += own.addedThisMonth;
      sum.projectDocuments += own.projectDocuments;
      sum.archived += own.archived;
    }
    expect(group).toEqual(sum);
    // The retired Terra file counts as archived, the tenant's file counts nowhere.
    expect(group.archived).toBeGreaterThanOrEqual(1);
  });

  it("lists the newest documents of every company, each labelled, and the person's own uploads per company", async () => {
    const recent = await listRecentForWorkspace(owner, 6);
    const recentIds = recent.map((row) => row.id);
    expect(recentIds).toEqual(expect.arrayContaining([documentA, documentB, documentD]));
    expect(recentIds).not.toContain(documentTenant);
    expect(recent.every((row) => row.company !== undefined)).toBe(true);

    const mine = await listMyUploadsForWorkspace(owner, 50);
    const mineIds = mine.map((row) => row.id);
    // Uploaded by this person as a member of Aurelia and of Meridian — two members, one person.
    expect(mineIds).toEqual(expect.arrayContaining([documentA, documentB]));
    expect(mineIds).not.toContain(documentD);
    expect(mine.find((row) => row.id === documentA)?.company?.id).toBe(COMPANY.a);
    expect(mine.find((row) => row.id === documentB)?.company?.id).toBe(COMPANY.b);
  });

  it("filters the group list to the person's own uploads across companies", async () => {
    const mine = await listDocumentsForWorkspace(owner, query({ mine: true }));
    expect(namesOf(mine.data)).toEqual(["Aurelia site plan", "Meridian tower brief"]);
  });

  it("offers only the tabs that answer for the whole group", async () => {
    const experience = resolveModuleExperience(owner, "documents");
    expect(experience.sections.map((section) => section.key)).toContain("archived");
    const group = workspaceExperience(owner, experience);
    expect(group.sections.map((section) => section.key)).toEqual(["overview", "all", "recent"]);
  });
});

describe("GET /api/documents (§85)", () => {
  const url = (search: string) => new Request(`http://localhost/api/documents?${search}`);

  it("answers the group list, every row naming its company", async () => {
    actAs(owner);
    const response = await listDocumentsRoute(url(`search=${encodeURIComponent(TAG)}&limit=50`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; company?: { id: string; name: string } }>; pagination: { total: number } };
    expect(body.pagination.total).toBe(3);
    expect(body.data.find((row) => row.id === documentA)?.company).toEqual({ id: COMPANY.a, name: "Aurelia Construction" });
    expect(body.data.find((row) => row.id === documentB)?.company).toEqual({ id: COMPANY.b, name: "Meridian Developments" });
  });

  // AUD-08 §3, DT-22: a company the person may not read answers no rows. It
  // used to be ignored, answering every company's files — a silent broadening.
  it("narrows to a company with ?company=; one that is not the person's to read answers no rows", async () => {
    actAs(owner);
    const narrowed = await listDocumentsRoute(url(`search=${encodeURIComponent(TAG)}&company=${COMPANY.b}`));
    const narrowedBody = (await narrowed.json()) as { data: Array<{ id: string }> };
    expect(narrowedBody.data.map((row) => row.id)).toEqual([documentB]);

    const foreign = await listDocumentsRoute(url(`search=${encodeURIComponent(TAG)}&company=${COMPANY.tenant}`));
    expect(foreign.status).toBe(200);
    const foreignBody = (await foreign.json()) as { data: Array<{ id: string }> };
    expect(foreignBody.data.map((row) => row.id)).toEqual([]);
  });

  it("in a company workspace answers only that company, without company labels", async () => {
    actAs(await loginAsMembership(ownerAsMemberOfB));
    const response = await listDocumentsRoute(url(`search=${encodeURIComponent(TAG)}&company=${COMPANY.a}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data.map((row) => row.id)).toEqual([documentB]);
    expect(body.data[0]).not.toHaveProperty("company");
  });

  it("keeps everything that writes or opens one company's file company-only", async () => {
    actAs(owner);
    const upload = await uploadDocumentRoute(new Request("http://localhost/api/documents", { method: "POST", body: new FormData() }));
    expect(upload.status).toBe(409);
    expect(((await upload.json()) as { error: { code: string } }).error.code).toBe("WORKSPACE_COMPANY_REQUIRED");

    const one = await getDocument(new Request(`http://localhost/api/documents/${documentA}`), { params: Promise.resolve({ documentId: documentA }) });
    expect(one.status).toBe(409);
  });
});
