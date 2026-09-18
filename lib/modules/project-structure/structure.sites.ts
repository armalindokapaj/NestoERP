import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import type { CreateSiteInput, UpdateSiteInput } from "@/lib/modules/workforce/workforce.schema";
import type { SiteDTO } from "@/lib/modules/workforce/workforce.types";
import { MODULE, structureProjectDoor } from "./structure.permissions";

/**
 * A project's sites (E-04 §38, §39, §172): where its work happens on the
 * ground — the main plot, a second block across the road, the batching yard.
 * A project with none is worked as one site. Workers, crews and a day's
 * attendance may name a site, and a site always belongs to its project: the
 * composite keys make "a site of another project" impossible to store.
 *
 * Setting them up is part of setting up the physical project, so it is held
 * under `project.structure.manage` on a project in the reader's scope. A site
 * anything has used is archived, never deleted.
 */

const ENTITY = "ProjectSite";

/** Today as a `date` column holds it: the UTC business date every workforce period uses (E-03 §30). */
function today(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const SELECT = {
  id: true,
  projectId: true,
  name: true,
  code: true,
  address: true,
  city: true,
  notes: true,
  status: true,
} satisfies Prisma.ProjectSiteSelect;

type SiteRow = Prisma.ProjectSiteGetPayload<{ select: typeof SELECT }>;

/** The project, when the reader can open it: the only door to its sites. */
async function reachableProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: { id: true, name: true },
  });
  if (!project) throw new AccessError("NOT_FOUND");
  return project;
}

async function managedProject(context: UserContext, projectId: string) {
  assertModule(context, MODULE);
  const door = structureProjectDoor(context);
  const project = door ? await prisma.project.findFirst({ where: { AND: [door, { id: projectId }] }, select: { id: true, name: true } }) : null;
  if (!project) throw new AccessError("NOT_FOUND");
  if (!can(context, "project.structure.manage")) throw new AccessError("FORBIDDEN");
  return project;
}

function nameTaken(name: string): AccessError {
  const message = `This project already has a site called "${name}".`;
  return new AccessError("CONFLICT", message, { name: [message] });
}

async function counts(companyId: string, siteIds: string[]) {
  if (siteIds.length === 0) return { workers: new Map<string, number>(), crews: new Map<string, number>() };
  const day = today();
  const [workers, crews] = await Promise.all([
    prisma.employeeProjectAssignment.groupBy({
      by: ["siteId"],
      where: { companyId, siteId: { in: siteIds }, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gte: day } }] },
      _count: { _all: true },
    }),
    prisma.workforceCrew.groupBy({ by: ["siteId"], where: { companyId, siteId: { in: siteIds }, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  return {
    workers: new Map(workers.map((row) => [row.siteId!, row._count._all])),
    crews: new Map(crews.map((row) => [row.siteId!, row._count._all])),
  };
}

function toDTO(row: SiteRow, tally: Awaited<ReturnType<typeof counts>>): SiteDTO {
  return { ...row, workerCount: tally.workers.get(row.id) ?? 0, crewCount: tally.crews.get(row.id) ?? 0 };
}

/** Every site of a project the reader can open, active first. */
export async function listSites(context: UserContext, projectId: string): Promise<SiteDTO[]> {
  const project = await reachableProject(context, projectId);
  const rows = await prisma.projectSite.findMany({
    where: { companyId: context.companyId, projectId: project.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: SELECT,
  });
  const tally = await counts(context.companyId, rows.map((row) => row.id));
  return rows.map((row) => toDTO(row, tally));
}

export async function createSite(context: UserContext, projectId: string, input: CreateSiteInput): Promise<SiteDTO> {
  const project = await managedProject(context, projectId);
  const clash = await prisma.projectSite.findFirst({ where: { projectId: project.id, name: { equals: input.name, mode: "insensitive" } }, select: { id: true } });
  if (clash) throw nameTaken(input.name);

  const row = await prisma
    .$transaction(async (tx) => {
      const site = await tx.projectSite.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          name: input.name,
          code: input.code ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          notes: input.notes ?? null,
          createdByMemberId: context.membershipId,
        },
        select: SELECT,
      });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.PROJECT_SITE_CREATED,
          entity: { type: ENTITY, id: site.id, label: site.name },
          projectId: project.id,
          after: { siteId: site.id, name: site.name, code: site.code, address: site.address, city: site.city, status: site.status },
        },
        { tx },
      );
      return site;
    })
    .catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw nameTaken(input.name);
      throw error;
    });
  return toDTO(row, await counts(context.companyId, [row.id]));
}

/**
 * Rename, re-address, archive or bring back. Archiving a site people are still
 * assigned to is refused: they would be working somewhere that no longer
 * exists. Crews and past assignments keep naming an archived site.
 */
export async function updateSite(context: UserContext, projectId: string, siteId: string, input: UpdateSiteInput): Promise<SiteDTO> {
  const project = await managedProject(context, projectId);
  const existing = await prisma.projectSite.findFirst({ where: { id: siteId, projectId: project.id, companyId: context.companyId }, select: SELECT });
  if (!existing) throw new AccessError("NOT_FOUND");

  const next = {
    name: input.name ?? existing.name,
    code: input.code === undefined ? existing.code : input.code,
    address: input.address === undefined ? existing.address : input.address,
    city: input.city === undefined ? existing.city : input.city,
    notes: input.notes === undefined ? existing.notes : input.notes,
    status: input.status ?? existing.status,
  };
  if (next.name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await prisma.projectSite.findFirst({ where: { projectId: project.id, id: { not: siteId }, name: { equals: next.name, mode: "insensitive" } }, select: { id: true } });
    if (clash) throw nameTaken(next.name);
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    if (next[key] !== existing[key]) {
      before[key] = existing[key];
      after[key] = next[key];
    }
  }
  if (Object.keys(after).length === 0) return toDTO(existing, await counts(context.companyId, [existing.id]));

  const row = await prisma
    .$transaction(async (tx) => {
      if (next.status === "ARCHIVED" && existing.status !== "ARCHIVED") {
        const working = await tx.employeeProjectAssignment.count({ where: { companyId: context.companyId, siteId, OR: [{ endDate: null }, { endDate: { gte: today() } }] } });
        if (working > 0) {
          throw new AccessError("CONFLICT", `${working} ${working === 1 ? "person is" : "people are"} still assigned to this site. End or move their assignments first.`, { code: "SITE_IN_USE" });
        }
      }
      const site = await tx.projectSite.update({
        where: { companyId: context.companyId, id: siteId, status: existing.status },
        data: {
          name: next.name,
          code: next.code,
          address: next.address,
          city: next.city,
          notes: next.notes,
          status: next.status,
          archivedAt: next.status === "ARCHIVED" ? (existing.status === "ARCHIVED" ? undefined : new Date()) : null,
          updatedByMemberId: context.membershipId,
        },
        select: SELECT,
      });
      await recordUserAction(context, { actionKey: AuditAction.PROJECT_SITE_UPDATED, entity: { type: ENTITY, id: site.id, label: site.name }, projectId: project.id, before, after }, { tx });
      return site;
    })
    .catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw nameTaken(next.name);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new AccessError("CONFLICT", "The site changed since you opened it. Refresh and try again.");
      throw error;
    });
  return toDTO(row, await counts(context.companyId, [row.id]));
}
