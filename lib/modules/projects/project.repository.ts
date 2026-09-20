import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import type { ProjectListQuery, ProjectSortKey } from "./project.schema";

/**
 * Database access for Projects (PRD #10 §95, §96).
 *
 * The repository does queries; the service owns permissions, validation,
 * transactions and activity. Scope is still applied here, because a query that
 * left it to the caller would be one refactor away from leaking.
 */

const SORT_ORDER: Record<ProjectSortKey, Prisma.ProjectOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "created-desc": [{ createdAt: "desc" }],
  "name-asc": [{ name: "asc" }],
  "name-desc": [{ name: "desc" }],
  "start-asc": [{ startDate: { sort: "asc", nulls: "last" } }],
  "end-asc": [{ endDate: { sort: "asc", nulls: "last" } }],
  "priority-desc": [{ priority: "desc" }, { updatedAt: "desc" }],
  "status-asc": [{ status: "asc" }, { updatedAt: "desc" }],
};

/** Columns every list row needs — and nothing more (PRD #10 §160). */
const SUMMARY_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  priority: true,
  startDate: true,
  endDate: true,
  updatedAt: true,
  archivedAt: true,
  client: { select: { id: true, name: true } },
  projectManager: {
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { members: { where: { status: "ACTIVE" as const } } } },
} satisfies Prisma.ProjectSelect;

export type ProjectSummaryRow = Prisma.ProjectGetPayload<{ select: typeof SUMMARY_SELECT }>;

/**
 * Builds the full `where` for a list request.
 *
 * Order: company → archive state → permission scope → search → filters
 * (PRD #10 §159).
 */
export function buildProjectListWhere(
  context: UserContext,
  query: ProjectListQuery,
): Prisma.ProjectWhereInput {
  const scope = buildProjectScopeWhere(context);

  const archiveClause: Prisma.ProjectWhereInput = query.archived
    ? { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" }] }
    : { archivedAt: null, status: { not: "ARCHIVED" } };

  const mineClause: Prisma.ProjectWhereInput | undefined = query.mine
    ? {
        OR: [
          { projectManagerMemberId: context.membershipId },
          { members: { some: { companyMemberId: context.membershipId, status: "ACTIVE" } } },
        ],
      }
    : undefined;

  const filters: Prisma.ProjectWhereInput[] = [scope, archiveClause];
  if (mineClause) filters.push(mineClause);

  const search = searchClause(query.search, ["name", "code", "description"]);
  if (search) {
    // Client name is searchable too, but only through the scoped project graph,
    // so a client the user cannot reach never surfaces one (PRD #10 §19, §20).
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.ProjectWhereInput),
        { client: { name: { contains: query.search!.trim(), mode: "insensitive" } } },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.priority?.length) filters.push({ priority: { in: query.priority } });
  if (query.clientId) filters.push({ clientId: query.clientId });
  if (query.projectManagerMemberId) {
    filters.push({ projectManagerMemberId: query.projectManagerMemberId });
  }

  return { AND: filters };
}

export async function listProjects(context: UserContext, query: ProjectListQuery) {
  const where = buildProjectListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: SORT_ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
    }),
    prisma.project.count({ where }),
  ]);

  return { rows, total };
}

const DETAIL_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  status: true,
  preArchiveStatus: true,
  priority: true,
  startDate: true,
  endDate: true,
  address: true,
  city: true,
  country: true,
  builtArea: true,
  isKeyProject: true,
  projectTypeId: true,
  projectType: { select: { id: true, name: true } },
  coverImageDocumentId: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  clientId: true,
  projectManagerMemberId: true,
  company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
  client: { select: { id: true, name: true } },
  projectManager: {
    select: {
      id: true,
      status: true,
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.ProjectSelect;

export type ProjectDetailRow = Prisma.ProjectGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * A single project, inside scope.
 *
 * Never `findUnique({ id })`: a bare id lookup would return records belonging to
 * another company or outside the user's scope (PRD #8 §7).
 */
export async function findProjectInScope(
  context: UserContext,
  projectId: string,
): Promise<ProjectDetailRow | null> {
  return prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: DETAIL_SELECT,
  });
}

/**
 * Counts for the detail page, computed in the database (PRD #10 §164).
 *
 * The document count runs through document access, not just the project: an
 * incident photo or a supplier quote filed on the project is counted only for
 * somebody who could open it, so the number never announces files the reader
 * may not see (PRD #13 §283, PRD #47 §63).
 */
export async function projectCounts(context: UserContext, projectId: string) {
  const documentAccess = await buildDocumentAccessWhere(context);
  const [members, openTasks, documents] = await Promise.all([
    prisma.projectMember.count({ where: { projectId, status: "ACTIVE" } }),
    prisma.task.count({
      where: {
        companyId: context.companyId,
        projectId,
        archivedAt: null,
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      },
    }),
    prisma.document.count({
      where: { AND: [documentAccess, { companyId: context.companyId, projectId, status: "ACTIVE" }] },
    }),
  ]);

  return { members, openTasks, documents };
}

export async function projectTaskSummary(context: UserContext, projectId: string) {
  const base = { companyId: context.companyId, projectId, archivedAt: null };

  const [open, inProgress, blocked, completed, overdue] = await Promise.all([
    prisma.task.count({ where: { ...base, status: "TODO" } }),
    prisma.task.count({ where: { ...base, status: "IN_PROGRESS" } }),
    prisma.task.count({ where: { ...base, status: "BLOCKED" } }),
    prisma.task.count({ where: { ...base, status: "COMPLETED" } }),
    prisma.task.count({
      where: {
        ...base,
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
        dueDate: { lt: new Date() },
      },
    }),
  ]);

  return { open, inProgress, blocked, completed, overdue };
}

export async function listProjectMembers(projectId: string) {
  return prisma.projectMember.findMany({
    where: { projectId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      companyMemberId: true,
      projectRole: true,
      isPrimary: true,
      status: true,
      member: {
        select: {
          id: true,
          jobTitle: true,
          status: true,
          role: { select: { key: true, name: true } },
          department: { select: { name: true } },
          user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } },
        },
      },
    },
  });
}

export async function listProjectActivity(
  context: UserContext,
  projectId: string,
  options: { page: number; limit: number; modules: string[] },
) {
  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: { in: options.modules },
    OR: [
      { entityType: "Project", entityId: projectId },
      { metadata: { path: ["projectId"], equals: projectId } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: skipFor(options.page, options.limit),
      take: options.limit,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        actorMemberId: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Filter options, restricted to what the current result scope can reveal.
 * A dropdown must never name a client or a manager the user cannot open
 * (PRD #10 §24, §25).
 */
export async function projectFilterOptions(context: UserContext) {
  const scope = buildProjectScopeWhere(context);

  const [clients, managers] = await Promise.all([
    prisma.client.findMany({
      where: { companyId: context.companyId, projects: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, managedProjects: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { firstName: "asc" } },
    }),
  ]);

  return {
    clients,
    managers: managers.map((manager) => ({
      id: manager.id,
      name: `${manager.user.firstName} ${manager.user.lastName}`,
    })),
  };
}
