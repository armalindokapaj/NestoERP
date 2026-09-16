import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { resolveContextForSession } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";
import { readDocumentThumbnail } from "@/lib/modules/documents/storage/thumbnail.service";
import { addFavorite } from "@/lib/modules/productivity/favorites.service";
import {
  ASSIGNED_ROLE,
  contextForProject,
  creatableCompanies,
  listPortfolioProjects,
  openPortfolioProject,
  portfolioFilterOptions,
} from "@/lib/modules/projects/project.portfolio";
import { parsePortfolioQuery } from "@/lib/modules/projects/project.query";
import { createProjectSchema, portfolioQuerySchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import { seedStoredDocument } from "../../../prisma/seed/document-objects";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * The Projects page (E-05A §63-§69).
 *
 * Every case runs the real services against the seeded database through real
 * sessions — the multi-company person is `multicompany`, an Architect in
 * Company A on Greenline Villas and a Project Manager in Company B on
 * Isarvorstadt Studio Refit.
 */

const COMPANY_A = "company_demo_a";
const COMPANY_B = "company_demo_b";
const MULTI_A = "member_multicompany_a";
const MULTI_B = "member_multicompany_b";

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
  await prisma.userFavorite.deleteMany({ where: { memberId: { in: [MULTI_A, MULTI_B] } } });
});

afterAll(async () => {
  await cleanupSessions();
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

/* -------------------------------------------------------------------------- */

describe("authorisation across companies (E-05A §63)", () => {
  it("shows the multi-company person their assigned projects in both companies, whichever company the session is in", async () => {
    const inA = await loginAsMembership(MULTI_A);
    const inB = await loginAsMembership(MULTI_B);

    expect((await ids(inA)).sort()).toEqual([PROJECT.e, "project_b_two"].sort());
    expect((await ids(inB)).sort()).toEqual([PROJECT.e, "project_b_two"].sort());

    const result = await listPortfolioProjects(inA, query());
    expect(result.meta).toMatchObject({ visibleProjectCount: 2, visibleCompanyCount: 2 });
    expect(result.items.find((item) => item.id === "project_b_two")?.company).toMatchObject({ id: COMPANY_B, isCurrent: false });
  });

  it("keeps a single-company Architect to their own assigned projects", async () => {
    const architect = await loginAs("ARCHITECT");
    expect((await ids(architect)).sort()).toEqual([PROJECT.a, PROJECT.c].sort());
    expect((await listPortfolioProjects(architect, query())).meta.visibleCompanyCount).toBe(1);
  });

  it("gives a company-scope Owner every live project in their company and none in another", async () => {
    const owner = await loginAs("OWNER");
    const visible = await ids(owner);
    expect(visible).toEqual(expect.arrayContaining([PROJECT.a, PROJECT.b, PROJECT.c, PROJECT.d, PROJECT.e, PROJECT.f]));
    expect(visible).not.toContain(PROJECT.archived);
    expect(visible).not.toContain(PROJECT.companyB);
    expect(visible).not.toContain("project_b_two");

    const ownerB = await loginAsMembership("member_owner_b");
    expect((await ids(ownerB)).sort()).toEqual(["project_b_one", "project_b_two"]);
  });

  it("never names a company, role or place the person cannot see in the filter options", async () => {
    const owner = await loginAs("OWNER");
    const options = await portfolioFilterOptions(owner);
    expect(options.companies.map((company) => company.id)).toEqual([COMPANY_A]);
    expect(options.locations.cities.map((city) => city.value)).not.toContain("city:Munich");

    const multi = await loginAsMembership(MULTI_A);
    const multiOptions = await portfolioFilterOptions(multi);
    expect(multiOptions.companies.map((company) => company.id).sort()).toEqual([COMPANY_A, COMPANY_B]);
    expect(multiOptions.roles.map((role) => role.label).sort()).toEqual(["Architect", "Project Manager"]);
    expect(multiOptions.locations.cities.map((city) => city.value).sort()).toEqual(["city:Elbasan", "city:Munich"]);
  });

  it("searches inside the authorised set only (E-05A §16, §73)", async () => {
    const owner = await loginAs("OWNER");
    expect(await ids(owner, { q: "Munich" })).toEqual([]);
    expect(await ids(owner, { companyId: COMPANY_B })).toEqual([]);

    const multi = await loginAsMembership(MULTI_A);
    expect(await ids(multi, { q: "Munich" })).toEqual(["project_b_two"]);
    expect(await ids(multi, { q: "NESTO Second" })).toEqual(["project_b_two"]);
  });

  it("refuses a person who can open projects nowhere", async () => {
    await expectError(listPortfolioProjects(await loginAs("COMPANY_IT"), query()), "FORBIDDEN");
  });
});

describe("opening a project in its own company (E-05A §26, §63.7)", () => {
  it("moves the session to the project's company, and only then", async () => {
    const session = await loginAsMembership(MULTI_A);

    const here = await openPortfolioProject(session, PROJECT.e);
    expect(here).toMatchObject({ switched: false, company: { id: COMPANY_A } });

    const there = await openPortfolioProject(session, "project_b_two");
    expect(there).toMatchObject({ switched: true, company: { id: COMPANY_B } });

    const resolved = await resolveContextForSession(session.sessionId, { expectedUserId: session.userId });
    expect(resolved.ok && resolved.context.companyId).toBe(COMPANY_B);
    expect(resolved.ok && resolved.context.role).toBe("PROJECT_MANAGER");

    const event = await prisma.authEvent.findFirst({
      where: { sessionId: session.sessionId, type: "COMPANY_CONTEXT_SWITCHED" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.metadata).toMatchObject({ fromCompanyId: COMPANY_A, toCompanyId: COMPANY_B, projectId: "project_b_two" });
  });

  it("refuses a project the person cannot open in any company, and moves nothing", async () => {
    const session = await loginAsMembership(MULTI_A);
    await expectError(openPortfolioProject(session, "project_b_one"), "NOT_FOUND");
    await expectError(openPortfolioProject(await loginAs("VIEWER"), "project_b_one"), "NOT_FOUND");

    const row = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(row?.currentCompanyId).toBe(COMPANY_A);
  });
});

describe("ordering (E-05A §14, §65)", () => {
  it("puts favorites first, each group by latest activity", async () => {
    const owner = await loginAs("OWNER");
    const label = `Ordering ${Date.now()}`;
    const september = (day: number) => new Date(Date.UTC(2026, 8, day, 12));

    const favoriteA = await tempProject({ name: `${label} Favorite A`, lastActivityAt: september(10) });
    const favoriteB = await tempProject({ name: `${label} Favorite B`, lastActivityAt: september(15) });
    const projectC = await tempProject({ name: `${label} Project C`, lastActivityAt: september(16) });
    const projectD = await tempProject({ name: `${label} Project D`, lastActivityAt: september(12) });
    await addFavorite(owner, { entityType: "project", entityId: favoriteA });
    await addFavorite(owner, { entityType: "project", entityId: favoriteB });

    expect(await ids(owner, { q: label })).toEqual([favoriteB, favoriteA, projectC, projectD]);

    // A cursor walk of one card at a time crosses the favorites boundary without
    // skipping or repeating anything.
    const walked: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPortfolioProjects(owner, query({ q: label, limit: 1, cursor }));
      walked.push(...page.items.map((item) => item.id));
      cursor = page.pageInfo.nextCursor ?? undefined;
      expect(page.pageInfo.hasNextPage).toBe(Boolean(cursor));
    } while (cursor);
    expect(walked).toEqual([favoriteB, favoriteA, projectC, projectD]);

    // Other sorts ignore favorites and page on their own keys.
    const byName: string[] = [];
    cursor = undefined;
    do {
      const page = await listPortfolioProjects(owner, query({ q: label, limit: 3, sort: "name-desc", cursor }));
      byName.push(...page.items.map((item) => item.id));
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    expect(byName).toEqual([projectD, projectC, favoriteB, favoriteA]);
  });

  it("keeps a favorite Finished project at the top (E-05A §14)", async () => {
    const owner = await loginAs("OWNER");
    const label = `Finished ${Date.now()}`;
    const finished = await tempProject({ name: `${label} old`, status: "FINISHED", lastActivityAt: new Date(Date.UTC(2020, 0, 1)) });
    const recent = await tempProject({ name: `${label} new`, lastActivityAt: new Date() });
    await addFavorite(owner, { entityType: "project", entityId: finished });
    expect(await ids(owner, { q: label })).toEqual([finished, recent]);
  });

  it("rejects a cursor that does not belong to the sort", async () => {
    const owner = await loginAs("OWNER");
    const page = await listPortfolioProjects(owner, query({ limit: 1, sort: "name-asc" }));
    await expectError(listPortfolioProjects(owner, query({ limit: 1, cursor: page.pageInfo.nextCursor })), "VALIDATION_ERROR");
    await expectError(listPortfolioProjects(owner, query({ cursor: "not-a-cursor" })), "VALIDATION_ERROR");
  });
});

describe("filters and search (E-05A §17, §18, §66)", () => {
  it("narrows by status, type, place and role, and combines them with AND", async () => {
    const owner = await loginAs("OWNER");
    expect(await ids(owner, { status: "PENDING" })).toEqual([PROJECT.e]);
    expect(await ids(owner, { status: "FINISHED" })).toEqual([PROJECT.f]);
    expect((await ids(owner, { projectType: "Residential" })).sort()).toEqual([PROJECT.c, PROJECT.e].sort());
    expect((await ids(owner, { projectType: "commercial", status: "ACTIVE" }))).toEqual([PROJECT.b]);
    expect(await ids(owner, { location: "city:vlorë" })).toEqual([PROJECT.c]);
    expect(await ids(owner, { q: "hospital" })).toEqual([]);
    expect(await ids(owner, { q: "industrial" })).toEqual([PROJECT.d]);

    const multi = await loginAsMembership(MULTI_A);
    expect(await ids(multi, { role: "Architect" })).toEqual([PROJECT.e]);
    expect(await ids(multi, { role: "project manager" })).toEqual(["project_b_two"]);
    expect((await ids(multi, { role: ASSIGNED_ROLE })).sort()).toEqual([PROJECT.e, "project_b_two"].sort());
    expect(await ids(multi, { location: "country:Germany" })).toEqual(["project_b_two"]);
    expect(await ids(multi, { companyId: COMPANY_B, role: "Architect" })).toEqual([]);
  });

  it("filters and searches by a type name across companies, each with its own list (E-05A §30, §62)", async () => {
    const multi = await loginAsMembership(MULTI_A);
    const label = `Types ${Date.now()}`;
    const inB = await tempProject({ companyId: COMPANY_B, name: `${label} B`, projectType: "Residential", managerMemberId: MULTI_B, memberIds: [MULTI_B] });

    expect((await ids(multi, { projectType: "residential" })).sort()).toEqual([PROJECT.e, inB].sort());
    expect((await ids(multi, { q: "resident" })).sort()).toEqual([PROJECT.e, inB].sort());
    // Two companies' "Residential" rows are one choice in the filter.
    expect((await portfolioFilterOptions(multi)).projectTypes.map((type) => type.label)).toEqual(["Commercial", "Residential"]);

    // A renamed type is filtered by its new name, and only in its own company.
    const renamedId = await typeId(COMPANY_B, "Residential");
    await prisma.projectType.update({ where: { id: renamedId }, data: { name: "Housing" } });
    try {
      expect(await ids(multi, { projectType: "Housing" })).toEqual([inB]);
      expect(await ids(multi, { projectType: "Residential" })).toEqual([PROJECT.e]);
    } finally {
      await prisma.projectType.update({ where: { id: renamedId }, data: { name: "Residential" } });
    }
  });

  it("filters favorites per person — one person's star is nobody else's", async () => {
    const multi = await loginAsMembership(MULTI_A);
    await addFavorite(await contextForProject(multi, "project_b_two"), { entityType: "project", entityId: "project_b_two" });

    expect(await ids(multi, { favorites: true })).toEqual(["project_b_two"]);
    const favorite = await prisma.userFavorite.findFirst({ where: { entityType: "project", entityId: "project_b_two", memberId: MULTI_B } });
    expect(favorite?.companyId).toBe(COMPANY_B);

    const ownerB = await loginAsMembership("member_owner_b");
    expect(await ids(ownerB, { favorites: true })).toEqual([]);
    expect((await listPortfolioProjects(ownerB, query())).items.every((item) => !item.isFavorite)).toBe(true);
  });

  it("reads the page's URL the way the API does", () => {
    const parsed = parsePortfolioQuery(new URLSearchParams("q=hospital&status=COMPLETED&company=cmp_1&type=hotel&location=city:Fier&sort=bogus&favorites=1"));
    expect(parsed).toMatchObject({ q: "hospital", status: "FINISHED", companyId: "cmp_1", projectType: "hotel", location: "city:Fier", sort: "recommended", favorites: true, limit: 24 });
    expect(parsePortfolioQuery({ status: "DRAFT", location: "Fier" })).toMatchObject({ status: "PENDING", location: undefined });
  });
});

describe("what each card says and allows (E-05A §7, §33, §52)", () => {
  it("shows the effective project role and permissions decided in the project's own company", async () => {
    const multi = await loginAsMembership(MULTI_A);
    const { items } = await listPortfolioProjects(multi, query());
    const greenline = items.find((item) => item.id === PROJECT.e)!;
    const studio = items.find((item) => item.id === "project_b_two")!;

    expect(greenline).toMatchObject({ myProjectRole: { name: "Architect", others: 0 }, company: { id: COMPANY_A }, projectType: { name: "Residential" }, location: { city: "Elbasan", country: "Albania" } });
    expect(greenline.permissions).toMatchObject({ edit: true, manageStatus: false, archive: false });
    expect(greenline.statusMoves).toEqual([]);

    expect(studio).toMatchObject({ myProjectRole: { name: "Project Manager", others: 0 }, company: { id: COMPANY_B } });
    expect(studio.permissions).toMatchObject({ edit: true, manageStatus: true, archive: true });
    expect(studio.statusMoves.sort()).toEqual(["FINISHED", "PENDING"]);
  });

  it("shows a second role as +1, and the same role twice as one (E-05A §56)", async () => {
    const owner = await loginAs("OWNER");
    const label = `Roles ${Date.now()}`;
    const twoRoles = await tempProject({ name: `${label} lead`, managerMemberId: owner.membershipId, memberIds: [owner.membershipId], memberRole: "Lead Architect" });
    const oneRole = await tempProject({ name: `${label} pm`, managerMemberId: owner.membershipId, memberIds: [owner.membershipId], memberRole: "project manager" });
    const { items } = await listPortfolioProjects(owner, query({ q: label }));

    expect(items.find((item) => item.id === twoRoles)?.myProjectRole).toEqual({ name: "Lead Architect", others: 1 });
    expect(items.find((item) => item.id === oneRole)?.myProjectRole).toEqual({ name: "project manager", others: 0 });
  });

  it("offers a cover only to a reader who can open its document, as a 3:4 thumbnail", async () => {
    const owner = await loginAs("OWNER");
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
    await expectError(projects.changeProjectStatus(pm, PROJECT.c, { status: "FINISHED" }), "NOT_FOUND");

    const architect = await loginAs("ARCHITECT");
    await expectError(projects.changeProjectStatus(architect, PROJECT.a, { status: "FINISHED" }), "FORBIDDEN");

    // Editing the project does not carry the status with it.
    const project = await projects.getProject(architect, PROJECT.a);
    await expectError(
      projects.updateProject(architect, PROJECT.a, { code: project.code, name: project.name, status: "FINISHED" } as never),
      "FORBIDDEN",
    );
  });

  it("lets a Company Admin manage status in their company and nobody reach another company's project", async () => {
    const admin = await loginAs("ADMIN");
    const projectId = await tempProject({ status: "PENDING" });
    expect((await projects.changeProjectStatus(admin, projectId, { status: "ACTIVE" })).status).toBe("ACTIVE");

    const ownerB = await loginAsMembership("member_owner_b");
    await expectError(contextForProject(ownerB, projectId), "NOT_FOUND");
  });

  it("lets only one of two simultaneous moves land", async () => {
    const owner = await loginAs("OWNER");
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
    const owner = await loginAs("OWNER");
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

  it("creates Pending by default for the Owner and an Admin, audited", async () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
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
    const multi = await loginAsMembership(MULTI_A);
    expect(await creatableCompanies(multi)).toEqual([]);
  });

  it("lets a role create once it is granted project.create, without the status coming with it (E-05A §104, §105)", async () => {
    // NESTO has no Architecture Manager role; an Architect granted the
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
    const owner = await loginAs("OWNER");
    const code = `E05A-DUP-${Date.now().toString(36)}`;
    const first = await projects.createProject(owner, input({ code }));
    tempProjects.push(first.id);
    await expectError(projects.createProject(owner, input({ code, name: "Second with the same code" })), "CONFLICT");

    const inB = await tempProject({ companyId: COMPANY_B });
    await prisma.project.update({ where: { id: inB }, data: { code } });
    expect((await prisma.project.findMany({ where: { code } })).map((row) => row.companyId).sort()).toEqual([COMPANY_A, COMPANY_B]);
  });

  it("offers and accepts only the company's types in use, and keeps a retired one on its project (E-05A §62)", async () => {
    const owner = await loginAs("OWNER");
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
    const owner = await loginAs("OWNER");
    await expectError(projects.createProject(owner, input({ companyId: COMPANY_B })), "FORBIDDEN");
    await expectError(projects.createProject(owner, input({ companyId: "company_that_does_not_exist" })), "FORBIDDEN");
  });

  it("creates in the chosen company for somebody who may create in two", async () => {
    const admin = await loginAs("ADMIN");
    const adminRole = await prisma.role.findFirstOrThrow({ where: { key: "ADMIN" } });
    const memberId = `e05a_admin_b_${Date.now().toString(36)}`;
    await prisma.companyMember.create({ data: { id: memberId, companyId: COMPANY_B, userId: admin.userId, roleId: adminRole.id, status: "ACTIVE" } });
    tempMembers.push(memberId);

    expect((await creatableCompanies(admin)).map((company) => company.id).sort()).toEqual([COMPANY_A, COMPANY_B]);

    // A type is the chosen company's own: Company A's Hospital is not Company B's.
    await expectError(projects.createProject(admin, input({ companyId: COMPANY_B })), "VALIDATION_ERROR");
    const created = await projects.createProject(admin, input({ companyId: COMPANY_B, projectTypeId: await typeId(COMPANY_B, "Hospital") }));
    tempProjects.push(created.id);
    expect(created.company.id).toBe(COMPANY_B);
    const row = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect([row.companyId, row.createdBy]).toEqual([COMPANY_B, admin.userId]);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: created.id, actionKey: "PROJECT_CREATED" } });
    expect(audit?.companyId).toBe(COMPANY_B);
  });
});

describe("activity (E-05A §15)", () => {
  it("moves lastActivityAt on project work without touching updatedAt, at most once a minute", async () => {
    const owner = await loginAs("OWNER");
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
