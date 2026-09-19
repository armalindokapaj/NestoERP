import type { Prisma } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can } from "@/lib/access/can";
import { buildClientScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { moduleAndPermissions, recordDefinitions } from "@/lib/core/records/record.registry";
import { prisma } from "@/lib/database/prisma";
import { buildPaymentScopeWhere } from "@/lib/modules/finance/finance.scope";
import { buildAttendanceScopeWhere, buildEmployeeScopeWhere } from "@/lib/modules/hr/hr.scope";
import { buildTransferScopeWhere } from "@/lib/modules/inventory/inventory.scope";
import { readablePhaseWhere } from "@/lib/modules/project-planning/planning.permissions";
import { readableUnitWhere } from "@/lib/modules/project-structure/structure.permissions";
import { buildTeamScopeWhere } from "@/lib/modules/team/team.scope";
import { formatRelativeTime } from "@/lib/utils/format";
import type { WidgetActivityItem } from "./dashboard.types";

/**
 * The Recent Activity widget (PRD #4 §15, PRD #47 §59, §175).
 *
 * The widget sits on every role's dashboard behind nothing more than
 * `dashboard.view`, so what it lists has to be decided row by row: an entry is
 * shown only when the reader could open the record it describes. Filtering by
 * "modules the role can open" is not that — it handed Company IT the sick
 * leave and pay events of HR, and a Project Manager the Finance payments they
 * are refused everywhere else.
 *
 * Every source below answers the same two questions a module's own activity
 * tab asks: may this reader read this module's history (its `*.activity.view`
 * grant, where it has one), and may they open this record (the record's view
 * permission and the scope clause its detail page uses). Anything that is not
 * a known source — an entity type no module vouches for — is left out rather
 * than shown on trust.
 */

/** How many entries the widget shows. */
export const RECENT_ACTIVITY_SIZE = 8;

/**
 * How far back one render reads before filtering. Bounded so a reader who can
 * open little never turns the widget into a scan of the company's whole
 * history; the price is a shorter list for them, never a slower dashboard.
 */
const OVER_READ = 5;
const READ_CAP = 60;

/** The module-level history grant, for modules that have one (PRD #47 §59). */
const MODULE_ACTIVITY_PERMISSION: Partial<Record<ModuleKey, Permission>> = {
  projects: "project.activity.view",
  tasks: "task.activity.view",
  clients: "client.activity.view",
  documents: "document.activity.view",
  finance: "finance.activity.view",
  hr: "hr.activity.view",
  sales: "sales.activity.view",
  contracts: "legal.activity.view",
  procurement: "procurement.activity.view",
  inventory: "inventory.activity.view",
  qaqc: "qaqc.activity.view",
  hse: "hse.activity.view",
  team: "team.activity.view",
};

type ActivitySource = {
  module: string;
  entityType: string;
  /** Of these entity ids, the ones this reader may open. */
  reachable(ids: string[]): Promise<string[]>;
};

type ExtraSource = {
  module: ModuleKey;
  entityType: string;
  permissions: Permission[];
  reachable(context: UserContext, ids: string[]): Promise<string[]>;
};

/**
 * Activity written under an entity that is not itself a registry record, each
 * read through the scope of the record it belongs to.
 */
const EXTRA_SOURCES: ExtraSource[] = [
  {
    // A contact is part of its client.
    module: "clients",
    entityType: "Contact",
    permissions: ["client.view"],
    async reachable(context, ids) {
      const rows = await prisma.contact.findMany({ where: { id: { in: ids }, companyId: context.companyId, client: buildClientScopeWhere(context) }, select: { id: true } });
      return rows.map((row) => row.id);
    },
  },
  {
    // Role changes, suspensions: the Team directory's own history (PRD #14 §145).
    module: "team",
    entityType: "CompanyMember",
    permissions: ["team.view"],
    async reachable(context, ids) {
      const rows = await prisma.companyMember.findMany({ where: { AND: [buildTeamScopeWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
  },
  {
    // "Whose pay changed" is compensation information even without a figure
    // (PRD #16 §137): only with the compensation grant, and only for employees in scope.
    module: "hr",
    entityType: "Compensation",
    permissions: ["hr.employee.view", "hr.compensation.view"],
    async reachable(context, ids) {
      const rows = await prisma.employeeProfile.findMany({ where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: { in: ids } }] }, select: { companyMemberId: true } });
      return rows.flatMap((row) => (row.companyMemberId ? [row.companyMemberId] : []));
    },
  },
  {
    module: "hr",
    entityType: "AttendanceRecord",
    permissions: ["hr.attendance.view"],
    async reachable(context, ids) {
      const rows = await prisma.attendanceRecord.findMany({ where: { AND: [buildAttendanceScopeWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
  },
  {
    module: "projects",
    entityType: "ProjectPhase",
    permissions: ["project.view", "project_planning.view"],
    async reachable(context, ids) {
      const rows = await prisma.projectPhase.findMany({ where: { AND: [readablePhaseWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
  },
  {
    // A payment inherits the invoice or expense it settles (PRD #15 §216).
    module: "finance",
    entityType: "Payment",
    permissions: ["finance.payment.view"],
    async reachable(context, ids) {
      const rows = await prisma.payment.findMany({ where: { AND: [buildPaymentScopeWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
  },
  // A unit's sale, contract and collection are written by Sales, Legal and
  // Finance against the one canonical unit (E-05E, E-05F): each is read where the
  // unit is reachable and its own tab would open — reserved, signed, paid.
  ...(
    [
      ["sales", "project.unit.sales.view"],
      ["contracts", "project.unit.legal.view"],
      ["finance", "project.unit.finance.view"],
    ] as const
  ).map(([module, permission]): ExtraSource => ({
    module,
    entityType: "ProjectUnit",
    permissions: ["project.view", "project.structure.view", permission],
    async reachable(context, ids) {
      const rows = await prisma.projectUnit.findMany({ where: { AND: [readableUnitWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
  })),
  {
    module: "inventory",
    entityType: "StockTransfer",
    permissions: ["inventory.transfer.view"],
    async reachable(context, ids) {
      const rows = await prisma.stockTransfer.findMany({ where: { AND: [buildTransferScopeWhere(context), { id: { in: ids } }] }, select: { id: true } });
      return rows.map((row) => row.id);
    },
  },
];

function historyOpen(context: UserContext, moduleKey: ModuleKey, permissions: readonly Permission[]): boolean {
  const activityPermission = MODULE_ACTIVITY_PERMISSION[moduleKey];
  return moduleAndPermissions(context, moduleKey, activityPermission ? [...permissions, activityPermission] : permissions);
}

/** The (module, entity type) pairs this reader may see history for, each with its reachability check. */
export function readableActivitySources(context: UserContext): ActivitySource[] {
  const sources: ActivitySource[] = [];
  for (const definition of recordDefinitions()) {
    if (!historyOpen(context, definition.moduleKey, definition.viewPermissions)) continue;
    sources.push({ module: definition.moduleKey, entityType: definition.activityEntityType, reachable: (ids) => definition.reachable(context, ids) });
  }
  for (const extra of EXTRA_SOURCES) {
    if (!historyOpen(context, extra.module, extra.permissions)) continue;
    sources.push({ module: extra.module, entityType: extra.entityType, reachable: (ids) => extra.reachable(context, ids) });
  }
  return sources;
}

const sourceKey = (module: string, entityType: string) => `${module} ${entityType}`;

/**
 * The newest entries this reader could open, newest first.
 *
 * One bounded read of the sources they may see at all, then one reachability
 * query per entity type — never a query per row.
 */
export async function loadRecentActivity(context: UserContext, take = RECENT_ACTIVITY_SIZE): Promise<WidgetActivityItem[]> {
  return (await loadRecentActivityRows(context, take)).map((row) => row.item);
}

/** The same entries with when each happened, so a view across companies can merge them in order. */
export async function loadRecentActivityRows(context: UserContext, take = RECENT_ACTIVITY_SIZE): Promise<Array<{ item: WidgetActivityItem; at: Date }>> {
  const sources = readableActivitySources(context);
  if (sources.length === 0) return [];
  const bySource = new Map(sources.map((source) => [sourceKey(source.module, source.entityType), source]));

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    OR: sources.map((source) => ({ module: source.module, entityType: source.entityType })),
    // A pay event can be written against the employee record too (PRD #16 §137).
    ...(can(context, "hr.compensation.view") ? {} : { NOT: { action: { startsWith: "HR_COMPENSATION" } } }),
  };

  const rows = await prisma.activity.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(take * OVER_READ, READ_CAP),
    select: {
      id: true,
      module: true,
      entityType: true,
      entityId: true,
      message: true,
      action: true,
      createdAt: true,
      actorMemberId: true,
      actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  });

  const idsBySource = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = sourceKey(row.module, row.entityType);
    idsBySource.set(key, (idsBySource.get(key) ?? new Set()).add(row.entityId));
  }

  const open = new Set<string>();
  await Promise.all(
    [...idsBySource.entries()].map(async ([key, ids]) => {
      const source = bySource.get(key);
      if (!source) return;
      for (const id of await source.reachable([...ids])) open.add(`${key} ${id}`);
    }),
  );

  return rows
    .filter((row) => open.has(`${sourceKey(row.module, row.entityType)} ${row.entityId}`))
    .slice(0, take)
    .map((row) => ({
      at: row.createdAt,
      item: {
        id: row.id,
        actor: row.actorMember ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}` : "NESTO",
        actorMemberId: row.actorMember ? row.actorMemberId : null,
        message: row.message ?? row.action,
        createdAt: formatRelativeTime(row.createdAt),
      },
    }));
}
