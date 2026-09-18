import { can, canAccessModule } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { buildContractScopeWhere } from "@/lib/modules/contracts/contract.scope";
import {
  buildOrderScopeWhere,
  buildRequestScopeWhere,
  buildSupplierWhere,
} from "@/lib/modules/procurement/procurement.scope";
import { buildInvoiceScopeWhere } from "@/lib/modules/finance/finance.scope";
import { buildItemScopeWhere } from "@/lib/modules/inventory/inventory.scope";
import {
  buildInspectionScopeWhere as buildQaqcInspectionScopeWhere,
  buildNcrScopeWhere,
} from "@/lib/modules/qaqc/qaqc.scope";
import {
  buildIncidentScopeWhere,
  buildPermitScopeWhere,
} from "@/lib/modules/hse/hse.scope";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { directoryQuerySchema } from "@/lib/modules/people/people.schema";
import { listPeople } from "@/lib/modules/people/people.service";
import { buildTeamScopeWhere } from "@/lib/modules/team/team.scope";
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

    /*
     * Metadata only: NESTO does not index the contents of private binaries
     * (PRD #26 §66, §71).
     *
     * And metadata is not public either. `buildDocumentAccessWhere` is the
     * same clause the Documents list uses, so a file filed under Finance is
     * exactly as findable here as it is there — which is to say, not at all
     * for somebody without Finance access. Searching on company alone leaked
     * the *title* of a confidential document to anyone holding a generic
     * `document.view`, and a title is precisely what §160 says must not be
     * confirmable (PRD #13 §270, PRD #29 §3, §248).
     */
    const rows = await prisma.document.findMany({
      where: {
        AND: [
          await buildDocumentAccessWhere(context),
          { archivedAt: null },
          // A placeholder whose upload never completed is not a document yet
          // (PRD #29 §162, §233).
          { storageStatus: "AVAILABLE" },
          {
            OR: [
              { name: { contains: query.text, mode: "insensitive" } },
              { fileName: { contains: query.text, mode: "insensitive" } },
            ],
          },
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

/**
 * The group's people (E-01 §144-§147). The directory's own reach and its own
 * fields — name, title, company, department — so search can never find a
 * person the directory would not list, or match on anything HR keeps private.
 */
const peopleProvider: GlobalSearchProvider = {
  moduleKey: "people",
  entityTypes: ["person"],
  async search(context, query) {
    if (!available(context, "people", "people.directory.view")) return [];
    const { data } = await listPeople(context, directoryQuerySchema.parse({ q: query.text, limit: query.limitPerProvider }));
    return data.map((person) => ({
      moduleKey: "people",
      entityType: "person",
      entityId: person.personId,
      title: person.name,
      subtitle: [person.jobTitle, person.employingCompany?.name, person.department?.name].filter(Boolean).join(" · ") || null,
      href: `/people/${person.personId}`,
      score: scoreMatch(query.text, person.name),
    }));
  },
};

const teamProvider: GlobalSearchProvider = {
  moduleKey: "team",
  entityTypes: ["member"],
  async search(context, query) {
    if (!available(context, "team", "team.view")) return [];

    // Safe directory fields only — never pay, leave reasons or HR files
    // (PRD #26 §74, §75). And only the people the Team directory itself would
    // list for this reader: a project-scoped member searching a name must not
    // find colleagues their directory hides (PRD #14 §145, PRD #47 §175).
    const rows = await prisma.companyMember.findMany({
      where: {
        AND: [
          buildTeamScopeWhere(context),
          {
            status: "ACTIVE",
            OR: [
              { user: { firstName: { contains: query.text, mode: "insensitive" } } },
              { user: { lastName: { contains: query.text, mode: "insensitive" } } },
              { jobTitle: { contains: query.text, mode: "insensitive" } },
            ],
          },
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

    // Finance's own invoice scope: a project-scoped reader finds invoices on
    // their projects only, and an archived invoice is out of the index like
    // every other archived record (PRD #15 §210, PRD #47 §175).
    const rows = await prisma.invoice.findMany({
      where: {
        AND: [
          buildInvoiceScopeWhere(context),
          {
            archivedAt: null,
            OR: [
              { invoiceNumber: { contains: query.text, mode: "insensitive" } },
              { client: { name: { contains: query.text, mode: "insensitive" } } },
            ],
          },
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

    // The Sales pipeline's own scope: an owner-scoped seller does not find a
    // colleague's deal by typing its name (PRD #17 §412, PRD #47 §175).
    const rows = await prisma.opportunity.findMany({
      where: {
        AND: [
          buildOpportunityScopeWhere(context),
          { archivedAt: null, name: { contains: query.text, mode: "insensitive" } },
        ],
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


/* -------------------------------------------------------------------------- */
/* Department modules                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The five providers below cover the modules PRD #26 §70-§100 names and the
 * 2026-09-13 gap audit found missing. Each one searches the record's number and
 * its title and nothing else: a purchase order's internal notes, an NCR's
 * findings and an incident's investigation narrative are exactly the free text
 * §58, §89 and §100 keep out of an index that spans the whole company.
 *
 * Every provider re-uses the module's own scope helper, so a record that would
 * not appear on the module's list screen cannot appear here either.
 */

const contractProvider: GlobalSearchProvider = {
  moduleKey: "contracts",
  entityTypes: ["contract"],
  async search(context, query) {
    if (!available(context, "contracts", "legal.contract.view")) return [];

    const rows = await prisma.contract.findMany({
      where: {
        AND: [
          buildContractScopeWhere(context),
          {
            archivedAt: null,
            OR: [
              { contractNumber: { contains: query.text, mode: "insensitive" } },
              { title: { contains: query.text, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: { id: true, title: true, contractNumber: true, status: true },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "contracts",
      entityType: "contract",
      entityId: row.id,
      title: row.title,
      subtitle: row.contractNumber,
      href: `/contracts/${row.id}`,
      score: scoreMatch(query.text, row.title, row.contractNumber),
      status: row.status,
    }));
  },
};

const procurementProvider: GlobalSearchProvider = {
  moduleKey: "procurement",
  entityTypes: ["purchase_order", "purchase_request", "supplier"],
  async search(context, query) {
    if (!canAccessModule(context, "procurement")) return [];

    const [orders, requests, suppliers] = await Promise.all([
      can(context, "procurement.order.view")
        ? prisma.purchaseOrder.findMany({
            where: {
              AND: [
                buildOrderScopeWhere(context),
                { archivedAt: null, poNumber: { contains: query.text, mode: "insensitive" } },
              ],
            },
            select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } } },
            take: query.limitPerProvider,
          })
        : [],
      can(context, "procurement.request.view")
        ? prisma.purchaseRequest.findMany({
            where: {
              AND: [
                buildRequestScopeWhere(context),
                {
                  archivedAt: null,
                  OR: [
                    { requestNumber: { contains: query.text, mode: "insensitive" } },
                    { title: { contains: query.text, mode: "insensitive" } },
                  ],
                },
              ],
            },
            select: { id: true, requestNumber: true, title: true, status: true },
            take: query.limitPerProvider,
          })
        : [],
      can(context, "procurement.supplier.view")
        ? prisma.supplier.findMany({
            where: {
              AND: [
                buildSupplierWhere(context),
                {
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
          })
        : [],
    ]);

    return [
      ...orders.map((row) => ({
        moduleKey: "procurement",
        entityType: "purchase_order",
        entityId: row.id,
        title: row.poNumber,
        subtitle: row.supplier?.name ?? null,
        href: `/procurement/orders/${row.id}`,
        score: scoreMatch(query.text, row.poNumber),
        status: row.status,
      })),
      ...requests.map((row) => ({
        moduleKey: "procurement",
        entityType: "purchase_request",
        entityId: row.id,
        title: row.title,
        subtitle: row.requestNumber,
        href: `/procurement/requests/${row.id}`,
        score: scoreMatch(query.text, row.title, row.requestNumber),
        status: row.status,
      })),
      ...suppliers.map((row) => ({
        moduleKey: "procurement",
        entityType: "supplier",
        entityId: row.id,
        title: row.name,
        subtitle: row.code,
        href: `/procurement/suppliers/${row.id}`,
        score: scoreMatch(query.text, row.name, row.code ?? undefined),
        status: row.status,
      })),
    ];
  },
};

const inventoryProvider: GlobalSearchProvider = {
  moduleKey: "inventory",
  entityTypes: ["inventory_item"],
  async search(context, query) {
    if (!available(context, "inventory", "inventory.item.view")) return [];

    const rows = await prisma.inventoryItem.findMany({
      where: {
        AND: [
          buildItemScopeWhere(context),
          {
            archivedAt: null,
            OR: [
              { sku: { contains: query.text, mode: "insensitive" } },
              { name: { contains: query.text, mode: "insensitive" } },
            ],
          },
        ],
      },
      // Stock figures are a separate permission and are deliberately not part
      // of a search result (PRD #20 §31).
      select: { id: true, sku: true, name: true, status: true },
      take: query.limitPerProvider,
    });

    return rows.map((row) => ({
      moduleKey: "inventory",
      entityType: "inventory_item",
      entityId: row.id,
      title: row.name,
      subtitle: row.sku,
      href: `/inventory/items/${row.id}`,
      score: scoreMatch(query.text, row.name, row.sku),
      status: row.status,
    }));
  },
};

const qaqcProvider: GlobalSearchProvider = {
  moduleKey: "qaqc",
  entityTypes: ["quality_inspection", "ncr"],
  async search(context, query) {
    if (!canAccessModule(context, "qaqc")) return [];

    const [inspections, ncrs] = await Promise.all([
      can(context, "qaqc.inspection.view")
        ? prisma.qualityInspection.findMany({
            where: {
              AND: [
                buildQaqcInspectionScopeWhere(context),
                { inspectionNumber: { contains: query.text, mode: "insensitive" } },
              ],
            },
            select: { id: true, inspectionNumber: true, status: true, result: true },
            take: query.limitPerProvider,
          })
        : [],
      can(context, "qaqc.ncr.view")
        ? prisma.nonConformanceReport.findMany({
            where: {
              AND: [
                buildNcrScopeWhere(context),
                {
                  OR: [
                    { ncrNumber: { contains: query.text, mode: "insensitive" } },
                    { title: { contains: query.text, mode: "insensitive" } },
                  ],
                },
              ],
            },
            select: { id: true, ncrNumber: true, title: true, status: true },
            take: query.limitPerProvider,
          })
        : [],
    ]);

    return [
      ...inspections.map((row) => ({
        moduleKey: "qaqc",
        entityType: "quality_inspection",
        entityId: row.id,
        title: row.inspectionNumber,
        subtitle: row.result,
        href: `/qaqc/inspections/${row.id}`,
        score: scoreMatch(query.text, row.inspectionNumber),
        status: row.status,
      })),
      ...ncrs.map((row) => ({
        moduleKey: "qaqc",
        entityType: "ncr",
        entityId: row.id,
        title: row.title,
        subtitle: row.ncrNumber,
        href: `/qaqc/ncrs/${row.id}`,
        score: scoreMatch(query.text, row.title, row.ncrNumber),
        status: row.status,
      })),
    ];
  },
};

const hseProvider: GlobalSearchProvider = {
  moduleKey: "hse",
  entityTypes: ["hse_incident", "hse_permit"],
  async search(context, query) {
    if (!canAccessModule(context, "hse")) return [];

    const [incidents, permits] = await Promise.all([
      can(context, "hse.incident.view")
        ? prisma.hseIncident.findMany({
            where: {
              AND: [
                buildIncidentScopeWhere(context),
                {
                  OR: [
                    { incidentNumber: { contains: query.text, mode: "insensitive" } },
                    { title: { contains: query.text, mode: "insensitive" } },
                  ],
                },
              ],
            },
            /*
             * Number, title and status only. The description, the injury
             * detail and the investigation findings are the sensitive half of
             * an incident and are behind their own permissions — a search
             * result must not become the way around them (PRD #26 §89).
             */
            select: { id: true, incidentNumber: true, title: true, status: true },
            take: query.limitPerProvider,
          })
        : [],
      can(context, "hse.permit.view")
        ? prisma.hseWorkPermit.findMany({
            where: {
              AND: [
                buildPermitScopeWhere(context),
                {
                  OR: [
                    { permitNumber: { contains: query.text, mode: "insensitive" } },
                    { title: { contains: query.text, mode: "insensitive" } },
                  ],
                },
              ],
            },
            select: { id: true, permitNumber: true, title: true, status: true },
            take: query.limitPerProvider,
          })
        : [],
    ]);

    return [
      ...incidents.map((row) => ({
        moduleKey: "hse",
        entityType: "hse_incident",
        entityId: row.id,
        title: row.title,
        subtitle: row.incidentNumber,
        href: `/hse/incidents/${row.id}`,
        score: scoreMatch(query.text, row.title, row.incidentNumber),
        status: row.status,
      })),
      ...permits.map((row) => ({
        moduleKey: "hse",
        entityType: "hse_permit",
        entityId: row.id,
        title: row.title,
        subtitle: row.permitNumber,
        href: `/hse/permits/${row.id}`,
        score: scoreMatch(query.text, row.title, row.permitNumber),
        status: row.status,
      })),
    ];
  },
};

/**
 * Calendar-owned events that have not ended (PRD #39 §115). The series is one
 * result, never one per occurrence; private detail is never searched — only
 * titles, and only of events this reader can already see.
 */
const calendarProvider: GlobalSearchProvider = {
  moduleKey: "calendar",
  entityTypes: ["calendar_event"],
  async search(context, query) {
    if (!available(context, "calendar", "calendar.view")) return [];
    const { readableEventWhere } = await import("@/lib/modules/calendar/calendar.visibility");
    const now = new Date();
    const rows = await prisma.calendarEvent.findMany({
      where: {
        AND: [
          readableEventWhere(context),
          { archivedAt: null, title: { contains: query.text, mode: "insensitive" } },
          {
            OR: [
              { recurrenceRule: null, OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }] },
              { recurrenceRule: { not: null }, OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gte: now } }] },
            ],
          },
        ],
      },
      orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true, eventType: true, recurrenceRule: true },
      take: query.limitPerProvider,
    });
    return rows.map((row) => ({
      moduleKey: "calendar",
      entityType: "calendar_event",
      entityId: row.id,
      title: row.title,
      subtitle: row.recurrenceRule ? "Repeating event" : row.startsAt.toISOString().slice(0, 10),
      href: `/calendar?event=${row.id}`,
      score: scoreMatch(query.text, row.title),
      status: row.eventType,
    }));
  },
};

/**
 * Meetings (PRD #40 §118, §119, §199): title, project, type and date of
 * meetings this reader can open. Minutes, agenda and decisions are never
 * searched.
 */
const meetingProvider: GlobalSearchProvider = {
  moduleKey: "meetings",
  entityTypes: ["meeting"],
  async search(context, query) {
    if (!available(context, "meetings", "meeting.view")) return [];
    const { readableMeetingWhere } = await import("@/lib/modules/meetings/meeting.permissions");
    const { MEETING_TYPE_LABELS } = await import("@/lib/modules/meetings/meeting.types");
    const projectOpen = available(context, "projects", "project.view");
    const term = { contains: query.text, mode: "insensitive" as const };
    const rows = await prisma.meeting.findMany({
      where: {
        AND: [
          readableMeetingWhere(context),
          { archivedAt: null },
          {
            OR: [
              { title: term },
              ...(projectOpen ? [{ project: { is: { AND: [buildProjectScopeWhere(context), { OR: [{ name: term }, { code: term }] }] } } }] : []),
            ],
          },
        ],
      },
      orderBy: { startsAt: "desc" },
      select: { id: true, title: true, startsAt: true, meetingType: true, status: true, seriesId: true, projectId: true, project: { select: { id: true, name: true } } },
      // A weekly series is up to a hundred rows with one title; read past them
      // so a single series cannot fill the provider's whole allowance.
      take: query.limitPerProvider * 20,
    });
    // One result per series — its next occurrence, or its latest if none is
    // still to come — so searching a project name finds the meeting, not every
    // Monday of it (PRD #40 §31).
    const now = Date.now();
    const rank = (startsAt: Date) => (startsAt.getTime() >= now ? startsAt.getTime() - now : Number.MAX_SAFE_INTEGER / 2 + (now - startsAt.getTime()));
    const bySeries = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!row.seriesId) continue;
      const current = bySeries.get(row.seriesId);
      if (!current || rank(row.startsAt) < rank(current.startsAt)) bySeries.set(row.seriesId, row);
    }
    const picked = rows.filter((row) => !row.seriesId || bySeries.get(row.seriesId) === row).slice(0, query.limitPerProvider);
    const openProjects =
      projectOpen && picked.some((row) => row.projectId)
        ? new Set(
            (
              await prisma.project.findMany({
                where: { AND: [buildProjectScopeWhere(context), { id: { in: picked.map((row) => row.projectId).filter((id): id is string => Boolean(id)) } }] },
                select: { id: true },
              })
            ).map((row) => row.id),
          )
        : new Set<string>();
    return picked.map((row) => ({
      moduleKey: "meetings",
      entityType: "meeting",
      entityId: row.id,
      title: row.title,
      subtitle: [row.startsAt.toISOString().slice(0, 10), MEETING_TYPE_LABELS[row.meetingType], row.project && openProjects.has(row.project.id) ? row.project.name : null]
        .filter(Boolean)
        .join(" · "),
      href: `/meetings/${row.id}`,
      score: scoreMatch(query.text, row.title),
      status: row.status,
    }));
  },
};

/**
 * Daily logs (PRD #43 §203, §204): the project, the day and the summary of logs
 * this reader can open. Notes, visitors and entries are never searched.
 */
const dailyLogProvider: GlobalSearchProvider = {
  moduleKey: "dailyLogs",
  entityTypes: ["daily_log"],
  async search(context, query) {
    if (!available(context, "dailyLogs", "daily_log.view")) return [];
    const { readableDailyLogWhere } = await import("@/lib/modules/daily-logs/daily-log.permissions");
    const { dateLabel } = await import("@/lib/modules/daily-logs/daily-log.time");
    const { DAILY_LOG_STATUS_LABELS } = await import("@/lib/modules/daily-logs/daily-log.types");
    const term = { contains: query.text, mode: "insensitive" as const };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(query.text.trim()) ? new Date(`${query.text.trim()}T12:00:00.000Z`) : null;
    const rows = await prisma.dailyLog.findMany({
      where: {
        AND: [
          readableDailyLogWhere(context),
          { OR: [{ summary: term }, { project: { is: { OR: [{ name: term }, { code: term }] } } }, ...(date && !Number.isNaN(date.getTime()) ? [{ workDate: date }] : [])] },
        ],
      },
      orderBy: { workDate: "desc" },
      take: query.limitPerProvider,
      select: { id: true, workDate: true, status: true, summary: true, projectId: true, project: { select: { name: true } } },
    });
    return rows.map((row) => ({
      moduleKey: "dailyLogs",
      entityType: "daily_log",
      entityId: row.id,
      title: `Daily log · ${row.project.name}`,
      subtitle: [dateLabel(row.workDate.toISOString().slice(0, 10)), DAILY_LOG_STATUS_LABELS[row.status]].join(" · "),
      href: `/projects/${row.projectId}/daily-logs/${row.id}`,
      score: scoreMatch(query.text, `${row.project.name} ${row.summary ?? ""}`),
      status: row.status,
    }));
  },
};

/**
 * Milestones (PRD #44 §176, §177): name, project, phase and type, over the
 * plans this reader can open. Descriptions and discussion are not searched.
 */
const milestoneProvider: GlobalSearchProvider = {
  moduleKey: "projects",
  entityTypes: ["project_milestone"],
  async search(context, query) {
    if (!available(context, "projects", "project_planning.view")) return [];
    const { readableMilestoneWhere } = await import("@/lib/modules/project-planning/planning.permissions");
    const { dateLabel, dateOf, displayDateOf } = await import("@/lib/modules/project-planning/planning.dates");
    const { MILESTONE_TYPES, STATUS_LABELS, TYPE_LABELS } = await import("@/lib/modules/project-planning/planning.types");
    const term = { contains: query.text, mode: "insensitive" as const };
    const types = MILESTONE_TYPES.filter((type) => TYPE_LABELS[type].toLowerCase().includes(query.text.trim().toLowerCase()));
    const rows = await prisma.projectMilestone.findMany({
      where: {
        AND: [
          readableMilestoneWhere(context),
          { archivedAt: null },
          { OR: [{ name: term }, { project: { is: { OR: [{ name: term }, { code: term }] } } }, { phase: { is: { name: term } } }, ...(types.length ? [{ milestoneType: { in: types } }] : [])] },
        ],
      },
      orderBy: [{ forecastDate: "asc" }],
      take: query.limitPerProvider,
      select: { id: true, name: true, status: true, projectId: true, baselineDate: true, plannedDate: true, forecastDate: true, actualDate: true, project: { select: { name: true } } },
    });
    return rows.map((row) => {
      const date = displayDateOf({ status: row.status, baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate), actualDate: dateOf(row.actualDate) });
      return {
        moduleKey: "projects",
        entityType: "project_milestone",
        entityId: row.id,
        title: row.name,
        subtitle: [`Milestone · ${row.project.name}`, date ? `${row.status === "COMPLETED" ? "Achieved" : "Forecast"} ${dateLabel(date)}` : null, STATUS_LABELS[row.status]].filter(Boolean).join(" · "),
        href: `/projects/${row.projectId}/planning?milestone=${row.id}`,
        score: scoreMatch(query.text, `${row.name} ${row.project.name}`),
        status: row.status,
      };
    });
  },
};

/**
 * Announcements (PRD #45 §125, §126, §278, §285): title and body of published
 * and expired announcements in this reader's audience, decided in the query.
 */
const announcementProvider: GlobalSearchProvider = {
  moduleKey: "announcements",
  entityTypes: ["announcement"],
  async search(context, query) {
    if (!available(context, "announcements", "announcement.view")) return [];
    const { audienceWhere } = await import("@/lib/modules/announcements/announcement.permissions");
    const { excerpt } = await import("@/lib/modules/announcements/announcement.body");
    const term = { contains: query.text, mode: "insensitive" as const };
    const rows = await prisma.announcement.findMany({
      where: { companyId: context.companyId, status: { in: ["PUBLISHED", "EXPIRED"] }, AND: [audienceWhere(context), { OR: [{ title: term }, { body: term }, { project: { is: { name: term } } }, { department: { is: { name: term } } }] }] },
      orderBy: { publishedAt: "desc" },
      take: query.limitPerProvider,
      select: { id: true, title: true, body: true, status: true, audienceType: true, publishedAt: true, project: { select: { name: true } }, department: { select: { name: true } } },
    });
    return rows.map((row) => ({
      moduleKey: "announcements",
      entityType: "announcement",
      entityId: row.id,
      title: row.title,
      subtitle: [row.project ? `Project · ${row.project.name}` : row.department ? `Department · ${row.department.name}` : row.audienceType === "COMPANY" ? "Company" : "Selected members", excerpt(row.body, 80)].join(" · "),
      href: `/announcements/${row.id}`,
      score: scoreMatch(query.text, row.title),
      status: row.status,
    }));
  },
};

/**
 * Contractors and work packages (PRD #46 §203-§205): legal name, trading name,
 * registration and VAT number inside the directory's scope; work package code
 * and name inside the reader's project door.
 */
const contractorProvider: GlobalSearchProvider = {
  moduleKey: "contractors",
  entityTypes: ["contractor", "work_package"],
  async search(context, query) {
    const { contractorDirectoryWhere, contractorsOpen, readableWorkPackageWhere } = await import("@/lib/modules/contractors/contractor.permissions");
    const { CONTRACTOR_STATUS_LABELS, WORK_PACKAGE_STATUS_LABELS } = await import("@/lib/modules/contractors/contractor.types");
    if (!contractorsOpen(context)) return [];
    const term = { contains: query.text, mode: "insensitive" as const };
    const [contractors, packages] = await Promise.all([
      prisma.contractorProfile.findMany({
        where: { AND: [contractorDirectoryWhere(context), { status: { not: "ARCHIVED" }, OR: [{ legalName: term }, { tradingName: term }, { registrationNumber: term }, { vatNumber: term }] }] },
        orderBy: { legalName: "asc" },
        take: query.limitPerProvider,
        select: { id: true, legalName: true, tradingName: true, status: true, city: true },
      }),
      contractorsOpen(context, "work_package.view")
        ? prisma.workPackage.findMany({
            where: { AND: [readableWorkPackageWhere(context), { archivedAt: null, OR: [{ code: term }, { name: term }, { contractor: { is: { legalName: term } } }] }] },
            orderBy: { code: "asc" },
            take: query.limitPerProvider,
            select: { id: true, code: true, name: true, status: true, projectId: true, project: { select: { name: true } }, contractor: { select: { legalName: true } } },
          })
        : [],
    ]);
    return [
      ...contractors.map((row) => ({
        moduleKey: "contractors",
        entityType: "contractor",
        entityId: row.id,
        title: row.legalName,
        subtitle: ["Contractor", row.tradingName, row.city, CONTRACTOR_STATUS_LABELS[row.status]].filter(Boolean).join(" · "),
        href: `/contractors/${row.id}`,
        score: scoreMatch(query.text, row.legalName, row.tradingName ?? undefined),
        status: row.status,
      })),
      ...packages.map((row) => ({
        moduleKey: "contractors",
        entityType: "work_package",
        entityId: row.id,
        title: `${row.code} · ${row.name}`,
        subtitle: ["Work package", row.project.name, row.contractor?.legalName, WORK_PACKAGE_STATUS_LABELS[row.status]].filter(Boolean).join(" · "),
        href: `/projects/${row.projectId}/work-packages/${row.id}`,
        score: scoreMatch(query.text, row.code, row.name),
        status: row.status,
      })),
    ];
  },
};

/**
 * Engineering records (PRD #46 §97, §109, §124, §203-§205): RFI number and
 * subject, submittal number and title, document number and title, transmittal
 * number — each through its own permission and the reader's project door.
 */
const engineeringProvider: GlobalSearchProvider = {
  moduleKey: "engineering",
  entityTypes: ["rfi", "technical_submittal", "engineering_document", "transmittal"],
  async search(context, query) {
    const permissions = await import("@/lib/modules/engineering/engineering.permissions");
    const { REVIEW_STATUS_LABELS, RFI_STATUS_LABELS, SUBMITTAL_TYPE_LABELS, DOCUMENT_TYPE_LABELS, TRANSMITTAL_STATUS_LABELS } = await import("@/lib/modules/engineering/engineering.types");
    if (!permissions.engineeringOpen(context, "rfi.view") && !permissions.engineeringOpen(context, "engineering_document.view")) return [];
    const term = { contains: query.text, mode: "insensitive" as const };
    const take = query.limitPerProvider;
    const [rfis, submittals, documents, transmittals] = await Promise.all([
      permissions.engineeringOpen(context, "rfi.view")
        ? prisma.rfi.findMany({ where: { AND: [permissions.readableRfiWhere(context), { status: { not: "VOID" }, OR: [{ rfiNumber: term }, { subject: term }, { contractor: { is: { legalName: term } } }] }] }, orderBy: { rfiNumber: "asc" }, take, select: { id: true, rfiNumber: true, subject: true, status: true, projectId: true, project: { select: { name: true } } } })
        : [],
      permissions.engineeringOpen(context, "submittal.view")
        ? prisma.technicalSubmittal.findMany({ where: { AND: [permissions.readableSubmittalWhere(context), { status: { not: "VOID" }, OR: [{ submittalNumber: term }, { title: term }, { contractor: { is: { legalName: term } } }] }] }, orderBy: { submittalNumber: "asc" }, take, select: { id: true, submittalNumber: true, title: true, status: true, submittalType: true, projectId: true, project: { select: { name: true } } } })
        : [],
      permissions.engineeringOpen(context, "engineering_document.view")
        ? prisma.engineeringDocument.findMany({ where: { AND: [permissions.readableEngineeringDocumentWhere(context), { status: { not: "VOID" }, OR: [{ documentNumber: term }, { title: term }] }] }, orderBy: { documentNumber: "asc" }, take, select: { id: true, documentNumber: true, title: true, status: true, documentType: true, projectId: true, project: { select: { name: true } }, currentRevision: { select: { revisionCode: true } } } })
        : [],
      permissions.engineeringOpen(context, "transmittal.view")
        ? prisma.documentTransmittal.findMany({ where: { AND: [permissions.readableTransmittalWhere(context), { OR: [{ transmittalNumber: term }, { subject: term }] }] }, orderBy: { transmittalNumber: "asc" }, take, select: { id: true, transmittalNumber: true, subject: true, status: true, projectId: true, project: { select: { name: true } } } })
        : [],
    ]);
    return [
      ...rfis.map((row) => ({ moduleKey: "engineering", entityType: "rfi", entityId: row.id, title: `${row.rfiNumber} · ${row.subject}`, subtitle: ["RFI", row.project.name, RFI_STATUS_LABELS[row.status]].join(" · "), href: `/projects/${row.projectId}/engineering/rfis/${row.id}`, score: scoreMatch(query.text, row.rfiNumber, row.subject), status: row.status })),
      ...submittals.map((row) => ({ moduleKey: "engineering", entityType: "technical_submittal", entityId: row.id, title: `${row.submittalNumber} · ${row.title}`, subtitle: [SUBMITTAL_TYPE_LABELS[row.submittalType], row.project.name, REVIEW_STATUS_LABELS[row.status]].join(" · "), href: `/projects/${row.projectId}/engineering/submittals/${row.id}`, score: scoreMatch(query.text, row.submittalNumber, row.title), status: row.status })),
      ...documents.map((row) => ({ moduleKey: "engineering", entityType: "engineering_document", entityId: row.id, title: `${row.documentNumber} · ${row.title}`, subtitle: [DOCUMENT_TYPE_LABELS[row.documentType], row.currentRevision ? `Rev ${row.currentRevision.revisionCode}` : null, row.project.name, REVIEW_STATUS_LABELS[row.status]].filter(Boolean).join(" · "), href: `/projects/${row.projectId}/engineering/documents/${row.id}`, score: scoreMatch(query.text, row.documentNumber, row.title), status: row.status })),
      ...transmittals.map((row) => ({ moduleKey: "engineering", entityType: "transmittal", entityId: row.id, title: row.subject ? `${row.transmittalNumber} · ${row.subject}` : row.transmittalNumber, subtitle: ["Transmittal", row.project.name, TRANSMITTAL_STATUS_LABELS[row.status]].join(" · "), href: `/projects/${row.projectId}/engineering/transmittals/${row.id}`, score: scoreMatch(query.text, row.transmittalNumber, row.subject ?? undefined), status: row.status })),
    ];
  },
};

export const searchProviders: GlobalSearchProvider[] = [
  calendarProvider,
  contractorProvider,
  engineeringProvider,
  meetingProvider,
  dailyLogProvider,
  milestoneProvider,
  announcementProvider,
  projectProvider,
  taskProvider,
  clientProvider,
  documentProvider,
  peopleProvider,
  teamProvider,
  invoiceProvider,
  opportunityProvider,
  contractProvider,
  procurementProvider,
  inventoryProvider,
  qaqcProvider,
  hseProvider,
];

export { SCORE };
export type { GlobalSearchQuery, GlobalSearchResultDTO };
