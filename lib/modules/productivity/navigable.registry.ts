import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Navigable records (PRD #45 §81, §111, §163, §185-§192).
 *
 * The one allowlist of record types a person may favorite or return to, and
 * the one way each is resolved: in the reader's own context, in a single
 * query per type, through the module's own door and scope. A record the reader
 * cannot open right now is simply absent — never "restricted", which would
 * say it exists. Favorites and Recent Work both resolve here, so neither
 * keeps its own copy of any record's title, route or access rule.
 */

export type NavigableEntityDTO = {
  entityType: NavigableType;
  entityId: string;
  title: string;
  subtitle?: string;
  href: string;
  iconKey: string;
  status?: string;
  project?: { id: string; name: string };
};

export const NAVIGABLE_TYPES = ["project", "project_milestone", "task", "meeting", "daily_log", "client", "document", "contract", "purchase_order", "invoice"] as const;
export type NavigableType = (typeof NAVIGABLE_TYPES)[number];

export const NAVIGABLE_LABELS: Record<NavigableType, { singular: string; plural: string }> = {
  project: { singular: "Project", plural: "Projects" },
  project_milestone: { singular: "Milestone", plural: "Milestones" },
  task: { singular: "Task", plural: "Tasks" },
  meeting: { singular: "Meeting", plural: "Meetings" },
  daily_log: { singular: "Daily log", plural: "Daily logs" },
  client: { singular: "Client", plural: "Clients" },
  document: { singular: "Document", plural: "Documents" },
  contract: { singular: "Contract", plural: "Contracts" },
  purchase_order: { singular: "Purchase order", plural: "Purchase orders" },
  invoice: { singular: "Invoice", plural: "Invoices" },
};

export function isNavigableType(value: string): value is NavigableType {
  return (NAVIGABLE_TYPES as readonly string[]).includes(value);
}

type Provider = {
  key: NavigableType;
  moduleKey: ModuleKey;
  permissions: Permission[];
  resolveMany(context: UserContext, ids: string[]): Promise<NavigableEntityDTO[]>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (instant: Date) => `${instant.getUTCDate()} ${MONTHS[instant.getUTCMonth()]} ${instant.getUTCFullYear()}`;
const inIds = (ids: string[]) => ({ id: { in: ids } });

/**
 * Of these project ids, the ones the reader can open — and none at all without
 * the Projects door (PRD #47 §175).
 *
 * A record the reader may open does not hand them its project: a Company IT
 * member invited to a project meeting, or a finance reader with an invoice in
 * scope, can open that record while the project stays closed to them. The
 * project is then neither named nor linked — the rule the meeting page and the
 * calendar already follow (PRD #39 §46, PRD #40 §266).
 */
async function openProjectIds(context: UserContext, ids: ReadonlyArray<string | null | undefined>): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0 || !canAccessModule(context, "projects") || !can(context, "project.view")) return new Set();
  const rows = await prisma.project.findMany({ where: { AND: [buildProjectScopeWhere(context), inIds(wanted)] }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

/** The project reference, when the reader can open it. */
function projectRef(project: { id: string; name: string } | null | undefined, open: Set<string>): { id: string; name: string } | undefined {
  return project && open.has(project.id) ? project : undefined;
}

const PROVIDERS: Provider[] = [
  {
    key: "project",
    moduleKey: "projects",
    permissions: ["project.view"],
    async resolveMany(context, ids) {
      const rows = await prisma.project.findMany({ where: { AND: [buildProjectScopeWhere(context), inIds(ids)] }, select: { id: true, name: true, code: true, status: true } });
      return rows.map((row) => ({ entityType: "project", entityId: row.id, title: row.name, subtitle: row.code, href: `/projects/${row.id}`, iconKey: "project", status: row.status, project: { id: row.id, name: row.name } }));
    },
  },
  {
    key: "project_milestone",
    moduleKey: "projects",
    permissions: ["project.view", "project_planning.view"],
    async resolveMany(context, ids) {
      const { readableMilestoneWhere } = await import("@/lib/modules/project-planning/planning.permissions");
      const rows = await prisma.projectMilestone.findMany({ where: { AND: [readableMilestoneWhere(context), inIds(ids), { archivedAt: null }] }, select: { id: true, name: true, status: true, projectId: true, project: { select: { name: true } } } });
      return rows.map((row) => ({ entityType: "project_milestone", entityId: row.id, title: row.name, subtitle: `Milestone · ${row.project.name}`, href: `/projects/${row.projectId}/planning?milestone=${row.id}`, iconKey: "milestone", status: row.status, project: { id: row.projectId, name: row.project.name } }));
    },
  },
  {
    key: "task",
    moduleKey: "tasks",
    permissions: ["task.view"],
    async resolveMany(context, ids) {
      const rows = await prisma.task.findMany({ where: { AND: [buildTaskScopeWhere(context), inIds(ids)] }, select: { id: true, title: true, status: true, project: { select: { id: true, name: true } } } });
      const open = await openProjectIds(context, rows.map((row) => row.project?.id));
      return rows.map((row) => {
        const project = projectRef(row.project, open);
        return { entityType: "task", entityId: row.id, title: row.title, subtitle: project ? `Task · ${project.name}` : "Task", href: `/tasks/${row.id}`, iconKey: "task", status: row.status, project };
      });
    },
  },
  {
    key: "meeting",
    moduleKey: "meetings",
    permissions: ["meeting.view"],
    async resolveMany(context, ids) {
      const { readableMeetingWhere } = await import("@/lib/modules/meetings/meeting.permissions");
      const rows = await prisma.meeting.findMany({ where: { AND: [readableMeetingWhere(context), inIds(ids)] }, select: { id: true, title: true, status: true, startsAt: true, project: { select: { id: true, name: true } } } });
      const open = await openProjectIds(context, rows.map((row) => row.project?.id));
      return rows.map((row) => {
        const project = projectRef(row.project, open);
        return { entityType: "meeting", entityId: row.id, title: row.title, subtitle: [`Meeting · ${day(row.startsAt)}`, project?.name].filter(Boolean).join(" · "), href: `/meetings/${row.id}`, iconKey: "meeting", status: row.status, project };
      });
    },
  },
  {
    key: "daily_log",
    moduleKey: "dailyLogs",
    permissions: ["daily_log.view"],
    async resolveMany(context, ids) {
      const { readableDailyLogWhere } = await import("@/lib/modules/daily-logs/daily-log.permissions");
      const rows = await prisma.dailyLog.findMany({ where: { AND: [readableDailyLogWhere(context), inIds(ids)] }, select: { id: true, workDate: true, status: true, projectId: true, project: { select: { name: true } } } });
      return rows.map((row) => ({ entityType: "daily_log", entityId: row.id, title: `Daily log · ${day(row.workDate)}`, subtitle: row.project.name, href: `/projects/${row.projectId}/daily-logs/${row.id}`, iconKey: "daily_log", status: row.status, project: { id: row.projectId, name: row.project.name } }));
    },
  },
  {
    key: "client",
    moduleKey: "clients",
    permissions: ["client.view"],
    async resolveMany(context, ids) {
      const rows = await prisma.client.findMany({ where: { AND: [buildClientScopeWhere(context), inIds(ids)] }, select: { id: true, name: true, status: true } });
      return rows.map((row) => ({ entityType: "client", entityId: row.id, title: row.name, subtitle: "Client", href: `/clients/${row.id}`, iconKey: "client", status: row.status }));
    },
  },
  {
    key: "document",
    moduleKey: "documents",
    permissions: ["document.view"],
    async resolveMany(context, ids) {
      // A document is readable through its parent, decided in one where-clause.
      const { buildDocumentAccessWhere } = await import("@/lib/modules/documents/document.parent-access");
      const rows = await prisma.document.findMany({ where: { AND: [await buildDocumentAccessWhere(context), inIds(ids)] }, select: { id: true, name: true, status: true, extension: true, project: { select: { id: true, name: true } } } });
      const open = await openProjectIds(context, rows.map((row) => row.project?.id));
      return rows.map((row) => {
        const project = projectRef(row.project, open);
        return { entityType: "document", entityId: row.id, title: row.name, subtitle: [row.extension ? row.extension.toUpperCase() : "Document", project?.name].filter(Boolean).join(" · "), href: `/documents/${row.id}`, iconKey: "document", status: row.status, project };
      });
    },
  },
  {
    key: "contract",
    moduleKey: "contracts",
    permissions: ["legal.contract.view"],
    async resolveMany(context, ids) {
      const { buildContractScopeWhere } = await import("@/lib/modules/contracts/contract.scope");
      const rows = await prisma.contract.findMany({ where: { AND: [buildContractScopeWhere(context), inIds(ids)] }, select: { id: true, contractNumber: true, title: true, status: true } });
      return rows.map((row) => ({ entityType: "contract", entityId: row.id, title: row.contractNumber ? `${row.contractNumber} · ${row.title}` : row.title, subtitle: "Contract", href: `/contracts/${row.id}`, iconKey: "contract", status: row.status }));
    },
  },
  {
    key: "purchase_order",
    moduleKey: "procurement",
    permissions: ["procurement.order.view"],
    async resolveMany(context, ids) {
      const { buildOrderScopeWhere } = await import("@/lib/modules/procurement/procurement.scope");
      const rows = await prisma.purchaseOrder.findMany({ where: { AND: [buildOrderScopeWhere(context), inIds(ids)] }, select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } }, project: { select: { id: true, name: true } } } });
      const open = await openProjectIds(context, rows.map((row) => row.project?.id));
      return rows.map((row) => ({ entityType: "purchase_order", entityId: row.id, title: row.poNumber, subtitle: ["Purchase order", row.supplier?.name].filter(Boolean).join(" · "), href: `/procurement/orders/${row.id}`, iconKey: "purchase_order", status: row.status, project: projectRef(row.project, open) }));
    },
  },
  {
    key: "invoice",
    moduleKey: "finance",
    permissions: ["finance.invoice.view"],
    async resolveMany(context, ids) {
      const { buildInvoiceScopeWhere } = await import("@/lib/modules/finance/finance.scope");
      const rows = await prisma.invoice.findMany({ where: { AND: [buildInvoiceScopeWhere(context), inIds(ids)] }, select: { id: true, invoiceNumber: true, status: true, client: { select: { name: true } }, project: { select: { id: true, name: true } } } });
      const open = await openProjectIds(context, rows.map((row) => row.project?.id));
      return rows.map((row) => ({ entityType: "invoice", entityId: row.id, title: `Invoice ${row.invoiceNumber}`, subtitle: row.client?.name ?? "Invoice", href: `/finance/invoices/${row.id}`, iconKey: "invoice", status: row.status, project: projectRef(row.project, open) }));
    },
  },
];

const BY_KEY = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

function doorOpen(context: UserContext, provider: Provider): boolean {
  return isModuleEnabled(context, provider.moduleKey) && canAccessModule(context, provider.moduleKey) && provider.permissions.every((permission) => can(context, permission));
}

/**
 * Resolves references in the reader's context, one query per type, keeping the
 * order they were given in. Unknown types and records the reader cannot open
 * are dropped (§190-§192).
 */
export async function resolveNavigable(context: UserContext, refs: Array<{ entityType: string; entityId: string }>): Promise<NavigableEntityDTO[]> {
  const byType = new Map<NavigableType, string[]>();
  for (const ref of refs) {
    if (!isNavigableType(ref.entityType)) continue;
    byType.set(ref.entityType, [...(byType.get(ref.entityType) ?? []), ref.entityId]);
  }
  const resolved = new Map<string, NavigableEntityDTO>();
  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const provider = BY_KEY.get(type)!;
      if (!doorOpen(context, provider)) return;
      for (const item of await provider.resolveMany(context, [...new Set(ids)])) resolved.set(`${item.entityType}:${item.entityId}`, item);
    }),
  );
  return refs.map((ref) => resolved.get(`${ref.entityType}:${ref.entityId}`)).filter((item): item is NavigableEntityDTO => Boolean(item));
}

export async function canNavigate(context: UserContext, entityType: string, entityId: string): Promise<NavigableEntityDTO | null> {
  const [item] = await resolveNavigable(context, [{ entityType, entityId }]);
  return item ?? null;
}
