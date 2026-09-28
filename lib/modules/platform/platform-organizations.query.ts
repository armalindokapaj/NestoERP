import type { CompanyStatus, ParentGroupStatus } from "@prisma/client";
import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";

/**
 * The one organization directory (Organizations PRD §5-§12, §58-§60, §81-§83).
 *
 * Groups and companies are separate records; the directory shows each once.
 * A standalone company's hidden root is never a row. Counts are read in a few
 * batched queries for the whole filtered set (never one per row), so sorting
 * by them is honest, and only one page of rows leaves the server.
 */

export const ORGANIZATION_TYPES = ["all", "group", "company", "standalone"] as const;
export const ORGANIZATION_SORTS = ["name", "created", "projects", "users", "status"] as const;
export const ORGANIZATION_PAGE_SIZE = 25;

export const organizationQuerySchema = z.object({
  type: z.enum(ORGANIZATION_TYPES).catch("all"),
  q: z.string().trim().max(120).catch(""),
  status: z.string().trim().max(40).catch(""),
  group: z.string().trim().max(128).catch(""),
  sort: z.enum(ORGANIZATION_SORTS).catch("name"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type OrganizationQuery = z.infer<typeof organizationQuerySchema>;

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  type: "Group" | "Company" | "Standalone";
  parentGroup: { id: string; name: string } | null;
  companies: number | null;
  projects: number;
  users: number;
  modules: number | null;
  status: string;
  createdAt: string;
};

const REAL = { isTestFixture: false } as const;

export const GROUP_STATUSES = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION", "SUSPENDED", "ARCHIVED"] as const satisfies readonly ParentGroupStatus[];
export const COMPANY_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"] as const satisfies readonly CompanyStatus[];

export async function listOrganizations(context: PlatformContext, raw: Partial<Record<keyof OrganizationQuery, unknown>>) {
  if (!canPlatform(context, "platform.group.view") || !canPlatform(context, "platform.company.view")) throw new AccessError("FORBIDDEN");
  const query = organizationQuerySchema.parse(raw);
  const contains = query.q ? { contains: query.q, mode: "insensitive" as const } : undefined;
  const nameMatch = contains ? { OR: [{ name: contains }, { slug: contains }] } : {};
  // A status one kind never has simply matches none of that kind.
  const wantGroups = (query.type === "all" || query.type === "group") && (!query.status || GROUP_STATUSES.includes(query.status as never));
  const wantCompanies = query.type !== "group" && (!query.status || COMPANY_STATUSES.includes(query.status as never));

  const [groups, companies] = await Promise.all([
    wantGroups && !query.group
      ? prisma.parentGroup.findMany({ where: { ...REAL, kind: "GROUP", ...nameMatch, ...(query.status ? { status: query.status as never } : {}) }, select: { id: true, name: true, slug: true, status: true, createdAt: true, _count: { select: { companies: true } } } })
      : Promise.resolve([]),
    wantCompanies
      ? prisma.company.findMany({
          where: {
            ...nameMatch,
            parentGroup: { ...REAL, ...(query.type === "standalone" ? { kind: "STANDALONE" as const } : {}), ...(query.group ? { id: query.group, kind: "GROUP" as const } : {}) },
            ...(query.status ? { status: query.status as never } : {}),
          },
          select: {
            id: true, name: true, slug: true, status: true, createdAt: true, parentGroupId: true,
            parentGroup: { select: { id: true, name: true, kind: true } },
            _count: { select: { projects: { where: { archivedAt: null } }, modules: { where: { enabled: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Users: distinct active account holders per company, and per group across its companies and group-level seats (§59).
  const companyIds = companies.map((row) => row.id);
  const groupIds = groups.map((row) => row.id);
  const [companyMembers, groupCompanyMembers, groupSeats, groupProjects] = await Promise.all([
    companyIds.length ? prisma.companyMember.findMany({ where: { companyId: { in: companyIds }, status: "ACTIVE" }, select: { companyId: true, userId: true } }) : [],
    groupIds.length ? prisma.companyMember.findMany({ where: { status: "ACTIVE", company: { parentGroupId: { in: groupIds } } }, select: { userId: true, company: { select: { parentGroupId: true } } } }) : [],
    groupIds.length ? prisma.parentGroupMember.findMany({ where: { parentGroupId: { in: groupIds }, status: "ACTIVE" }, select: { parentGroupId: true, userId: true } }) : [],
    groupIds.length ? prisma.project.findMany({ where: { archivedAt: null, company: { parentGroupId: { in: groupIds } } }, select: { company: { select: { parentGroupId: true } } } }) : [],
  ]);
  const distinct = (pairs: [string, string][]) => {
    const map = new Map<string, Set<string>>();
    for (const [key, user] of pairs) map.set(key, (map.get(key) ?? new Set()).add(user));
    return map;
  };
  const usersByCompany = distinct(companyMembers.map((row) => [row.companyId, row.userId]));
  const usersByGroup = distinct([...groupCompanyMembers.map((row) => [row.company.parentGroupId, row.userId] as [string, string]), ...groupSeats.map((row) => [row.parentGroupId, row.userId] as [string, string])]);
  const projectsByGroup = new Map<string, number>();
  for (const row of groupProjects) projectsByGroup.set(row.company.parentGroupId, (projectsByGroup.get(row.company.parentGroupId) ?? 0) + 1);

  const rows: OrganizationRow[] = [
    ...groups.map((row) => ({
      id: row.id, name: row.name, slug: row.slug, type: "Group" as const, parentGroup: null, companies: row._count.companies,
      projects: projectsByGroup.get(row.id) ?? 0, users: usersByGroup.get(row.id)?.size ?? 0, modules: null, status: row.status, createdAt: row.createdAt.toISOString(),
    })),
    ...companies.map((row) => {
      const standalone = row.parentGroup.kind === "STANDALONE";
      return {
        id: row.id, name: row.name, slug: row.slug, type: standalone ? "Standalone" as const : "Company" as const,
        parentGroup: standalone ? null : { id: row.parentGroup.id, name: row.parentGroup.name }, companies: null,
        projects: row._count.projects, users: usersByCompany.get(row.id)?.size ?? 0, modules: row._count.modules, status: row.status, createdAt: row.createdAt.toISOString(),
      };
    }),
  ];

  // Stable order: the chosen key, then name, then id, so a refresh never reshuffles (§12).
  const key = (row: OrganizationRow): string | number => query.sort === "created" ? row.createdAt : query.sort === "projects" ? row.projects : query.sort === "users" ? row.users : query.sort === "status" ? row.status : row.name.toLowerCase();
  const sign = query.dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    const primary = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return primary * sign || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / ORGANIZATION_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return { query: { ...query, page }, total, pages, rows: rows.slice((page - 1) * ORGANIZATION_PAGE_SIZE, page * ORGANIZATION_PAGE_SIZE) };
}

/** Group choices for the Parent Group filter and the create/move forms. */
export async function organizationGroupOptions(context: PlatformContext, { openOnly = false } = {}) {
  if (!canPlatform(context, "platform.group.view")) throw new AccessError("FORBIDDEN");
  const rows = await prisma.parentGroup.findMany({
    where: { ...REAL, kind: "GROUP", ...(openOnly ? { status: { notIn: ["SUSPENDED", "ARCHIVED"] } } : {}) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ value: row.id, label: row.name }));
}

/** Standalone companies a group can take in (§27). */
export async function attachableCompanies(context: PlatformContext) {
  if (!canPlatform(context, "platform.company.view")) throw new AccessError("FORBIDDEN");
  const rows = await prisma.company.findMany({ where: { parentGroup: { ...REAL, kind: "STANDALONE" } }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
  return rows.map((row) => ({ value: row.id, label: row.name }));
}
