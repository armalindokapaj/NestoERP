import type { Prisma } from "@prisma/client";

import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import type { ClientListQuery, ClientSortKey } from "./client.schema";

/**
 * Database access for Clients (PRD #12 §108, §155).
 *
 * The repository does queries; the service owns permissions, validation,
 * transactions and activity. Scope is still applied here, because a query that
 * left it to the caller would be one refactor away from leaking (PRD #12 §19).
 */

const SORT_ORDER: Record<ClientSortKey, Prisma.ClientOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "created-desc": [{ createdAt: "desc" }],
  "name-asc": [{ name: "asc" }],
  "name-desc": [{ name: "desc" }],
  "projects-desc": [{ projects: { _count: "desc" } }, { name: "asc" }],
  "type-asc": [{ type: "asc" }, { name: "asc" }],
  "status-asc": [{ status: "asc" }, { name: "asc" }],
};

/** The one primary contact a client may have (PRD #12 §180). */
const PRIMARY_CONTACT = {
  where: { isPrimary: true, archivedAt: null, status: { not: "ARCHIVED" as const } },
  select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, phone: true },
  take: 1,
} satisfies Prisma.Client$contactsArgs;

const SUMMARY_SELECT = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  type: true,
  status: true,
  country: true,
  updatedAt: true,
  contacts: PRIMARY_CONTACT,
} satisfies Prisma.ClientSelect;

export type ClientSummaryRow = Prisma.ClientGetPayload<{ select: typeof SUMMARY_SELECT }> & {
  activeProjectsCount: number;
};

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  email: true,
  phone: true,
  website: true,
  address: true,
  city: true,
  preArchiveStatus: true,
  createdAt: true,
  archivedAt: true,
  contacts: {
    where: { isPrimary: true, archivedAt: null, status: { not: "ARCHIVED" as const } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      email: true,
      phone: true,
      status: true,
    },
    take: 1,
  },
} satisfies Prisma.ClientSelect;

export type ClientDetailRow = Prisma.ClientGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * Builds the full `where` for a list request.
 *
 * Order: company → permission scope → archive state → search → filters
 * (PRD #12 §19, §20).
 */
export function buildClientListWhere(
  context: UserContext,
  query: ClientListQuery,
): Prisma.ClientWhereInput {
  const scope = buildClientScopeWhere(context);

  const archiveClause: Prisma.ClientWhereInput = query.archived
    ? { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" }] }
    : { archivedAt: null, status: { not: "ARCHIVED" } };

  const filters: Prisma.ClientWhereInput[] = [scope, archiveClause];

  const search = searchClause(query.search, ["name", "legalName", "code", "email", "phone"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.ClientWhereInput),
        // Primary contact name is searchable through the client the user can
        // already reach (PRD #12 §30).
        {
          contacts: {
            some: {
              OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }

  if (query.type?.length) filters.push({ type: { in: query.type } });
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.country) filters.push({ country: { equals: query.country, mode: "insensitive" } });

  // Project filters run through the caller's own project scope, so a client
  // cannot be found via a project they may not open (PRD #12 §35).
  if (query.projectId) {
    filters.push({
      projects: { some: { AND: [buildProjectScopeWhere(context), { id: query.projectId }] } },
    });
  }

  if (query.hasActiveProject !== undefined) {
    const activeProject: Prisma.ProjectWhereInput = {
      AND: [buildProjectScopeWhere(context), { status: "ACTIVE", archivedAt: null }],
    };
    filters.push(
      query.hasActiveProject
        ? { projects: { some: activeProject } }
        : { projects: { none: activeProject } },
    );
  }

  return { AND: filters };
}

export async function listClients(context: UserContext, query: ClientListQuery) {
  const where = buildClientListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: SORT_ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
    }),
    prisma.client.count({ where }),
  ]);

  const counts = await visibleProjectCounts(
    context,
    rows.map((row) => row.id),
  );

  return {
    rows: rows.map((row) => ({ ...row, activeProjectsCount: counts.get(row.id) ?? 0 })),
    total,
  };
}

/**
 * Active project counts for a page of clients, in one grouped query.
 *
 * Counting per row would be an N+1, and counting without the project scope
 * would tell a scoped user how many projects they cannot see (PRD #12 §93,
 * §156, §157).
 */
async function visibleProjectCounts(
  context: UserContext,
  clientIds: string[],
): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();

  const groups = await prisma.project.groupBy({
    by: ["clientId"],
    where: {
      AND: [
        buildProjectScopeWhere(context),
        { clientId: { in: clientIds }, status: "ACTIVE", archivedAt: null },
      ],
    },
    _count: { _all: true },
  });

  return new Map(
    groups
      .filter((group): group is typeof group & { clientId: string } => group.clientId !== null)
      .map((group) => [group.clientId, group._count._all]),
  );
}

export async function findClientInScope(
  context: UserContext,
  clientId: string,
): Promise<ClientDetailRow | null> {
  return prisma.client.findFirst({
    where: { AND: [buildClientScopeWhere(context), { id: clientId }] },
    select: DETAIL_SELECT,
  });
}

export async function clientInScopeExists(
  context: UserContext,
  clientId: string,
): Promise<boolean> {
  const found = await prisma.client.findFirst({
    where: { AND: [buildClientScopeWhere(context), { id: clientId }] },
    select: { id: true },
  });
  return Boolean(found);
}

/**
 * Counts shown on the client detail page, all narrowed to this viewer.
 *
 * Documents are counted through document access (PRD #47 §63): a client's
 * files include ones filed under modules and records the reader cannot open,
 * and a count is a disclosure too.
 */
export async function clientCounts(context: UserContext, clientId: string) {
  const documentAccess = await buildDocumentAccessWhere(context);
  const [visibleProjects, visibleDocuments, activeContacts] = await Promise.all([
    prisma.project.count({
      where: { AND: [buildProjectScopeWhere(context), { clientId }] },
    }),
    prisma.document.count({
      where: { AND: [documentAccess, { companyId: context.companyId, clientId, status: "ACTIVE" }] },
    }),
    prisma.contact.count({
      where: { companyId: context.companyId, clientId, status: "ACTIVE", archivedAt: null },
    }),
  ]);

  return { visibleProjects, visibleDocuments, activeContacts };
}

/** Projects linked to a client, narrowed to the caller's project scope (PRD #12 §92). */
export async function listClientProjects(context: UserContext, clientId: string) {
  return prisma.project.findMany({
    where: { AND: [buildProjectScopeWhere(context), { clientId }] },
    select: {
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
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
}

export async function listClientActivity(
  context: UserContext,
  clientId: string,
  options: { page: number; limit: number; modules: string[] },
) {
  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    entityType: { in: ["Client", "Contact"] },
    // Activity from a module this user cannot see stays hidden even on a
    // client they can open (PRD #12 §102, §221).
    module: { in: options.modules },
    OR: [{ entityId: clientId }, { metadata: { path: ["clientId"], equals: clientId } }],
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
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  return { rows, total };
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  email: true,
  phone: true,
  isPrimary: true,
  status: true,
  preArchiveStatus: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
} satisfies Prisma.ContactSelect;

export type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

export async function listContacts(
  context: UserContext,
  clientId: string,
  options: { archived?: boolean } = {},
): Promise<ContactRow[]> {
  return prisma.contact.findMany({
    where: {
      companyId: context.companyId,
      clientId,
      ...(options.archived
        ? {}
        : { archivedAt: null, status: { not: "ARCHIVED" as const } }),
    },
    select: CONTACT_SELECT,
    orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function findContact(
  context: UserContext,
  clientId: string,
  contactId: string,
): Promise<ContactRow | null> {
  return prisma.contact.findFirst({
    where: { id: contactId, clientId, companyId: context.companyId },
    select: CONTACT_SELECT,
  });
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export async function clientOverviewStats(context: UserContext) {
  const scope = buildClientScopeWhere(context);
  const live: Prisma.ClientWhereInput = {
    AND: [scope, { archivedAt: null, status: { not: "ARCHIVED" } }],
  };

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [active, withActiveProjects, addedThisMonth, archived] = await Promise.all([
    prisma.client.count({ where: { AND: [live, { status: "ACTIVE" }] } }),
    prisma.client.count({
      where: {
        AND: [
          live,
          {
            projects: {
              some: {
                AND: [buildProjectScopeWhere(context), { status: "ACTIVE", archivedAt: null }],
              },
            },
          },
        ],
      },
    }),
    prisma.client.count({ where: { AND: [live, { createdAt: { gte: monthStart } }] } }),
    prisma.client.count({
      where: { AND: [scope, { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" }] }] },
    }),
  ]);

  return { active, withActiveProjects, addedThisMonth, archived };
}

export async function recentClients(context: UserContext, take = 5) {
  return prisma.client.findMany({
    where: { AND: [buildClientScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }] },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function recentlyUpdatedClients(context: UserContext, take = 5) {
  return prisma.client.findMany({
    where: { AND: [buildClientScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }] },
    select: SUMMARY_SELECT,
    orderBy: { updatedAt: "desc" },
    take,
  });
}

/** Filter dropdown values, derived from clients the caller can already see. */
export async function clientFilterOptions(context: UserContext) {
  const [countries, projects] = await Promise.all([
    prisma.client.findMany({
      where: { AND: [buildClientScopeWhere(context), { country: { not: null } }] },
      select: { country: true },
      distinct: ["country"],
      orderBy: { country: "asc" },
      take: 100,
    }),
    prisma.project.findMany({
      where: { AND: [buildProjectScopeWhere(context), { clientId: { not: null } }] },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
  ]);

  return {
    countries: countries
      .map((row) => row.country)
      .filter((country): country is string => Boolean(country)),
    projects: projects.map((project) => ({
      id: project.id,
      name: `${project.name} (${project.code})`,
    })),
  };
}
