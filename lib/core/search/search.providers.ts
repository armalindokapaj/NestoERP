import { can, canAccessModule } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { SCORE, scoreMatch, type GlobalSearchProvider, type GlobalSearchQuery, type GlobalSearchResultDTO } from "./search.types";

/**
 * Module search providers (PRD #26 §61-§100).
 *
 * Every one of these applies the same company, module, permission and scope
 * rules as the module's own list screen. A record a user cannot open never
 * appears in their search results (PRD #26 §22, §23, §29).
 *
 * Sensitive free text is deliberately not searchable: compensation notes, legal
 * advice, HSE investigation narratives and internal finance comments stay out
 * (PRD #26 §58, §75, §89, §100).
 */

function available(context: UserContext, moduleKey: Parameters<typeof canAccessModule>[1], permission: Parameters<typeof can>[1]): boolean {
  return canAccessModule(context, moduleKey) && can(context, permission);
}

const projectProvider: GlobalSearchProvider = {
  moduleKey: "projects",
  entityTypes: ["project"],
  async search(context, query) {
    if (!available(context, "projects", "project.view")) return [];

    const rows = await prisma.project.findMany({
      where: {
        AND: [
          buildProjectScopeWhere(context),
          {
            companyId: context.companyId,
            archivedAt: null,
            OR: [
              { name: { contains: query.text, mode: "insensitive" } },
              { code: { contains: query.text, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: { id: true, name: true, code: true, status: true },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "projects",
      entityType: "project",
      entityId: row.id,
      title: row.name,
      subtitle: row.code,
      href: `/projects/${row.id}`,
      score: scoreMatch(query.text, row.name, row.code),
      status: row.status,
    }));
  },
};

const taskProvider: GlobalSearchProvider = {
  moduleKey: "tasks",
  entityTypes: ["task"],
  async search(context, query) {
    if (!available(context, "tasks", "task.view")) return [];

    const rows = await prisma.task.findMany({
      where: {
        AND: [
          buildTaskScopeWhere(context),
          {
            companyId: context.companyId,
            archivedAt: null,
            title: { contains: query.text, mode: "insensitive" },
          },
        ],
      },
      select: { id: true, title: true, status: true, project: { select: { name: true } } },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "tasks",
      entityType: "task",
      entityId: row.id,
      title: row.title,
      subtitle: row.project?.name ?? null,
      href: `/tasks/${row.id}`,
      score: scoreMatch(query.text, row.title),
      status: row.status,
    }));
  },
};

const clientProvider: GlobalSearchProvider = {
  moduleKey: "clients",
  entityTypes: ["client"],
  async search(context, query) {
    if (!available(context, "clients", "client.view")) return [];

    const rows = await prisma.client.findMany({
      where: {
        AND: [
          buildClientScopeWhere(context),
          {
            companyId: context.companyId,
            archivedAt: null,
            OR: [
              { name: { contains: query.text, mode: "insensitive" } },
              { email: { contains: query.text, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: { id: true, name: true, city: true, status: true },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "clients",
      entityType: "client",
      entityId: row.id,
      title: row.name,
      subtitle: row.city,
      href: `/clients/${row.id}`,
      score: scoreMatch(query.text, row.name),
      status: row.status,
    }));
  },
};

const documentProvider: GlobalSearchProvider = {
  moduleKey: "documents",
  entityTypes: ["document"],
  async search(context, query) {
    if (!available(context, "documents", "document.view")) return [];

    // Metadata only: NESTO does not index the contents of private binaries
    // (PRD #26 §66, §71).
    const rows = await prisma.document.findMany({
      where: {
        companyId: context.companyId,
        archivedAt: null,
        OR: [
          { name: { contains: query.text, mode: "insensitive" } },
          { fileName: { contains: query.text, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, fileName: true, entityType: true },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "documents",
      entityType: "document",
      entityId: row.id,
      title: row.name,
      subtitle: row.fileName,
      href: `/documents/${row.id}`,
      score: scoreMatch(query.text, row.name),
    }));
  },
};

const teamProvider: GlobalSearchProvider = {
  moduleKey: "team",
  entityTypes: ["member"],
  async search(context, query) {
    if (!available(context, "team", "team.view")) return [];

    // Safe directory fields only — never pay, leave reasons or HR files
    // (PRD #26 §74, §75).
    const rows = await prisma.companyMember.findMany({
      where: {
        companyId: context.companyId,
        status: "ACTIVE",
        OR: [
          { user: { firstName: { contains: query.text, mode: "insensitive" } } },
          { user: { lastName: { contains: query.text, mode: "insensitive" } } },
          { jobTitle: { contains: query.text, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        jobTitle: true,
        user: { select: { firstName: true, lastName: true } },
        department: { select: { name: true } },
      },
      take: query.limitPerProvider,
    });

    return rows.map((row) => {
      const name = `${row.user.firstName} ${row.user.lastName}`.trim();
      return {
        moduleKey: "team",
        entityType: "member",
        entityId: row.id,
        title: name,
        subtitle: [row.jobTitle, row.department?.name].filter(Boolean).join(" · ") || null,
        href: `/team/${row.id}`,
        score: scoreMatch(query.text, name),
      };
    });
  },
};

const invoiceProvider: GlobalSearchProvider = {
  moduleKey: "finance",
  entityTypes: ["invoice"],
  async search(context, query) {
    if (!available(context, "finance", "finance.invoice.view")) return [];

    const rows = await prisma.invoice.findMany({
      where: {
        companyId: context.companyId,
        OR: [
          { invoiceNumber: { contains: query.text, mode: "insensitive" } },
          { client: { name: { contains: query.text, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        client: { select: { name: true } },
      },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "finance",
      entityType: "invoice",
      entityId: row.id,
      title: row.invoiceNumber,
      subtitle: row.client?.name ?? null,
      href: `/finance/invoices/${row.id}`,
      score: scoreMatch(query.text, row.invoiceNumber, row.invoiceNumber),
      status: row.status,
    }));
  },
};

const opportunityProvider: GlobalSearchProvider = {
  moduleKey: "sales",
  entityTypes: ["opportunity"],
  async search(context, query) {
    if (!available(context, "sales", "sales.opportunity.view")) return [];

    const rows = await prisma.opportunity.findMany({
      where: {
        companyId: context.companyId,
        name: { contains: query.text, mode: "insensitive" },
      },
      select: { id: true, name: true, stage: true, client: { select: { name: true } } },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "sales",
      entityType: "opportunity",
      entityId: row.id,
      title: row.name,
      subtitle: row.client?.name ?? null,
      href: `/sales/opportunities/${row.id}`,
      score: scoreMatch(query.text, row.name),
      status: row.stage,
    }));
  },
};

export const searchProviders: GlobalSearchProvider[] = [
  projectProvider,
  taskProvider,
  clientProvider,
  documentProvider,
  teamProvider,
  invoiceProvider,
  opportunityProvider,
];

export { SCORE };
export type { GlobalSearchQuery, GlobalSearchResultDTO };
