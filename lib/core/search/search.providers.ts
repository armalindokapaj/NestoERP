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
import { buildItemScopeWhere } from "@/lib/modules/inventory/inventory.scope";
import {
  buildInspectionScopeWhere as buildQaqcInspectionScopeWhere,
  buildNcrScopeWhere,
} from "@/lib/modules/qaqc/qaqc.scope";
import {
  buildIncidentScopeWhere,
  buildPermitScopeWhere,
} from "@/lib/modules/hse/hse.scope";
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
          buildDocumentAccessWhere(context),
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

export const searchProviders: GlobalSearchProvider[] = [
  projectProvider,
  taskProvider,
  clientProvider,
  documentProvider,
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
