import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { resolveContextForSession } from "@/lib/context/build-context";
import { histogramSeries } from "@/lib/core/observability/metrics";
import type { UserContext } from "@/lib/context/types";
import { readDocumentThumbnail } from "@/lib/modules/documents/storage/thumbnail.service";
import { addFavorite } from "@/lib/modules/productivity/favorites.service";
import {
  contextForProject,
  creatableCompanies,
  listPortfolioProjects,
  openPortfolioProject,
  projectInitials,
} from "@/lib/modules/projects/project.portfolio";
import { parsePortfolioQuery } from "@/lib/modules/projects/project.query";
import { createProjectSchema, portfolioQuerySchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import { seedStoredDocument } from "../../../prisma/seed/document-objects";
import { cleanupSessions, COMPANY, DEMO_EMAIL, grantGroupStanding, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * The Projects page (E-05A §63-§69; Projects Workspace Grid §193-§197).
 *
 * Every case runs the real services against the seeded database through real
 * sessions — the multi-company person is `multicompany`, an Architect in
 * Aurelia on Riverside Residences and in Forma on Marina Apartments. The Owner
 * belongs to all five demo companies; the fixture tenant is another group.
 *
 * What the Projects page lists is what the active workspace reads (Workspace
 * Context §30, §83): every authorised company's projects in the Group workspace,
 * one company's in a company workspace. The cross-company mechanics below are
 * therefore run in the Group workspace — the Owner has standing by role, and the
 * multi-company Architect is given it by a group-scope grant for these cases —
 * and "the company workspace lists one company" has its own cases at the end.
 */

/** The Group workspace, which the resolver grants only to somebody with group-level standing. */
const GROUP = { workspace: "GROUP" } as const;

const COMPANY_A = COMPANY.a;
const COMPANY_B = COMPANY.b;
const COMPANY_D = COMPANY.d;
const COMPANY_E = COMPANY.e;
const MULTI_A = "member_multicompany_a";
const MULTI_D = "member_multicompany_d";

let undoStanding: (() => Promise<void>) | null = null;

beforeAll(async () => {
  const multi = await prisma.user.findFirstOrThrow({ where: { email: DEMO_EMAIL.multiCompany } });
  undoStanding = await grantGroupStanding(multi.id);
});

const tempProjects: string[] = [];
const tempTypes: string[] = [];

/** A company's own project type, by name (E-05A §62). */
async function typeId(companyId: string, name: string) {
  return (await prisma.projectType.findFirstOrThrow({ where: { companyId, name }, select: { id: true } })).id;
}
const tempMembers: string[] = [];
const tempDocuments: string[] = [];

afterEach(async () => {
  if (tempProjects.length > 0) {
    await prisma.userFavorite.deleteMany({ where: { entityType: "project", entityId: { in: tempProjects } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: tempProjects } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: tempProjects } } });
    await prisma.project.deleteMany({ where: { id: { in: tempProjects } } });
    tempProjects.length = 0;
  }
  if (tempDocuments.length > 0) {
    await prisma.document.deleteMany({ where: { id: { in: tempDocuments } } });
    tempDocuments.length = 0;
  }
  if (tempTypes.length > 0) {
    await prisma.projectType.deleteMany({ where: { id: { in: tempTypes } } });
    tempTypes.length = 0;
  }
  if (tempMembers.length > 0) {
    await cleanupSessions();
    await prisma.userFavorite.deleteMany({ where: { memberId: { in: tempMembers } } });
    await prisma.companyMember.deleteMany({ where: { id: { in: tempMembers } } });
    tempMembers.length = 0;
  }
  await prisma.userFavorite.deleteMany({ where: { memberId: { in: [MULTI_A, MULTI_D] } } });
});

afterAll(async () => {
  await cleanupSessions();
  await undoStanding?.();
  await prisma.$disconnect();
});

const query = (overrides: Record<string, unknown> = {}) => portfolioQuerySchema.parse({ limit: 60, ...overrides });
const ids = async (context: UserContext, overrides: Record<string, unknown> = {}) =>
  (await listPortfolioProjects(context, query(overrides))).items.map((item) => item.id);

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
}

let sequence = 0;
async function tempProject(overrides: {
  companyId?: string;
  name?: string;
  status?: "PENDING" | "ACTIVE" | "FINISHED" | "ARCHIVED";
  lastActivityAt?: Date;
  managerMemberId?: string | null;
  memberIds?: string[];
  /** A type name in the project's company. */
  projectType?: string | null;
  city?: string | null;
  memberRole?: string;
}) {
  sequence += 1;
  const id = `e05a_${Date.now().toString(36)}_${sequence}`;
  await prisma.project.create({
    data: {
      id,
      companyId: overrides.companyId ?? COMPANY_A,
      code: `E05A-${Date.now().toString(36)}-${sequence}`,
      name: overrides.name ?? `E05A Project ${sequence}`,
      status: overrides.status ?? "ACTIVE",
      projectTypeId: overrides.projectType ? await typeId(overrides.companyId ?? COMPANY_A, overrides.projectType) : null,
      city: overrides.city ?? null,
      projectManagerMemberId: overrides.managerMemberId ?? null,
      lastActivityAt: overrides.lastActivityAt ?? new Date(),
      createdBy: "test",
      ...(overrides.status === "ARCHIVED" ? { archivedAt: new Date(), preArchiveStatus: "ACTIVE" } : {}),
    },
  });
  for (const companyMemberId of overrides.memberIds ?? []) {
    await prisma.projectMember.create({
      data: { companyId: overrides.companyId ?? COMPANY_A, projectId: id, companyMemberId, status: "ACTIVE", projectRole: overrides.memberRole ?? "Project Manager" },
    });
  }
  tempProjects.push(id);
  return id;
}

async function memberIdFor(role: string) {
  const context = await loginAs(role as never);
  return context.membershipId;
}

/** A membership this person does not have in the seed, in a role they do not hold there. */
async function tempMembership(userId: string, companyId: string, roleKey: string) {
  const role = await prisma.role.findFirstOrThrow({ where: { key: roleKey } });
  sequence += 1;
  const id = `e05a_member_${Date.now().toString(36)}_${sequence}`;
  await prisma.companyMember.create({ data: { id, companyId, userId, roleId: role.id, status: "ACTIVE" } });
  tempMembers.push(id);
  return id;
}

/* -------------------------------------------------------------------------- */

describe("authorisation across companies (E-05A §63)", () => {
  it("shows the multi-company person their assigned projects in both companies, whichever company the session is in", async () => {
    const inA = await loginAsMembership(MULTI_A, GROUP);
    const inD = await loginAsMembership(MULTI_D, GROUP);

    expect((await ids(inA)).sort()).toEqual([PROJECT.a, PROJECT.d].sort());
    expect((await ids(inD)).sort()).toEqual([PROJECT.a, PROJECT.d].sort());

    const result = await listPortfolioProjects(inA, query());
    expect(result.meta).toMatchObject({ visibleProjectCount: 2, visibleCompanyCount: 2 });
    expect(result.items.find((item) => item.id === PROJECT.d)?.company).toMatchObject({ id: COMPANY_D, isCurrent: false });
  });

  it("keeps a single-company Architect to their own assigned projects", async () => {
    await tempProject({ name: "Unassigned Aurelia project" });
    const architect = await loginAs("ARCHITECT");
    expect(await ids(architect)).toEqual([PROJECT.a]);
    expect((await listPortfolioProjects(architect, query())).meta.visibleCompanyCount).toBe(1);
  });

  it("gives a company-scope Owner every live project in their companies and none in another", async () => {
    const owner = await loginAs("OWNER", GROUP);
    expect((await ids(owner)).sort()).toEqual([PROJECT.a, PROJECT.b, PROJECT.c, PROJECT.d, PROJECT.e].sort());

    const works = await loginAsEmail(DEMO_EMAIL.fixtureOwner);
    expect(await ids(works)).toEqual([PROJECT.f]);

    const ownerB = await loginAsMembership("member_owner_b");
    expect((await ids(ownerB)).sort()).toEqual(["project_b_one", "project_b_two"]);
  });

  it("counts only the projects and companies the person can see, never what is hidden (Projects Workspace Grid §15, §18, §19)", async () => {
    await tempProject({ companyId: COMPANY_D, name: "Unassigned Forma project" });
    const multi = await loginAsMembership(MULTI_A, GROUP);
    expect((await listPortfolioProjects(multi, query())).meta).toEqual({ visibleProjectCount: 2, visibleCompanyCount: 2, onlyCompany: null, matchingCount: 2 });

    const owner = await loginAs("OWNER", GROUP);
    const meta = (await listPortfolioProjects(owner, query())).meta;
    expect(meta).toMatchObject({ visibleCompanyCount: 5, onlyCompany: null });
    const live = { companyId: { in: [COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e] }, archivedAt: null, status: { not: "ARCHIVED" as const } };
    expect(meta.visibleProjectCount).toBe(await prisma.project.count({ where: live }));

    // One company's projects are counted "in" that company.
    const architect = await loginAs("ARCHITECT");
    expect((await listPortfolioProjects(architect, query())).meta).toEqual({ visibleProjectCount: 1, visibleCompanyCount: 1, onlyCompany: { id: COMPANY_A, name: "Aurelia Construction" }, matchingCount: 1 });
  });

  it("searches inside the authorised set only, and a search never moves the count (§22, §196)", async () => {
    const owner = await loginAs("OWNER", GROUP);
    expect(await ids(owner, { q: "Munich" })).toEqual([]);

    const multi = await loginAsMembership(MULTI_A, GROUP);
    expect(await ids(multi, { q: "Durrës" })).toEqual([]);
    expect(await ids(multi, { q: "Vlorë" })).toEqual([PROJECT.d]);
    expect(await ids(multi, { q: "Forma Engineering" })).toEqual([PROJECT.d]);
    expect(await ids(multi, { q: "d-prj" })).toEqual([PROJECT.d]);
    expect(await ids(multi, { q: "albania" })).toEqual([PROJECT.d, PROJECT.a]);

    const searched = await listPortfolioProjects(multi, query({ q: "Marina" }));
    expect(searched.meta).toMatchObject({ visibleProjectCount: 2, matchingCount: 1 });
  });

  it("matches a company's name only in the Group workspace, and never a project type the card does not show (§25)", async () => {
    const inGroup = await loginAs("OWNER", GROUP);
    expect(await ids(inGroup, { q: "Aurelia" })).toEqual([PROJECT.a]);
    const inCompany = await loginAs("OWNER");
    expect(await ids(inCompany, { q: "Aurelia" })).toEqual([]);
    expect(await ids(inCompany, { q: "Riverside" })).toEqual([PROJECT.a]);
    // Project C is the demo's Industrial project; the word is nowhere on its card.
    expect(await ids(inGroup, { q: "industrial" })).toEqual([]);
  });

  it("reads no company, filter or sort from a request: the workspace alone chooses the companies (§108, §183)", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const all = await ids(owner);
    for (const retired of [`company=${COMPANY.tenant}`, `companyId=${COMPANY.tenant}`, `companyId=${COMPANY_A}`, "status=FINISHED", "favorites=1", "role=@assigned", "type=Industrial", "location=city:Vlorë", "sort=name-desc", "view=list"]) {
      const parsed = parsePortfolioQuery(new URLSearchParams(retired));
      expect(parsed, retired).toEqual({ limit: 24 });
      expect(await ids(owner, { ...parsed, limit: 60 }), retired).toEqual(all);
    }

    const inA = await loginAsMembership(MULTI_A);
    expect(await ids(inA, parsePortfolioQuery(new URLSearchParams(`companyId=${COMPANY_D}`)))).toEqual([PROJECT.a]);
  });

  it("refuses a person who can open projects nowhere", async () => {
    await expectError(listPortfolioProjects(await loginAs("GROUP_IT"), query()), "FORBIDDEN");
  });
});

describe("opening a project in its own company (E-05A §26, §63.7)", () => {
  it("moves the session to the project's company, and only then", async () => {
    // In the Group workspace no company is current, so a project is entered through its own company.
    const session = await loginAsMembership(MULTI_A, GROUP);

    const there = await openPortfolioProject(session, PROJECT.d);
    expect(there).toMatchObject({ switched: true, company: { id: COMPANY_D } });

    const resolved = await resolveContextForSession(session.sessionId, { expectedUserId: session.userId });
    expect(resolved.ok && resolved.context.companyId).toBe(COMPANY_D);
    expect(resolved.ok && resolved.context.membershipId).toBe(MULTI_D);
    // Opening a project enters a company workspace, and leaves the group's (Workspace Context §31).
    expect(resolved.ok && resolved.context.workspace).toEqual({ parentGroupId: "group_demo_nesto", scopeType: "COMPANY", companyId: COMPANY_D });

    // A project in the company the session is now in changes nothing.
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(await openPortfolioProject(resolved.context, PROJECT.d)).toMatchObject({ switched: false, company: { id: COMPANY_D } });

    const event = await prisma.authEvent.findFirst({
      where: { sessionId: session.sessionId, type: "COMPANY_CONTEXT_SWITCHED" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.metadata).toMatchObject({
      fromCompanyId: COMPANY_A,
      toCompanyId: COMPANY_D,
      projectId: PROJECT.d,
      event: "WORKSPACE_CHANGED",
      previousScopeType: "GROUP",
      nextScopeType: "COMPANY",
      nextCompanyId: COMPANY_D,
    });
  });

  it("refuses a project the person cannot open in any company, and moves nothing", async () => {
    const session = await loginAsMembership(MULTI_A, GROUP);
    const unassignedInD = await tempProject({ companyId: COMPANY_D });
    await expectError(openPortfolioProject(session, unassignedInD), "NOT_FOUND");
    await expectError(openPortfolioProject(session, PROJECT.b), "NOT_FOUND");
    await expectError(openPortfolioProject(session, "project_b_one"), "NOT_FOUND");
    await expectError(openPortfolioProject(await loginAs("VIEWER"), "project_b_one"), "NOT_FOUND");

    const row = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(row?.currentCompanyId).toBe(COMPANY_A);
  });
});

describe("a company workspace lists one company (Workspace Context §30, §83)", () => {
  it("shows the multi-company person the company they work in, and the other one after they switch", async () => {
    const inA = await loginAsMembership(MULTI_A);
    const inD = await loginAsMembership(MULTI_D);
    expect(await ids(inA)).toEqual([PROJECT.a]);
    expect(await ids(inD)).toEqual([PROJECT.d]);
    expect((await listPortfolioProjects(inA, query())).meta).toMatchObject({ visibleProjectCount: 1, visibleCompanyCount: 1, onlyCompany: { id: COMPANY_A } });
  });

  it("gives an Owner in a company workspace that company's projects, and the group's five in the Group workspace", async () => {
    const inCompany = await loginAs("OWNER");
    expect(inCompany.workspace.scopeType).toBe("COMPANY");
    expect(await ids(inCompany)).toEqual([PROJECT.a]);
    expect((await ids(await loginAs("OWNER", GROUP))).sort()).toEqual([PROJECT.a, PROJECT.b, PROJECT.c, PROJECT.d, PROJECT.e].sort());
  });

  it("does not find another company's project from a company workspace — entering it is the way in", async () => {
    const inA = await loginAsMembership(MULTI_A);
    await expectError(openPortfolioProject(inA, PROJECT.d), "NOT_FOUND");
    expect((await contextForProject(await loginAsMembership(MULTI_A, GROUP), PROJECT.d)).companyId).toBe(COMPANY_D);
  });
});

describe("ordering (Projects Workspace Grid §34-§36, §127-§130)", () => {
  it("lists Active, then Pending, then Finished, each by name, and leaves Archived out", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const label = `Ordering ${Date.now()}`;
    const finishedA = await tempProject({ name: `${label} A`, status: "FINISHED" });
    const pendingB = await tempProject({ name: `${label} B`, status: "PENDING", companyId: COMPANY_B });
    const activeC = await tempProject({ name: `${label} C`, status: "ACTIVE", companyId: COMPANY_D });
    const pendingA = await tempProject({ name: `${label} A2`, status: "PENDING" });
    const activeA = await tempProject({ name: `${label} A3`, status: "ACTIVE", companyId: COMPANY_E });
    await tempProject({ name: `${label} archived`, status: "ARCHIVED" });

    const expected = [activeA, activeC, pendingA, pendingB, finishedA];
    expect(await ids(owner, { q: label })).toEqual(expected);

    // A cursor walk crosses both status boundaries without skipping or
    // repeating anything, whatever the page size.
    for (const limit of [1, 2, 3]) {
      const walked: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listPortfolioProjects(owner, query({ q: label, limit, cursor }));
        walked.push(...page.items.map((item) => item.id));
        cursor = page.pageInfo.nextCursor ?? undefined;
        expect(page.pageInfo.hasNextPage).toBe(Boolean(cursor));
      } while (cursor);
      expect(walked, `limit ${limit}`).toEqual(expected);
    }
  });

  it("orders nothing by favorites or recent activity (§32, §33)", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const label = `Unmoved ${Date.now()}`;
    const first = await tempProject({ name: `${label} A`, lastActivityAt: new Date(Date.UTC(2020, 0, 1)) });
    const second = await tempProject({ name: `${label} B`, lastActivityAt: new Date() });
    await addFavorite(owner, { entityType: "project", entityId: second });
    expect(await ids(owner, { q: label })).toEqual([first, second]);
  });

  it("orders the same name by id, so the order is total", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const name = `Twin ${Date.now()}`;
    const one = await tempProject({ name, companyId: COMPANY_B });
    const two = await tempProject({ name, companyId: COMPANY.c });
    const first = await listPortfolioProjects(owner, query({ q: name, limit: 1 }));
    const second = await listPortfolioProjects(owner, query({ q: name, limit: 1, cursor: first.pageInfo.nextCursor ?? undefined }));
    // By the database's own order of the ids, which the cursor compares in.
    const byId = await prisma.project.findMany({ where: { id: { in: [one, two] } }, orderBy: { id: "asc" }, select: { id: true } });
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(byId.map((row) => row.id));
    expect(second.pageInfo.hasNextPage).toBe(false);
  });

  it("refuses a cursor it did not write", async () => {
    const owner = await loginAs("OWNER", GROUP);
    await expectError(listPortfolioProjects(owner, query({ cursor: "not-a-cursor" })), "VALIDATION_ERROR");
    // One from the old favorites-first order, and one naming the archived run.
    const retired = Buffer.from(JSON.stringify({ p: "fav", v: ["x"] })).toString("base64url");
    await expectError(listPortfolioProjects(owner, query({ cursor: retired })), "VALIDATION_ERROR");
    const archived = Buffer.from(JSON.stringify({ s: "ARCHIVED", v: ["a", "b"] })).toString("base64url");
    await expectError(listPortfolioProjects(owner, query({ cursor: archived })), "VALIDATION_ERROR");
  });

  it("times each page into project_discovery_query_ms by workspace scope (§172)", async () => {
    const count = (scope: string) =>
      histogramSeries().find((series) => series.name === "project_discovery_query_ms" && series.labels.scope === scope && series.labels.outcome === "success")?.count ?? 0;
    const [group, company] = [count("group"), count("company")];
    await listPortfolioProjects(await loginAs("OWNER", GROUP), query());
    await listPortfolioProjects(await loginAs("OWNER"), query());
    expect([count("group"), count("company")]).toEqual([group + 1, company + 1]);
  });
});

describe("favorites (Projects Workspace Grid §31, §32, §123-§126)", () => {
  it("marks one person's stars and nobody else's", async () => {
    const multi = await loginAsMembership(MULTI_A, GROUP);
    await addFavorite(await contextForProject(multi, PROJECT.d), { entityType: "project", entityId: PROJECT.d });
    const favorite = await prisma.userFavorite.findFirst({ where: { entityType: "project", entityId: PROJECT.d, memberId: MULTI_D } });
    expect(favorite?.companyId).toBe(COMPANY_D);

    const items = (await listPortfolioProjects(multi, query())).items;
    expect(items.filter((item) => item.isFavorite).map((item) => item.id)).toEqual([PROJECT.d]);

    const owner = await loginAs("OWNER", GROUP);
    expect((await listPortfolioProjects(owner, query())).items.every((item) => !item.isFavorite)).toBe(true);
  });

  it("never shows a starred project the person can no longer open", async () => {
    const multi = await loginAsMembership(MULTI_A, GROUP);
    const name = `Starred ${Date.now()}`;
    const projectId = await tempProject({ companyId: COMPANY_D, name, memberIds: [MULTI_D], memberRole: "Architect" });
    await addFavorite(await contextForProject(multi, projectId), { entityType: "project", entityId: projectId });
    expect(await ids(multi, { q: name })).toEqual([projectId]);

    // Access removed; the star stays behind and opens nothing.
    await prisma.projectMember.deleteMany({ where: { projectId } });
    expect(await prisma.userFavorite.count({ where: { entityId: projectId } })).toBe(1);
    const after = await loginAsMembership(MULTI_A, GROUP);
    expect(await ids(after, { q: name })).toEqual([]);
    expect((await listPortfolioProjects(after, query())).meta.visibleProjectCount).toBe(2);
  });
});

describe("what each card carries (Projects Workspace Grid §42, §59-§62, §88, §89)", () => {
  it("sends only what the card draws: name, company, place, status, cover, initials and the star", async () => {
    const multi = await loginAsMembership(MULTI_A, GROUP);
    const riverside = (await listPortfolioProjects(multi, query())).items.find((item) => item.id === PROJECT.a)!;

    expect(riverside).toEqual({
      id: PROJECT.a,
      code: "A-PRJ-001",
      name: "Riverside Residences",
      status: "ACTIVE",
      href: `/projects/${PROJECT.a}`,
      // No company is the session's in the Group workspace: a project is entered through its own.
      company: { id: COMPANY_A, name: "Aurelia Construction", isCurrent: false },
      location: { city: "Tiranë", country: "Albania" },
      cover: riverside.cover,
      initials: "RR",
      isFavorite: false,
      canFavorite: true,
    });
    expect((await listPortfolioProjects(await loginAsMembership(MULTI_A), query())).items[0]!.company.isCurrent).toBe(true);
  });

  it("leaves out a place the project does not record, and makes initials from the first two words (§47, §62)", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const name = `eyes of Tirana ${Date.now()}`;
    await tempProject({ name });
    expect((await listPortfolioProjects(owner, query({ q: name }))).items[0]).toMatchObject({ location: null, initials: "EO" });
    expect(projectInitials("  Ëndrra   Blu ")).toBe("ËB");
    expect(projectInitials("Farka")).toBe("F");
  });

  it("offers a cover only to a reader who can open its document, as a 3:4 thumbnail", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const projectId = await tempProject({ name: `Cover ${Date.now()}`, memberIds: [owner.membershipId] });
    const documentId = `e05a_cover_${Date.now().toString(36)}`;
    await seedStoredDocument(prisma, { id: documentId, companyId: COMPANY_A, name: "render.jpg", projectId, uploadedByMemberId: owner.membershipId, createdBy: owner.userId });
    tempDocuments.push(documentId);

    const updated = await projects.updateProject(owner, projectId, {
      code: (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).code,
      name: `Cover ${Date.now()}`,
      coverImageDocumentId: documentId,
    } as never);
    expect(updated.coverImageDocumentId).toBe(documentId);

    const item = (await listPortfolioProjects(owner, query({ q: updated.name }))).items[0]!;
    expect(item.cover?.thumbnailUrl).toMatch(new RegExp(`^/api/projects/${projectId}/cover\\?v=`));
    // The same cover keeps the same address between loads (§98).
    expect((await listPortfolioProjects(owner, query({ q: updated.name }))).items[0]!.cover).toEqual(item.cover);

    const thumbnail = await readDocumentThumbnail(owner, documentId);
    const metadata = await sharp(Buffer.from(thumbnail.body)).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(["webp", 600, 800]);

    // A cover must be an image on this project the editor can open.
    await expectError(
      projects.updateProject(owner, projectId, { code: updated.code, name: updated.name, coverImageDocumentId: "doc_that_is_not_here" } as never),
      "VALIDATION_ERROR",
    );

    // Somebody who can see the project but not its files sees no cover.
    await prisma.document.update({ where: { id: documentId }, data: { module: "procurement" } });
    const architectMember = await memberIdFor("ARCHITECT");
    await prisma.projectMember.create({ data: { companyId: COMPANY_A, projectId, companyMemberId: architectMember, status: "ACTIVE" } });
    const architect = await loginAs("ARCHITECT");
    const seen = (await listPortfolioProjects(architect, query({ q: updated.name }))).items[0]!;
    expect(seen.id).toBe(projectId);
    expect(seen.cover).toBeNull();
    await expectError(readDocumentThumbnail(architect, documentId), "NOT_FOUND");
  });
});

describe("status (E-05A §11, §12, §68)", () => {
  it("lets a Project Manager move a project they manage, audited with both states and the reason", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const projectId = await tempProject({ status: "ACTIVE", managerMemberId: pm.membershipId, memberIds: [pm.membershipId] });

    const finished = await projects.changeProjectStatus(pm, projectId, { status: "FINISHED", reason: "Handover completed" });
    expect(finished.status).toBe("FINISHED");

    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: projectId, actionKey: "PROJECT_STATUS_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toMatchObject({ companyId: COMPANY_A, actorUserId: pm.userId, reason: "Handover completed" });
    expect(JSON.stringify([audit?.beforeJson, audit?.afterJson, audit?.changesJson])).toContain("FINISHED");

    // Finished is still an ordinary project on the page.
    expect(await ids(pm)).toContain(projectId);

    expect((await projects.changeProjectStatus(pm, projectId, { status: "ACTIVE" })).status).toBe("ACTIVE");
    // Returning to Pending is a correction, and says why.
    await expectError(projects.changeProjectStatus(pm, projectId, { status: "PENDING" }), "VALIDATION_ERROR");
    expect((await projects.changeProjectStatus(pm, projectId, { status: "PENDING", reason: "Started too early" })).status).toBe("PENDING");
  });

  it("refuses a Project Manager on a project they do not run, and an Architect everywhere", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const unassigned = await tempProject({ status: "ACTIVE" });
    await expectError(projects.changeProjectStatus(pm, unassigned, { status: "FINISHED" }), "NOT_FOUND");

    const architect = await loginAs("ARCHITECT");
    await expectError(projects.changeProjectStatus(architect, PROJECT.a, { status: "FINISHED" }), "FORBIDDEN");

    // Editing the project does not carry the status with it.
    const project = await projects.getProject(architect, PROJECT.a);
    await expectError(
      projects.updateProject(architect, PROJECT.a, { code: project.code, name: project.name, status: "FINISHED" } as never),
      "FORBIDDEN",
    );
  });

  it("lets the CEO manage status in their company and nobody reach another company's project", async () => {
    const ceo = await loginAs("CEO");
    const projectId = await tempProject({ status: "PENDING" });
    expect((await projects.changeProjectStatus(ceo, projectId, { status: "ACTIVE" })).status).toBe("ACTIVE");

    const ownerB = await loginAsMembership("member_owner_b");
    await expectError(contextForProject(ownerB, projectId), "NOT_FOUND");
  });

  it("lets only one of two simultaneous moves land", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const projectId = await tempProject({ status: "ACTIVE" });
    const outcomes = await Promise.allSettled([
      projects.changeProjectStatus(owner, projectId, { status: "FINISHED" }),
      projects.changeProjectStatus(owner, projectId, { status: "PENDING", reason: "Not started" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as AccessError).code).toBe("CONFLICT");
  });

  it("refuses to move an archived project", async () => {
    const owner = await loginAsEmail(DEMO_EMAIL.fixtureOwner);
    await expectError(projects.changeProjectStatus(owner, PROJECT.archived, { status: "ACTIVE" }), "CONFLICT");
  });
});

describe("create (E-05A §29-§31, §67)", () => {
  let hospitalA = "";
  beforeAll(async () => {
    hospitalA = await typeId(COMPANY_A, "Hospital");
  });
  const input = (overrides: Record<string, unknown> = {}) =>
    createProjectSchema.parse({ code: `E05A-NEW-${Date.now().toString(36)}`, name: "E-05A created project", projectTypeId: hospitalA, ...overrides });

  it("creates Pending by default for the Owner and the CEO, audited", async () => {
    for (const role of ["OWNER", "CEO"] as const) {
      const context = await loginAs(role);
      const created = await projects.createProject(context, input());
      tempProjects.push(created.id);
      expect(created).toMatchObject({ status: "PENDING", company: { id: COMPANY_A }, projectType: { id: hospitalA, name: "Hospital" } });
      const audit = await prisma.auditEvent.findFirst({ where: { entityId: created.id, actionKey: "PROJECT_CREATED" } });
      expect(audit?.actorUserId).toBe(context.userId);
    }
  });

  it("refuses the Project Manager, the Architect and the multi-company person by default", async () => {
    await expectError(projects.createProject(await loginAs("PROJECT_MANAGER"), input()), "FORBIDDEN");
    await expectError(projects.createProject(await loginAs("ARCHITECT"), input()), "FORBIDDEN");
    const multi = await loginAsMembership(MULTI_A, GROUP);
    expect(await creatableCompanies(multi)).toEqual([]);
  });

  it("lets a role create once it is granted project.create, without the status coming with it (E-05A §104, §105)", async () => {
    // E-05A's Architecture Manager creates only where granted; an Architect granted the
    // permission stands in for one, the way a company would configure it.
    const architect = await loginAs("ARCHITECT");
    const granted = { ...architect, permissions: [...architect.permissions, "project.create" as const] };

    // Taking the project on themselves needs no manager grant, and keeps it in their own scope.
    const created = await projects.createProject(granted, input({ projectManagerMemberId: architect.membershipId }));
    tempProjects.push(created.id);
    expect(created.status).toBe("PENDING");
    await expectError(projects.createProject(granted, input({ status: "ACTIVE", projectManagerMemberId: architect.membershipId })), "FORBIDDEN");
    await expectError(projects.changeProjectStatus(granted, created.id, { status: "ACTIVE" }), "FORBIDDEN");
  });

  it("enforces a project code once per company, not across companies (E-05A §14)", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const code = `E05A-DUP-${Date.now().toString(36)}`;
    const first = await projects.createProject(owner, input({ code }));
    tempProjects.push(first.id);
    await expectError(projects.createProject(owner, input({ code, name: "Second with the same code" })), "CONFLICT");

    const inB = await tempProject({ companyId: COMPANY_B });
    await prisma.project.update({ where: { id: inB }, data: { code } });
    expect((await prisma.project.findMany({ where: { code } })).map((row) => row.companyId).sort()).toEqual([COMPANY_A, COMPANY_B]);
  });

  it("offers and accepts only the company's types in use, and keeps a retired one on its project (E-05A §62)", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const retired = await prisma.projectType.create({ data: { companyId: COMPANY_A, name: `Retired ${Date.now()}`, isActive: false } });
    tempTypes.push(retired.id);

    await expectError(projects.createProject(owner, input({ projectTypeId: retired.id })), "VALIDATION_ERROR");
    await expectError(projects.createProject(owner, input({ projectTypeId: await typeId(COMPANY_B, "Hotel") })), "VALIDATION_ERROR");
    expect(createProjectSchema.safeParse({ code: "X-1", name: "No type" }).success).toBe(false);

    const projectId = await tempProject({ name: `Retired type ${Date.now()}` });
    await prisma.project.update({ where: { id: projectId }, data: { projectTypeId: retired.id } });
    const project = await projects.getProject(owner, projectId);
    const saved = await projects.updateProject(owner, projectId, { code: project.code, name: `${project.name} renamed`, projectTypeId: retired.id } as never);
    expect(saved.projectType).toEqual({ id: retired.id, name: retired.name });
  });

  it("refuses a company named in the body where the person cannot create", async () => {
    const owner = await loginAs("OWNER", GROUP);
    await expectError(projects.createProject(owner, input({ companyId: COMPANY.tenant })), "FORBIDDEN");
    await expectError(projects.createProject(await loginAsMembership(MULTI_A, GROUP), input({ companyId: COMPANY_D })), "FORBIDDEN");
    await expectError(projects.createProject(owner, input({ companyId: "company_that_does_not_exist" })), "FORBIDDEN");
  });

  it("creates in the workspace's company for somebody who may create in two (Workspace Context §29, §57)", async () => {
    const ceo = await loginAs("CEO");
    const membershipInB = await tempMembership(ceo.userId, COMPANY_B, "CEO");

    // The workspace decides where a project is created. Working in Company A,
    // a CEO of both is offered A alone and cannot reach B by naming it.
    expect((await creatableCompanies(ceo)).map((company) => company.id)).toEqual([COMPANY_A]);
    await expectError(projects.createProject(ceo, input({ companyId: COMPANY_B, projectTypeId: await typeId(COMPANY_B, "Hospital") })), "FORBIDDEN");

    // In Company B's workspace, the same person creates there.
    const ceoInB = await loginAsMembership(membershipInB);
    expect((await creatableCompanies(ceoInB)).map((company) => company.id)).toEqual([COMPANY_B]);

    // A type is the chosen company's own: Company A's Hospital is not Company B's.
    await expectError(projects.createProject(ceoInB, input({ companyId: COMPANY_B })), "VALIDATION_ERROR");
    const created = await projects.createProject(ceoInB, input({ companyId: COMPANY_B, projectTypeId: await typeId(COMPANY_B, "Hospital") }));
    tempProjects.push(created.id);
    expect(created.company.id).toBe(COMPANY_B);
    const row = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect([row.companyId, row.createdBy]).toEqual([COMPANY_B, ceo.userId]);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: created.id, actionKey: "PROJECT_CREATED" } });
    expect(audit?.companyId).toBe(COMPANY_B);
  });
});

describe("activity (E-05A §15)", () => {
  it("moves lastActivityAt on project work without touching updatedAt, at most once a minute", async () => {
    const owner = await loginAs("OWNER", GROUP);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const projectId = await tempProject({ lastActivityAt: hourAgo });
    const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    await recordActivity(prisma, owner, { module: "tasks", entityType: "Task", entityId: "t", action: "TASK_CREATED", message: "created a task", metadata: { projectId } });
    const after = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(after.lastActivityAt.getTime()).toBeGreaterThan(hourAgo.getTime() + 30 * 60 * 1000);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    await recordActivity(prisma, owner, { module: "tasks", entityType: "Task", entityId: "t", action: "TASK_UPDATED", message: "updated a task", metadata: { projectId } });
    const again = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(again.lastActivityAt.getTime()).toBe(after.lastActivityAt.getTime());

    await prisma.activity.deleteMany({ where: { entityId: "t", companyId: COMPANY_A, metadata: { path: ["projectId"], equals: projectId } } });
  });
});
