import { Prisma } from "@prisma/client";

import { dashboardForRole, groupDashboardFor } from "@/config/dashboards";
import { kpis } from "@/config/kpis";
import { quickActions } from "@/config/quick-actions";
import { widgets } from "@/config/widgets";
import type { Permission } from "@/config/permissions";
import { listReadableAttention } from "@/lib/core/notifications/attention.service";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import {
  buildClientScopeWhere,
  buildProjectLinkedScopeWhere,
  buildProjectScopeWhere,
  buildTaskScopeWhere,
} from "@/lib/access/scope";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import * as financeKpis from "@/lib/modules/finance/finance.kpis";
import { buildBudgetScopeWhere, buildInvoiceScopeWhere } from "@/lib/modules/finance/finance.scope";
import { personName, PERSON_NAME_SELECT } from "@/lib/modules/hr/hr.person";
import { buildHrMemberScopeWhere, buildLeaveScopeWhere } from "@/lib/modules/hr/hr.scope";
import {
  buildBalanceScopeWhere,
  buildMovementScopeWhere,
  canSeeStockFigures,
} from "@/lib/modules/inventory/inventory.scope";
import { buildTeamScopeWhere } from "@/lib/modules/team/team.scope";
import { buildContractScopeWhere } from "@/lib/modules/contracts/contract.scope";
import { EXPIRING_SOON_DAYS } from "@/lib/modules/contracts/contracts/contract.status";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { currencyTotals } from "@/lib/modules/sales/opportunities/opportunity.forecast";
import {
  OPEN_STAGES,
  opportunityStageLabels,
} from "@/lib/modules/sales/opportunities/opportunity.stage";
import { leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import {
  buildHazardScopeWhere,
  buildIncidentScopeWhere,
  buildPermitScopeWhere,
  buildStopWorkScopeWhere,
} from "@/lib/modules/hse/hse.scope";
import { riskLevelLabels } from "@/lib/modules/hse/hse.risk";
import {
  OPEN_HAZARD_STATUSES,
  OPEN_INCIDENT_STATUSES,
} from "@/lib/modules/hse/hse.status";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { prisma } from "@/lib/database/prisma";
import { formatCurrency, formatRelativeTime } from "@/lib/utils/format";
import { loadRecentActivity } from "./dashboard.activity";
import {
  groupActiveProjects,
  groupActivity,
  groupApprovals,
  groupAttention,
  groupCompanies,
  groupCompanyCount,
  groupDepartments,
  groupEmployees,
  groupExternalCompanies,
  groupFinance,
  groupKeyProjects,
  groupOpenTasks,
  groupOverdueTasks,
  groupPendingApprovals,
  groupTasks,
  groupMilestones,
  groupPipeline,
  groupPortfolioByStatus,
  groupPortfolioValue,
  groupProjectTypes,
  type GroupFigure,
} from "./dashboard.group";
import type {
  ResolvedDashboard,
  ResolvedKpi,
  ResolvedWidget,
  WidgetAlert,
  WidgetApproval,
  WidgetPayload,
} from "./dashboard.types";

/**
 * The dashboard resolver (PRD #4 §6, §83; NAV-03 STREAM-03).
 *
 * user → role → permissions → module access → data scope → widgets.
 *
 * Nothing is rendered and then hidden: a widget whose permission the user does
 * not hold is never loaded at all, and every query it runs is already scoped
 * (PRD #4 §10, §19, §20). One widget failing leaves the rest of the dashboard
 * working (PRD #4 §77).
 *
 * Two stages. `planDashboard` decides, from access alone, which KPIs, widgets
 * and quick actions this reader gets and in what order; `loadPlannedKpi` and
 * `loadPlannedWidget` then read one item each. The page streams the items one
 * by one; `resolveDashboard` composes the same two stages for everyone else,
 * so there is one set of permission rules.
 */
export type DashboardPlan = {
  focus: string;
  kpis: Array<(typeof kpis)[string]>;
  widgets: Array<(typeof widgets)[string]>;
  quickActions: ResolvedDashboard["quickActions"];
};

export async function planDashboard(context: UserContext): Promise<DashboardPlan> {
  // The same dashboard engine for both workspaces (Workspace Context §18): the
  // Group workspace reads its own layout, asking each authorised company in turn.
  if (context.workspace.scopeType === "GROUP") return planGroupDashboard(context);

  const config = dashboardForRole(context.role, context.position);

  // A switched-off module is absent from the dashboard (PRD #47 §26). And a group
  // figure has no place in a company workspace, whatever the role's layout lists:
  // the company's own dashboard is that company's data (§20, §75).
  const visibleKpis = config.kpis
    .map((key) => kpis[key])
    .filter(
      (definition) =>
        definition &&
        definition.supportsCompanyContext !== false &&
        isModuleEnabled(context, definition.module) &&
        can(context, definition.permission) &&
        (KPI_ALSO_REQUIRES[definition.key] ?? []).every((permission) => can(context, permission)),
    );

  const visibleWidgets = config.widgets
    .map((key) => widgets[key])
    .filter(
      (definition) =>
        definition &&
        definition.supportsCompanyContext !== false &&
        isModuleEnabled(context, definition.module) &&
        can(context, definition.permission),
    )
    .sort((a, b) => a.priority - b.priority);

  const visibleActions = config.quickActions
    .map((key) => quickActions[key])
    .filter((definition) => definition && can(context, definition.permission));

  return { focus: config.focus, kpis: visibleKpis, widgets: visibleWidgets, quickActions: visibleActions };
}

export async function resolveDashboard(context: UserContext): Promise<ResolvedDashboard> {
  const plan = await planDashboard(context);
  const [resolvedKpis, resolvedWidgets] = await Promise.all([
    Promise.all(plan.kpis.map((definition) => loadPlannedKpi(context, definition))).then((rows) => rows.filter((row): row is ResolvedKpi => row !== null)),
    Promise.all(plan.widgets.map((definition) => loadPlannedWidget(context, definition))),
  ]);
  return { focus: plan.focus, kpis: resolvedKpis, widgets: resolvedWidgets, quickActions: plan.quickActions };
}

/**
 * The Group workspace's dashboard (Workspace Context §19, §21, §75).
 *
 * An entry is shown when it declares the group and at least one company the
 * reader may enter both has its module on and grants what it needs — the same
 * "only what you are permitted to see" as everywhere, asked company by company.
 * The loaders then read each company as the reader there, so a company that
 * withholds a figure is left out of it rather than counted partly.
 */
async function planGroupDashboard(context: UserContext): Promise<DashboardPlan> {
  const companies = await resolveGroupContexts(context);
  const offered = (definition: { module: Parameters<typeof isModuleEnabled>[1]; permission: Permission; supportsGroupContext?: boolean } | undefined) =>
    Boolean(definition?.supportsGroupContext) && companies.some((company) => isModuleEnabled(company, definition!.module) && can(company, definition!.permission));

  const config = groupDashboardFor(context.role, context.position);
  const visibleKpis = config.kpis.map((key) => kpis[key]).filter(offered);
  const visibleWidgets = config.widgets
    .map((key) => widgets[key])
    .filter(offered)
    .sort((a, b) => a.priority - b.priority);

  return { focus: config.focus, kpis: visibleKpis, widgets: visibleWidgets, quickActions: [] };
}

/**
 * One planned KPI. A group figure with nothing behind it for this reader is
 * left out (null), not shown as a dash (D-01 §66); a figure that could not be
 * read is a dash, never a zero.
 */
export async function loadPlannedKpi(context: UserContext, definition: (typeof kpis)[string]): Promise<ResolvedKpi | null> {
  const value = await loadKpi(context, definition.key).catch(() => null);
  if (value === NOT_FOR_READER) return null;
  if (value !== null && typeof value === "object") return { definition, value: value.value, hint: value.hint, breakdown: value.breakdown };
  return { definition, value: value ?? "—" };
}

/** One planned widget; its failure is its own error state (PRD #4 §77). */
export async function loadPlannedWidget(context: UserContext, definition: (typeof widgets)[string]): Promise<ResolvedWidget> {
  const payload = await loadWidget(context, definition.key).catch((): WidgetPayload => ({ kind: "error" }));
  return { definition, payload };
}

/* -------------------------------------------------------------------------- */
/* KPIs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Grants a KPI needs beyond the one its configuration names.
 *
 * "Project Invoiced" is a sum of invoices. `finance.project_budget.view` lets
 * somebody read a project's budget, not what was billed on it — a Project
 * Manager is refused the invoices themselves — so the figure also needs the
 * invoice grant (PRD #47 §59, §175). Checked here as well as in `loadKpi`, so
 * the tile is absent rather than blank.
 */
const KPI_ALSO_REQUIRES: Partial<Record<string, Permission[]>> = {
  projectInvoiced: ["finance.invoice.view"],
};

/** A group KPI the reader has nothing behind: no company where its figure is theirs to read. */
const NOT_FOR_READER = Symbol("not for this reader");

async function groupFigure(figure: Promise<GroupFigure | null>): Promise<GroupFigure | typeof NOT_FOR_READER> {
  return (await figure) ?? NOT_FOR_READER;
}

async function loadKpi(context: UserContext, key: string): Promise<string | GroupFigure | typeof NOT_FOR_READER> {
  switch (key) {
    case "groupCompanyCount":
      return groupFigure(groupCompanyCount(context));
    case "groupActiveProjects":
      return groupFigure(groupActiveProjects(context));
    case "groupEmployees":
      return groupFigure(groupEmployees(context));
    case "groupExternalCompanies":
      return groupFigure(groupExternalCompanies(context));
    case "groupPortfolioValue":
      return groupFigure(groupPortfolioValue(context));
    case "groupPendingApprovals":
      return groupFigure(groupPendingApprovals(context));
    case "groupOpenTasks":
      return groupFigure(groupOpenTasks(context));
    case "groupOverdueTasks":
      return groupFigure(groupOverdueTasks(context));

    case "activeProjects":
      return String(
        await prisma.project.count({
          where: { AND: [buildProjectScopeWhere(context), { status: "ACTIVE", archivedAt: null }] },
        }),
      );

    case "myProjectCount":
      return String(
        await prisma.project.count({
          where: {
            companyId: context.companyId,
            archivedAt: null,
            OR: [
              { projectManagerMemberId: context.membershipId },
              {
                members: { some: { companyMemberId: context.membershipId, status: "ACTIVE" } },
              },
            ],
          },
        }),
      );

    case "projectsAtRisk":
      return String(await countProjectsAtRisk(context));

    case "openTaskCount":
      return String(
        await prisma.task.count({
          where: {
            AND: [
              buildTaskScopeWhere(context),
              { archivedAt: null, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
            ],
          },
        }),
      );

    case "overdueTaskCount":
      return String(
        await prisma.task.count({
          where: {
            AND: [
              buildTaskScopeWhere(context),
              {
                archivedAt: null,
                status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
                dueDate: { lt: new Date() },
              },
            ],
          },
        }),
      );

    case "approvalCount":
      return String((await loadApprovals(context)).length);

    case "clientCount":
      return String(
        await prisma.client.count({
          where: { AND: [buildClientScopeWhere(context), { status: "ACTIVE" }] },
        }),
      );

    case "documentCount":
      return String(
        await prisma.document.count({
          where: { AND: [await buildDocumentAccessWhere(context), { status: "ACTIVE" }] },
        }),
      );

    // Finance figures come from the Finance module's own helpers, so a
    // dashboard number and the Finance overview can never disagree
    // (PRD #15 §258, §259).
    case "receivables":
      return formatKpi(await financeKpis.receivablesKpi(context));

    case "overdueValue":
      return formatKpi(await financeKpis.overdueReceivablesKpi(context));

    case "invoicedValue":
      return formatKpi(await financeKpis.invoicedValueKpi(context));

    case "projectInvoiced": {
      if (!can(context, "finance.invoice.view")) return "—";
      const { currency, rows } = await financeKpis.invoicedByProject(context);
      const total = rows.reduce(
        (sum, row) => sum.plus(row._sum.totalAmount ?? 0),
        new Prisma.Decimal(0),
      );
      return formatKpi({ amount: total, currency });
    }

    // The people whose employment records the reader may see, counted through
    // HR's own scope — a department-scoped reader gets their department, not
    // the company (PRD #16 §164, PRD #47 §175).
    case "headcount":
      return String(
        await prisma.companyMember.count({
          where: { AND: [buildHrMemberScopeWhere(context), { status: "ACTIVE" }] },
        }),
      );

    case "pendingLeave":
      return String(
        await prisma.leaveRequest.count({
          where: { AND: [buildLeaveScopeWhere(context), { status: "PENDING" }] },
        }),
      );

    /**
     * The open pipeline, inside the reader's own Sales scope (PRD #17 §412).
     *
     * The headline figure is the largest currency's, with the rest named
     * beside it: adding euros to dollars would be a number nobody can act on
     * (PRD #17 §31).
     */
    case "pipelineValue": {
      const rows = await prisma.opportunity.findMany({
        where: {
          AND: [buildOpportunityScopeWhere(context), { archivedAt: null, stage: { in: OPEN_STAGES } }],
        },
        select: { stage: true, currency: true, estimatedValue: true, probabilityOverride: true },
      });

      const totals = currencyTotals(rows);
      if (totals.length === 0) return formatCurrency(0);

      const [largest, ...rest] = totals;
      const headline = formatCurrency(Number.parseFloat(largest.value), largest.currency);
      return rest.length === 0 ? headline : `${headline} +${rest.length}`;
    }

    case "openOpportunityCount":
      return String(
        await prisma.opportunity.count({
          where: {
            AND: [
              buildOpportunityScopeWhere(context),
              { archivedAt: null, stage: { in: OPEN_STAGES } },
            ],
          },
        }),
      );

    case "activeContracts":
      return String(
        await prisma.contract.count({
          where: { AND: [buildContractScopeWhere(context), { status: "ACTIVE", archivedAt: null }] },
        }),
      );

    case "expiringContractCount":
      // "Expiring" is ACTIVE plus a horizon, derived from today rather than
      // stored — there is no EXPIRING status to count (PRD #18 §75, §193).
      return String(await countExpiringContracts(context));

    case "openRequests":
      return String(
        await prisma.purchaseRequest.count({
          where: {
            ...buildProjectLinkedScopeWhere(context, "procurement"),
            status: {
              in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "IN_SOURCING", "PARTIALLY_ORDERED"],
            },
          },
        }),
      );

    case "openOrders":
      return String(
        await prisma.purchaseOrder.count({
          where: {
            ...buildProjectLinkedScopeWhere(context, "procurement"),
            status: {
              in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "PARTIALLY_RECEIVED"],
            },
          },
        }),
      );

    case "stockValue": {
      /*
       * V0.1 does not value stock (PRD #20 §186). There is no costing method,
       * so a currency figure here would be a number nobody could defend. What
       * the tile reports instead is how many distinct items are actually held.
       */
      const held = await prisma.inventoryBalance.groupBy({
        by: ["inventoryItemId"],
        // Stock is scoped by where it sits (PRD #20 §246).
        where: { AND: [buildBalanceScopeWhere(context), { companyId: context.companyId, onHandQuantity: { gt: 0 } }] },
      });
      return String(held.length);
    }

    case "lowStockCount":
      return String(await countLowStock(context));

    // An inspection that nobody has finished, whatever stage it is at
    // (PRD #21 §31). A closed one is not an open item, and a cancelled one
    // never was.
    case "openQualityCount":
      return String(
        await prisma.qualityInspection.count({
          where: {
            ...buildProjectLinkedScopeWhere(context, "qaqc"),
            status: { in: ["DRAFT", "IN_PROGRESS", "PENDING_APPROVAL", "REJECTED"] },
          },
        }),
      );

    case "openNcrCount":
      return String(
        await prisma.nonConformanceReport.count({
          where: {
            ...buildProjectLinkedScopeWhere(context, "qaqc"),
            status: {
              in: [
                "OPEN",
                "IN_PROGRESS",
                "PENDING_VERIFICATION",
                "PENDING_APPROVAL",
                "APPROVED_FOR_CLOSE",
                "REOPENED",
              ],
            },
          },
        }),
      );

    case "openIncidentCount":
      return String(
        await prisma.hseIncident.count({
          where: {
            ...buildIncidentScopeWhere(context),
            status: { in: OPEN_INCIDENT_STATUSES },
          },
        }),
      );

    case "openHazardCount":
      return String(
        await prisma.hseHazard.count({
          where: {
            ...buildHazardScopeWhere(context),
            status: { in: OPEN_HAZARD_STATUSES },
          },
        }),
      );

    /*
     * Counted by the window it authorises, not by the column (PRD #22 §151).
     * A permit whose validity ran out last night is not an active permit, and a
     * dashboard that says it is tells somebody they may still start hot work.
     */
    case "openPermitCount":
      return String(
        await prisma.hseWorkPermit.count({
          where: {
            ...buildPermitScopeWhere(context),
            status: "ACTIVE",
            validUntil: { gte: new Date() },
          },
        }),
      );

    case "teamSize":
      return String(
        await prisma.companyMember.count({
          where: { AND: [buildTeamScopeWhere(context), { status: "ACTIVE" }] },
        }),
      );

    case "enabledModuleCount":
      return String(context.enabledModules.length);

    case "openSupportCount":
      // Support requests have no narrower scope than the company; the list's
      // own door is the module and the request grant.
      if (!supportOpen(context)) return "—";
      return String(
        await prisma.supportRequest.count({
          where: { companyId: context.companyId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        }),
      );

    default:
      return "—";
  }
}

/* -------------------------------------------------------------------------- */
/* Widgets                                                                     */
/* -------------------------------------------------------------------------- */

async function loadWidget(context: UserContext, key: string): Promise<WidgetPayload> {
  switch (key) {
    // The group, one company at a time (E-06 §108-§111).
    case "groupCompanies":
      return { kind: "list", items: await groupCompanies(context) };

    case "groupFinance":
      return { kind: "list", items: await groupFinance(context) };

    case "groupPipeline":
      return { kind: "list", items: await groupPipeline(context) };

    // What the Group workspace adds to the executive view (Workspace Context §19, §33, §71).
    case "groupAttention":
      return { kind: "alerts", items: await groupAttention(context, loadAlerts) };
    case "groupApprovals":
      return { kind: "list", items: await groupApprovals(context) };
    case "groupTasks":
      return { kind: "list", items: await groupTasks(context) };

    // The group's executive view (D-01 §30-§36).
    case "keyProjects":
      return { kind: "projects", items: await groupKeyProjects(context) };
    case "portfolioStatus":
      return { kind: "breakdown", items: await groupPortfolioByStatus(context) };
    case "projectTypes":
      return { kind: "breakdown", items: await groupProjectTypes(context) };
    case "groupDepartments":
      return { kind: "breakdown", items: await groupDepartments(context) };
    case "groupMilestones":
      return { kind: "list", items: await groupMilestones(context) };
    case "groupActivity":
      return { kind: "activity", items: await groupActivity(context) };

    case "attention":
      return { kind: "alerts", items: await loadAlerts(context) };

    case "pendingApprovals":
      return { kind: "approvals", items: await loadApprovals(context) };

    case "approvalBottlenecks": {
      const { listApprovals } = await import("@/lib/modules/approvals/approvals.service");
      const { approvalQuerySchema } = await import("@/lib/modules/approvals/approvals.schema");
      const result = await listApprovals(context, approvalQuerySchema.parse({ tab: "history", status: "PENDING", sort: "oldest", limit: 100 }));
      const now = Date.now();
      const bySource = new Map<string, { label: string; count: number; oldest: number; overdue: number }>();
      for (const item of result.items) {
        const entry = bySource.get(item.providerKey) ?? { label: result.providers.find((provider) => provider.key === item.providerKey)?.label ?? item.sourceLabel, count: 0, oldest: 0, overdue: 0 };
        entry.count += 1;
        entry.oldest = Math.max(entry.oldest, Math.floor((now - new Date(item.requestedAt).getTime()) / 86_400_000));
        if (item.dueState === "overdue") entry.overdue += 1;
        bySource.set(item.providerKey, entry);
      }
      return {
        kind: "breakdown",
        items: [...bySource.entries()]
          .sort((a, b) => b[1].oldest - a[1].oldest)
          .map(([key, entry]) => ({
            label: entry.label,
            value: entry.count,
            display: `${entry.count}${result.nextCursor ? "+" : ""} waiting · oldest ${entry.oldest} ${entry.oldest === 1 ? "day" : "days"}${entry.overdue ? ` · ${entry.overdue} overdue` : ""}`,
            status: entry.overdue > 0 ? "OVERDUE" : undefined,
            href: `/approvals?tab=history&status=PENDING&provider=${key}&sort=oldest`,
          })),
      };
    }

    case "recentActivity":
      // Row by row, only what the reader could open (PRD #47 §59, §175).
      return { kind: "activity", items: await loadRecentActivity(context) };

    case "myProjects": {
      const rows = await prisma.project.findMany({
        where: {
          companyId: context.companyId,
          archivedAt: null,
          OR: [
            { projectManagerMemberId: context.membershipId },
            { members: { some: { companyMemberId: context.membershipId, status: "ACTIVE" } } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { id: true, name: true, code: true, status: true, client: { select: { name: true } } },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: row.client?.name ?? row.code,
          status: row.status,
          href: `/projects/${row.id}`,
        })),
      };
    }

    case "activeProjects": {
      const scope = buildProjectScopeWhere(context);
      const statuses = ["ACTIVE", "PENDING", "FINISHED"] as const;
      const counts = await Promise.all(
        statuses.map((status) =>
          prisma.project.count({ where: { AND: [scope, { status, archivedAt: null }] } }),
        ),
      );

      return {
        kind: "breakdown",
        items: statuses.map((status, index) => ({
          label: status,
          status,
          value: counts[index],
          href: `/projects?status=${status}`,
        })),
      };
    }

    case "upcomingMeetings": {
      // The meetings module's own list, so a widget never shows a meeting its list would hide (PRD #40 §201).
      const { listMeetings } = await import("@/lib/modules/meetings/meeting.service");
      const { meetingListQuerySchema } = await import("@/lib/modules/meetings/meeting.schema");
      const result = await listMeetings(context, meetingListQuerySchema.parse({ section: "mine", limit: 5 }));
      return {
        kind: "list",
        items: result.data.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: [
            new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: row.timezone }).format(new Date(row.startsAt)),
            row.project?.name,
          ]
            .filter(Boolean)
            .join(" · "),
          meta: row.myResponse === "PENDING" ? "Reply needed" : row.locationText ?? undefined,
          status: row.status === "SCHEDULED" ? undefined : row.status,
          href: row.href,
        })),
      };
    }

    case "myMeetingActions": {
      const { listActionItems } = await import("@/lib/modules/meetings/meeting.actions");
      const { actionListQuerySchema } = await import("@/lib/modules/meetings/meeting.schema");
      const result = await listActionItems(context, actionListQuerySchema.parse({ limit: 5 }));
      return {
        kind: "list",
        items: result.data.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: row.meeting.title,
          meta: row.dueDate ? (row.overdue ? `Overdue · ${row.dueDate}` : `Due ${row.dueDate}`) : undefined,
          status: row.status === "OPEN" ? undefined : row.status,
          href: row.meeting.href,
        })),
      };
    }

    case "myTimesheet": {
      // The member's own weeks, read the way the timesheet screen reads them (PRD #42 §183).
      const { myRecentWeeks } = await import("@/lib/modules/timesheets/timesheet.service");
      const weeks = await myRecentWeeks(context, 3);
      return {
        kind: "list",
        items: weeks.map((week, index) => ({
          id: week.periodStart,
          title: index === 0 ? `This week · ${week.label}` : week.label,
          subtitle: week.expectedMinutes > 0 ? `${week.totalLabel} of ${week.expectedLabel} logged` : `${week.totalLabel} logged`,
          status: week.status === "DRAFT" && index === 0 ? undefined : week.status,
          href: week.href,
        })),
      };
    }

    case "siteToday": {
      // Each active project's latest site record, read through the log's own access (PRD #43 §201, §202).
      const { siteToday } = await import("@/lib/modules/daily-logs/daily-log.reports");
      const { dateLabel } = await import("@/lib/modules/daily-logs/daily-log.time");
      const items = await siteToday(context, 5);
      return {
        kind: "list",
        items: items.map((item) => ({
          id: item.projectId,
          title: item.projectName,
          subtitle: item.logId ? `${dateLabel(item.date)} · ${item.workforce} on site · ${item.activities} activities${item.delays ? ` · ${item.delays} ${item.delays === 1 ? "delay" : "delays"}` : ""}` : "No log yet",
          meta: item.photos ? `${item.photos} photos` : undefined,
          status: item.status ?? undefined,
          href: item.href,
        })),
      };
    }

    case "announcements": {
      // Audience-safe at the query; critical and pinned first (PRD #45 §65, §66, §118).
      const { dashboardAnnouncements } = await import("@/lib/modules/announcements/announcement.service");
      const { PRIORITY_LABELS } = await import("@/lib/modules/announcements/announcement.types");
      const items = await dashboardAnnouncements(context, 5);
      return {
        kind: "list",
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: [item.audience.label, item.requiresAcknowledgment && !item.acknowledgedAt ? "Acknowledgment required" : !item.read ? "Unread" : null].filter(Boolean).join(" · "),
          meta: item.priority === "NORMAL" ? (item.pinned ? "Pinned" : undefined) : PRIORITY_LABELS[item.priority],
          status: item.priority === "CRITICAL" ? "CRITICAL" : undefined,
          href: item.href,
        })),
      };
    }

    case "favorites": {
      // Re-resolved in the reader's context every time: a favorite never opens a door (PRD #45 §70, §86).
      const { listFavorites } = await import("@/lib/modules/productivity/favorites.service");
      const items = await listFavorites(context, { limit: 8 });
      return { kind: "list", items: items.map((item) => ({ id: `${item.entityType}:${item.entityId}`, title: item.title, subtitle: item.subtitle, href: item.href })) };
    }

    case "recentWork": {
      const { listRecentWork } = await import("@/lib/modules/productivity/recent-work.service");
      const items = await listRecentWork(context, { limit: 8 });
      return { kind: "list", items: items.map((item) => ({ id: `${item.entityType}:${item.entityId}`, title: item.title, subtitle: item.subtitle, meta: relativeTime(item.lastAccessedAt), href: item.href })) };
    }

    case "rfisAssignedToMe": {
      // RFIs waiting for this reader's answer, through the RFI door (PRD #46 §278).
      const { rfisAssignedToMeWidget } = await import("@/lib/modules/engineering/engineering.overview");
      return { kind: "list", items: await rfisAssignedToMeWidget(context, 6) };
    }

    case "reviewsAwaitingMe": {
      const { reviewsAwaitingMeWidget } = await import("@/lib/modules/engineering/engineering.overview");
      return { kind: "list", items: await reviewsAwaitingMeWidget(context, 6) };
    }

    case "engineeringBottlenecks": {
      // Late answers and late reviews across the reader's projects (PRD #46 §277).
      const { engineeringBottlenecksWidget } = await import("@/lib/modules/engineering/engineering.overview");
      return { kind: "list", items: await engineeringBottlenecksWidget(context, 6) };
    }

    case "contractorCompliance": {
      const { contractorComplianceWidget } = await import("@/lib/modules/engineering/engineering.overview");
      return { kind: "list", items: await contractorComplianceWidget(context, 6) };
    }

    case "upcomingMilestones": {
      // Key dates on the reader's projects, read through the plan's own door (PRD #44 §169).
      const { upcomingMilestones } = await import("@/lib/modules/project-planning/planning.reports");
      const { dateLabel, varianceLabel } = await import("@/lib/modules/project-planning/planning.dates");
      const rows = await upcomingMilestones(context, 6);
      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: `${row.projectName} · ${row.delayed ? `${row.overdueDays} ${row.overdueDays === 1 ? "day" : "days"} late` : dateLabel(row.displayDate)}`,
          meta: row.varianceDays ? varianceLabel(row.varianceDays) : undefined,
          status: row.delayed ? "DELAYED" : row.status,
          href: row.href,
        })),
      };
    }

    case "criticalMilestones": {
      // Critical milestones across projects that are late, at risk or critically blocked (PRD #44 §168, §170).
      const { criticalMilestones } = await import("@/lib/modules/project-planning/planning.reports");
      const { dateLabel, varianceLabel } = await import("@/lib/modules/project-planning/planning.dates");
      const rows = await criticalMilestones(context, 6);
      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: [row.projectName, row.delayed ? `${row.overdueDays} ${row.overdueDays === 1 ? "day" : "days"} late` : `Forecast ${dateLabel(row.displayDate)}`, row.blocked ? "Critical blocker" : null].filter(Boolean).join(" · "),
          meta: row.varianceDays ? varianceLabel(row.varianceDays) : undefined,
          status: row.delayed ? "DELAYED" : row.status,
          href: row.href,
        })),
      };
    }

    case "upcomingDeadlines": {
      const rows = await prisma.project.findMany({
        where: {
          AND: [
            buildProjectScopeWhere(context),
            {
              archivedAt: null,
              endDate: { gte: new Date() },
              status: { notIn: ["FINISHED", "ARCHIVED"] },
            },
          ],
        },
        orderBy: { endDate: "asc" },
        take: 5,
        select: { id: true, name: true, code: true, endDate: true, status: true },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: row.code,
          meta: row.endDate ? formatRelativeTime(row.endDate) : undefined,
          status: row.status,
          href: `/projects/${row.id}`,
        })),
      };
    }

    case "openTasks": {
      const rows = await prisma.task.findMany({
        where: {
          AND: [
            buildTaskScopeWhere(context),
            { archivedAt: null, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
          ],
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
        take: 6,
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          project: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: row.project?.name ?? "Personal task",
          meta: row.dueDate ? formatRelativeTime(row.dueDate) : undefined,
          status: row.status,
          href: `/tasks/${row.id}`,
        })),
      };
    }

    case "taskBreakdown": {
      const scope = buildTaskScopeWhere(context);
      const statuses = ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const;
      const counts = await Promise.all(
        statuses.map((status) =>
          prisma.task.count({ where: { AND: [scope, { status, archivedAt: null }] } }),
        ),
      );

      return {
        kind: "breakdown",
        items: statuses.map((status, index) => ({
          label: status,
          status,
          value: counts[index],
          href: `/tasks/all?status=${status}`,
        })),
      };
    }

    case "financeSummary": {
      const statuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"] as const;
      const counts = await Promise.all(
        statuses.map((status) =>
          prisma.invoice.count({
            where: { AND: [buildInvoiceScopeWhere(context), { status }] },
          }),
        ),
      );

      return {
        kind: "breakdown",
        items: statuses.map((status, index) => ({
          label: status,
          status,
          value: counts[index],
          href: `/finance/invoices?status=${status}`,
        })),
      };
    }

    case "overdueInvoices": {
      // Overdue is derived, not stored: a sent invoice past its due date with
      // something still owing (PRD #15 §44).
      const rows = await prisma.invoice.findMany({
        where: {
          AND: [
            buildInvoiceScopeWhere(context),
            { status: "SENT", dueDate: { lt: new Date() } },
          ],
        },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: {
          id: true,
          invoiceNumber: true,
          currency: true,
          totalAmount: true,
          dueDate: true,
          client: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: `${row.invoiceNumber} · ${row.client.name}`,
          subtitle: formatKpi({ amount: row.totalAmount, currency: row.currency }),
          meta: row.dueDate ? formatRelativeTime(row.dueDate) : undefined,
          status: "OVERDUE",
          href: `/finance/invoices/${row.id}`,
        })),
      };
    }

    case "projectBudgets": {
      /*
       * Invoiced value is invoice data. A reader who holds the project budget
       * grant but not `finance.invoice.view` — the Project Manager — sees each
       * project's approved budget instead, never what was billed on it
       * (PRD #15 §210, PRD #47 §59).
       */
      if (!can(context, "finance.invoice.view")) {
        return { kind: "list", items: await projectBudgetItems(context, 6) };
      }

      const { currency: projectCurrency, rows: grouped } =
        await financeKpis.invoicedByProject(context);

      const projectIds = grouped
        .map((row) => row.projectId)
        .filter((id): id is string => id !== null);

      const projects = await prisma.project.findMany({
        where: { AND: [buildProjectScopeWhere(context), { id: { in: projectIds } }] },
        select: { id: true, name: true, code: true, status: true },
      });

      const byId = new Map(projects.map((project) => [project.id, project]));

      return {
        kind: "list",
        items: grouped
          .filter((row) => row.projectId && byId.has(row.projectId))
          .slice(0, 6)
          .map((row) => {
            const project = byId.get(row.projectId!)!;
            return {
              id: project.id,
              title: project.name,
              subtitle: project.code,
              meta: formatKpi({
                amount: row._sum.totalAmount ?? new Prisma.Decimal(0),
                currency: projectCurrency,
              }),
              status: project.status,
              href: `/projects/${project.id}`,
            };
          }),
      };
    }

    case "leaveRequests": {
      const rows = await prisma.leaveRequest.findMany({
        // The HR module's own scope resolver, so a dashboard widget can never
        // show leave the HR pages would hide (PRD #16 §164).
        where: buildLeaveScopeWhere(context),
        orderBy: [{ status: "asc" }, { startDate: "asc" }],
        take: 6,
        select: {
          id: true,
          leaveType: true,
          days: true,
          status: true,
          startDate: true,
          employeeProfile: { select: { personProfile: PERSON_NAME_SELECT } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => {
          return {
            id: row.id,
            title: personName(row.employeeProfile.personProfile),
            subtitle: `${leaveTypeLabels[row.leaveType]} · ${row.days.toFixed(2)} days`,
            meta: formatRelativeTime(row.startDate),
            status: row.status,
            href: `/hr/leave/${row.id}`,
          };
        }),
      };
    }

    case "workforce": {
      const grouped = await prisma.companyMember.groupBy({
        by: ["departmentId"],
        where: { AND: [buildHrMemberScopeWhere(context), { status: "ACTIVE" }] },
        _count: { _all: true },
      });

      const departments = await prisma.department.findMany({
        where: { companyId: context.companyId },
        select: { id: true, name: true },
      });
      const byId = new Map(departments.map((department) => [department.id, department.name]));

      return {
        kind: "breakdown",
        items: grouped
          .map((row) => ({
            label: row.departmentId ? (byId.get(row.departmentId) ?? "Unassigned") : "Unassigned",
            value: row._count._all,
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8),
      };
    }

    case "salesPipeline": {
      const rows = await prisma.opportunity.findMany({
        where: {
          AND: [buildOpportunityScopeWhere(context), { archivedAt: null, stage: { in: OPEN_STAGES } }],
        },
        select: { stage: true, currency: true, estimatedValue: true, probabilityOverride: true },
      });

      return {
        kind: "breakdown",
        items: OPEN_STAGES.map((stage) => {
          const stageRows = rows.filter((row) => row.stage === stage);
          const [largest] = currencyTotals(stageRows);

          return {
            label: opportunityStageLabels[stage],
            status: stage,
            value: stageRows.length,
            display: largest
              ? formatCurrency(Number.parseFloat(largest.value), largest.currency)
              : undefined,
            href: `/sales/opportunities?stage=${stage}`,
          };
        }).filter((item) => item.value > 0),
      };
    }

    case "openOpportunities": {
      const rows = await prisma.opportunity.findMany({
        where: {
          AND: [buildOpportunityScopeWhere(context), { archivedAt: null, stage: { in: OPEN_STAGES } }],
        },
        orderBy: { estimatedValue: "desc" },
        take: 6,
        select: {
          id: true,
          name: true,
          stage: true,
          estimatedValue: true,
          currency: true,
          client: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: row.client?.name ?? undefined,
          meta: formatCurrency(decimalToNumber(row.estimatedValue), row.currency),
          status: row.stage,
          href: `/sales/opportunities/${row.id}`,
        })),
      };
    }

    case "contracts": {
      const grouped = await prisma.contract.groupBy({
        by: ["status"],
        where: { AND: [buildContractScopeWhere(context), { archivedAt: null }] },
        _count: { _all: true },
      });

      return {
        kind: "breakdown",
        items: grouped.map((row) => ({
          label: row.status,
          status: row.status,
          value: row._count._all,
          href: `/contracts/all?status=${row.status}`,
        })),
      };
    }

    case "expiringContracts": {
      const rows = await prisma.contract.findMany({
        where: {
          AND: [
            buildContractScopeWhere(context),
            {
              archivedAt: null,
              status: "ACTIVE",
              expiryDate: { gte: new Date(), lte: expiryHorizon() },
            },
          ],
        },
        orderBy: { expiryDate: "asc" },
        take: 5,
        select: {
          id: true,
          contractNumber: true,
          title: true,
          status: true,
          expiryDate: true,
          client: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: `${row.contractNumber} · ${row.client?.name ?? "No client"}`,
          meta: row.expiryDate ? formatRelativeTime(row.expiryDate) : undefined,
          status: row.status,
          href: `/contracts/${row.id}`,
        })),
      };
    }

    case "purchaseRequests": {
      const grouped = await prisma.purchaseRequest.groupBy({
        by: ["status"],
        where: buildProjectLinkedScopeWhere(context, "procurement"),
        _count: { _all: true },
      });

      return {
        kind: "breakdown",
        items: grouped.map((row) => ({
          label: row.status,
          status: row.status,
          value: row._count._all,
          href: `/procurement/requests?status=${row.status}`,
        })),
      };
    }

    case "purchaseOrders": {
      const rows = await prisma.purchaseOrder.findMany({
        where: buildProjectLinkedScopeWhere(context, "procurement"),
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          poNumber: true,
          totalAmount: true,
          status: true,
          supplier: { select: { name: true } },
          project: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: `${row.poNumber} · ${row.supplier.name}`,
          subtitle: row.project?.name ?? "No project",
          meta: formatCurrency(decimalToNumber(row.totalAmount)),
          status: row.status,
          href: `/procurement/orders/${row.id}`,
        })),
      };
    }

    case "lowStock": {
      const rows = await lowStockItems(context, 6);

      // Quantities are a separate grant from the catalogue (PRD #20 §31).
      const figures = canSeeStockFigures(context);

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: row.sku,
          meta: figures ? `${row.onHand} ${row.baseUnit} on hand · reorder at ${row.reorder}` : "At or below reorder level",
          status: row.onHand === 0 ? "BLOCKED" : "PENDING",
          href: `/inventory/items/${row.id}`,
        })),
      };
    }

    case "recentMovements": {
      const rows = await prisma.stockMovement.findMany({
        where: { AND: [buildMovementScopeWhere(context), { companyId: context.companyId }] },
        orderBy: { occurredAt: "desc" },
        take: 6,
        select: {
          id: true,
          movementType: true,
          signedQuantity: true,
          unit: true,
          occurredAt: true,
          inventoryItem: { select: { name: true } },
          warehouse: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => {
          const signed = decimalToNumber(row.signedQuantity);
          return {
            id: row.id,
            title: row.inventoryItem.name,
            // The sign is the whole point of a ledger row: "+40" and "−40" are
            // different events (PRD #20 §71).
            subtitle: `${signed > 0 ? "+" : ""}${signed} ${row.unit} · ${row.warehouse.name}`,
            meta: formatRelativeTime(row.occurredAt),
            href: "/inventory/movements",
          };
        }),
      };
    }

    case "qualityRecords": {
      /*
       * Four different kinds of quality work, counted separately (PRD #21 §3).
       * They are deliberately not summed into one "quality items" figure: an
       * open NCR and an open inspection are not comparable units of anything.
       */
      const scope = buildProjectLinkedScopeWhere(context, "qaqc");

      const [inspections, defects, ncrs, actions] = await Promise.all([
        prisma.qualityInspection.count({
          where: { ...scope, status: { in: ["DRAFT", "IN_PROGRESS", "PENDING_APPROVAL"] } },
        }),
        prisma.qualityDefect.count({
          where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS", "REOPENED"] } },
        }),
        prisma.nonConformanceReport.count({
          where: {
            ...scope,
            status: {
              in: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "PENDING_APPROVAL", "REOPENED"],
            },
          },
        }),
        prisma.correctiveAction.count({
          where: {
            ...scope,
            status: { in: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"] },
          },
        }),
      ]);

      return {
        kind: "breakdown",
        items: [
          { label: "Inspections", status: "IN_PROGRESS", value: inspections },
          { label: "Defects", status: "OPEN", value: defects },
          { label: "NCRs", status: "PENDING", value: ncrs },
          { label: "Corrective actions", status: "IN_PROGRESS", value: actions },
        ].filter((row) => row.value > 0),
      };
    }

    case "openNcrs": {
      const rows = await prisma.nonConformanceReport.findMany({
        where: {
          ...buildProjectLinkedScopeWhere(context, "qaqc"),
          status: {
            in: [
              "OPEN",
              "IN_PROGRESS",
              "PENDING_VERIFICATION",
              "PENDING_APPROVAL",
              "APPROVED_FOR_CLOSE",
              "REOPENED",
            ],
          },
        },
        orderBy: [{ severity: "desc" }, { dueDate: "asc" }],
        take: 5,
        select: {
          id: true,
          ncrNumber: true,
          title: true,
          status: true,
          severity: true,
          project: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: `${row.ncrNumber} · ${row.project?.name ?? "No project"}`,
          meta: row.severity,
          status: row.status,
          href: `/qaqc/ncrs/${row.id}`,
        })),
      };
    }

    case "hseHazardsByRisk": {
      const grouped = await prisma.hseHazard.groupBy({
        by: ["riskLevel"],
        where: {
          ...buildHazardScopeWhere(context),
          status: { in: OPEN_HAZARD_STATUSES },
        },
        _count: { _all: true },
      });

      // Critical first: the order a safety manager reads them in.
      const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
      return {
        kind: "breakdown",
        items: grouped
          .slice()
          .sort((a, b) => order.indexOf(a.riskLevel) - order.indexOf(b.riskLevel))
          .map((row) => ({
            label: riskLevelLabels[row.riskLevel],
            status: row.riskLevel,
            value: row._count._all,
          })),
      };
    }

    case "openIncidents": {
      const rows = await prisma.hseIncident.findMany({
        where: {
          ...buildIncidentScopeWhere(context),
          status: { in: OPEN_INCIDENT_STATUSES },
        },
        orderBy: [{ severity: "desc" }, { occurredAt: "desc" }],
        take: 5,
        select: {
          id: true,
          incidentNumber: true,
          title: true,
          status: true,
          severity: true,
          project: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: `${row.incidentNumber} · ${row.project?.name ?? "No project"}`,
          meta: row.severity ?? undefined,
          status: row.status,
          href: `/hse/incidents/${row.id}`,
        })),
      };
    }

    case "teamDirectory": {
      // The directory's own scope, so the widget never lists somebody the Team page would not (PRD #14 §145).
      const rows = await prisma.companyMember.findMany({
        where: { AND: [buildTeamScopeWhere(context), { status: "ACTIVE" }] },
        orderBy: { user: { firstName: "asc" } },
        take: 6,
        select: {
          id: true,
          jobTitle: true,
          user: { select: { firstName: true, lastName: true } },
          department: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: `${row.user.firstName} ${row.user.lastName}`,
          subtitle: row.jobTitle ?? undefined,
          meta: row.department?.name ?? undefined,
          person: { memberId: row.id },
        })),
      };
    }

    case "userDirectory": {
      const grouped = await prisma.companyMember.groupBy({
        by: ["roleId"],
        where: { AND: [buildTeamScopeWhere(context), { status: "ACTIVE" }] },
        _count: { _all: true },
      });

      const roleRows = await prisma.role.findMany({ select: { id: true, name: true } });
      const byId = new Map(roleRows.map((role) => [role.id, role.name]));

      return {
        kind: "breakdown",
        items: grouped
          .map((row) => ({ label: byId.get(row.roleId) ?? "Unknown", value: row._count._all }))
          .sort((a, b) => b.value - a.value),
      };
    }

    case "companyModules": {
      const rows = await prisma.companyModule.findMany({
        where: { companyId: context.companyId },
        select: { enabled: true, module: { select: { name: true, key: true } } },
        orderBy: { module: { name: "asc" } },
      });

      return {
        kind: "breakdown",
        items: rows.map((row) => ({
          label: row.module.name,
          value: row.enabled ? 1 : 0,
          display: row.enabled ? "Enabled" : "Off",
          status: row.enabled ? "ACTIVE" : "INACTIVE",
        })),
      };
    }

    case "recentDocuments": {
      const rows = await prisma.document.findMany({
        where: { AND: [await buildDocumentAccessWhere(context), { status: "ACTIVE" }] },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          name: true,
          createdAt: true,
          project: { select: { name: true } },
          client: { select: { name: true } },
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: row.project?.name ?? row.client?.name ?? "Company document",
          meta: formatRelativeTime(row.createdAt),
          href: `/documents/${row.id}`,
        })),
      };
    }

    case "supportRequests": {
      if (!supportOpen(context)) return { kind: "list", items: [] };
      const rows = await prisma.supportRequest.findMany({
        where: { companyId: context.companyId },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 6,
        select: {
          id: true,
          reference: true,
          subject: true,
          status: true,
          createdAt: true,
        },
      });

      return {
        kind: "list",
        items: rows.map((row) => ({
          id: row.id,
          title: row.subject,
          subtitle: row.reference,
          meta: formatRelativeTime(row.createdAt),
          status: row.status,
          href: `/support/requests/${row.id}`,
        })),
      };
    }

    default:
      return { kind: "list", items: [] };
  }
}

/* -------------------------------------------------------------------------- */
/* Attention and approvals                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The attention area (PRD #4 §15, §63).
 *
 * Only what is relevant to this user, and only through permissions they hold.
 * Low-value noise is deliberately excluded.
 */
async function loadAlerts(context: UserContext): Promise<WidgetAlert[]> {
  /*
   * This person's own attention items first (PRD #38 §86): specific records
   * waiting on them, each link resolved against their access now. The counts
   * below stay as the company-wide picture their permissions allow.
   */
  const alerts: WidgetAlert[] = (await listReadableAttention(context, 5)).map((item) => ({
    id: `attention-${item.id}`,
    priority: item.priority === "CRITICAL" ? "CRITICAL" : item.priority === "HIGH" ? "WARNING" : "INFO",
    title: item.title,
    detail: item.body ?? "Waiting on you.",
    href: item.href,
  }));

  if (can(context, "task.view")) {
    const overdue = await prisma.task.count({
      where: {
        AND: [
          buildTaskScopeWhere(context),
          {
            archivedAt: null,
            status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
            dueDate: { lt: new Date() },
          },
        ],
      },
    });

    if (overdue > 0) {
      alerts.push({
        id: "tasks-overdue",
        priority: "WARNING",
        title: `${overdue} overdue task${overdue === 1 ? "" : "s"}`,
        detail: "Past their due date and not yet complete.",
        href: "/tasks/overdue",
      });
    }

    const blocked = await prisma.task.count({
      where: { AND: [buildTaskScopeWhere(context), { archivedAt: null, status: "BLOCKED" }] },
    });

    if (blocked > 0) {
      alerts.push({
        id: "tasks-blocked",
        priority: "WARNING",
        title: `${blocked} blocked task${blocked === 1 ? "" : "s"}`,
        detail: "Waiting on something before work can continue.",
        href: "/tasks/all?status=BLOCKED",
      });
    }
  }

  if (can(context, "project.view")) {
    const atRisk = await countProjectsAtRisk(context);
    if (atRisk > 0) {
      alerts.push({
        id: "projects-at-risk",
        priority: "CRITICAL",
        title: `${atRisk} project${atRisk === 1 ? "" : "s"} at risk`,
        detail: "Past the planned end date, or carrying a critical blocked task.",
        href: "/projects",
      });
    }
  }

  if (can(context, "finance.invoice.view")) {
    const overdue = await financeKpis.overdueReceivablesKpi(context);
    if (overdue.amount.greaterThan(0)) {
      alerts.push({
        id: "invoices-overdue",
        priority: "CRITICAL",
        title: `${formatKpi(overdue)} overdue`,
        detail: "Invoices past their due date with money still outstanding.",
        href: "/finance/invoices?settlement=OVERDUE",
      });
    }
  }

  /*
   * An active stop-work outranks everything else on the dashboard (PRD #22
   * §361). It means people have been sent off a job right now, and it is the
   * one safety state that must not be something you scroll to find.
   */
  if (can(context, "hse.stop_work.view")) {
    const stopped = await prisma.stopWorkRecord.count({
      where: { ...buildStopWorkScopeWhere(context), status: "ACTIVE" },
    });

    if (stopped > 0) {
      alerts.push({
        id: "hse-stop-work",
        priority: "CRITICAL",
        title: `${stopped} stop-work${stopped === 1 ? "" : "s"} in force`,
        detail: "Work is halted until somebody releases it.",
        href: "/hse/stop-work",
      });
    }
  }

  if (can(context, "hse.hazard.view")) {
    const critical = await prisma.hseHazard.count({
      where: {
        ...buildHazardScopeWhere(context),
        riskLevel: "CRITICAL",
        status: { in: OPEN_HAZARD_STATUSES },
      },
    });

    if (critical > 0) {
      alerts.push({
        id: "hse-critical-hazard",
        priority: "CRITICAL",
        title: `${critical} critical hazard${critical === 1 ? "" : "s"} open`,
        detail: "Scored 17 or higher on the risk matrix and not yet closed.",
        href: "/hse/hazards?riskLevel=CRITICAL",
      });
    }
  }

  if (can(context, "hse.incident.view")) {
    const serious = await prisma.hseIncident.count({
      where: {
        ...buildIncidentScopeWhere(context),
        severity: { in: ["HIGH", "CRITICAL"] },
        status: { in: OPEN_INCIDENT_STATUSES },
      },
    });

    if (serious > 0) {
      alerts.push({
        id: "hse-serious-incident",
        priority: "CRITICAL",
        title: `${serious} serious incident${serious === 1 ? "" : "s"} open`,
        detail: "High or critical severity, not yet closed.",
        href: "/hse/incidents",
      });
    }
  }

  if (can(context, "qaqc.ncr.view")) {
    const ncrs = await prisma.nonConformanceReport.count({
      where: {
        ...buildProjectLinkedScopeWhere(context, "qaqc"),
        status: {
          in: [
            "OPEN",
            "IN_PROGRESS",
            "PENDING_VERIFICATION",
            "PENDING_APPROVAL",
            "APPROVED_FOR_CLOSE",
            "REOPENED",
          ],
        },
      },
    });

    if (ncrs > 0) {
      alerts.push({
        id: "qaqc-ncrs",
        priority: "WARNING",
        title: `${ncrs} open NCR${ncrs === 1 ? "" : "s"}`,
        detail: "Non-conformances still to be closed out.",
        href: "/qaqc/ncrs",
      });
    }
  }

  if (can(context, "legal.contract.view")) {
    const expiring = await countExpiringContracts(context);

    if (expiring > 0) {
      alerts.push({
        id: "contracts-expiring",
        priority: "WARNING",
        title: `${expiring} contract${expiring === 1 ? "" : "s"} expiring`,
        detail: "Ending soon and not yet renewed.",
        href: "/contracts/expiring",
      });
    }
  }

  if (can(context, "inventory.item.view")) {
    const low = await countLowStock(context);
    if (low > 0) {
      alerts.push({
        id: "inventory-low",
        priority: "INFO",
        title: `${low} item${low === 1 ? "" : "s"} at or below reorder level`,
        detail: "Replenishment needed before site runs short.",
        href: "/inventory/low-stock",
      });
    }
  }

  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  return alerts.sort((a, b) => order[a.priority] - order[b.priority]);
}

/**
 * Pending approvals, gathered only from the modules where this user actually
 * holds the approve permission (PRD #4 §64).
 */
async function loadApprovals(context: UserContext): Promise<WidgetApproval[]> {
  // The Approvals Center's own queue, so the widget never offers a decision
  // the Center would withhold (PRD #41 §97).
  const { listApprovals } = await import("@/lib/modules/approvals/approvals.service");
  const { approvalQuerySchema } = await import("@/lib/modules/approvals/approvals.schema");
  const { DUE_STATE_LABELS } = await import("@/lib/modules/approvals/approvals.types");
  const result = await listApprovals(context, approvalQuerySchema.parse({ tab: "waiting", limit: 5 }));
  return result.items.map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: [
      item.sourceLabel,
      item.amount ? formatKpi({ amount: new Prisma.Decimal(item.amount.value), currency: item.amount.currency }) : null,
      item.dueState === "overdue" || item.dueState === "due_today" ? DUE_STATE_LABELS[item.dueState] : null,
      item.totalSteps ? `Step ${item.currentStep} of ${item.totalSteps}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/approvals?approval=${encodeURIComponent(item.id)}`,
  }));
}

/* -------------------------------------------------------------------------- */
/* Shared query fragments                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Invoices follow Finance's own scope: a project-scoped user sees only invoices
 * on projects they belong to (PRD #4 §29).
 */
/** Leave follows HR scope: SELF means only the person's own requests. */
/**
 * Renders a finance KPI in the currency it was measured in.
 *
 * The amount stays a `Prisma.Decimal` until the last possible moment, and the
 * currency travels with it: a figure labelled "€" that was summed from dollars
 * would be worse than no figure at all (PRD #15 §36).
 */

/**
 * Contracts ending inside the standard horizon (PRD #18 §75, §90).
 *
 * Counted from today rather than read from a status column, so the dashboard
 * and the Legal module cannot disagree about which contracts are expiring.
 */
function expiryHorizon(days = EXPIRING_SOON_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function countExpiringContracts(context: UserContext, days = EXPIRING_SOON_DAYS): Promise<number> {
  return prisma.contract.count({
    where: {
      AND: [
        buildContractScopeWhere(context),
        {
          archivedAt: null,
          status: "ACTIVE",
          expiryDate: { gte: new Date(), lte: expiryHorizon(days) },
        },
      ],
    },
  });
}

function formatKpi(kpi: { amount: Prisma.Decimal; currency: string }): string {
  return formatCurrency(kpi.amount.toNumber(), kpi.currency);
}

/** The Support module's own door: support requests have no scope narrower than the company. */
function supportOpen(context: UserContext): boolean {
  return canAccessModule(context, "support") && can(context, "support.request.view");
}

/**
 * Approved budgets on the reader's projects, for a reader who may see budgets
 * but not invoices. The budget's own finance scope and the project scope both
 * apply, as they do on the project's Finance tab (PRD #15 §210).
 */
async function projectBudgetItems(context: UserContext, take: number) {
  const rows = await prisma.projectBudget.findMany({
    where: {
      AND: [
        buildBudgetScopeWhere(context),
        { isCurrent: true, status: "APPROVED", project: { AND: [buildProjectScopeWhere(context), { archivedAt: null }] } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      currency: true,
      totalAmount: true,
      project: { select: { id: true, name: true, code: true, status: true } },
    },
  });

  return rows.map((row) => ({
    id: row.project.id,
    title: row.project.name,
    subtitle: row.project.code,
    meta: `Budget ${formatKpi({ amount: row.totalAmount, currency: row.currency })}`,
    status: row.project.status,
    href: `/projects/${row.project.id}`,
  }));
}

/**
 * At risk (PRD #10 §15): past the planned end date while not complete, or
 * carrying a critical task that is overdue or blocked. No predictive engine.
 */
async function countProjectsAtRisk(context: UserContext): Promise<number> {
  const scope = buildProjectScopeWhere(context);

  return prisma.project.count({
    where: {
      AND: [
        scope,
        { archivedAt: null, status: { notIn: ["FINISHED", "ARCHIVED"] } },
        {
          OR: [
            { endDate: { lt: new Date() } },
            {
              tasks: {
                some: {
                  archivedAt: null,
                  priority: "CRITICAL",
                  OR: [
                    { status: "BLOCKED" },
                    {
                      status: { in: ["TODO", "IN_PROGRESS"] },
                      dueDate: { lt: new Date() },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  });
}

/**
 * Items at or below their reorder point (PRD #20 §167).
 *
 * On-hand is summed across every location from the balance projection, because
 * stock sitting in three bins is still stock. Prisma cannot compare two columns
 * in a filter, so the comparison happens after a narrow select rather than by
 * loading the whole table.
 */
export async function lowStockRows(context: UserContext) {
  const items = await prisma.inventoryItem.findMany({
    where: {
      companyId: context.companyId,
      archivedAt: null,
      status: "ACTIVE",
      reorderPoint: { not: null },
    },
    select: { id: true, sku: true, name: true, baseUnit: true, reorderPoint: true },
    take: 300,
  });

  if (items.length === 0) return [];

  // Summed over the locations the reader can see, the way the Inventory pages
  // count it: stock in a project store they cannot open is not theirs to
  // count, and an item low only there is not low for them (PRD #20 §246,
  // PRD #47 §175).
  const balances = await prisma.inventoryBalance.groupBy({
    by: ["inventoryItemId"],
    where: {
      AND: [
        buildBalanceScopeWhere(context),
        { companyId: context.companyId, inventoryItemId: { in: items.map((i) => i.id) } },
      ],
    },
    _sum: { onHandQuantity: true },
  });

  const onHandById = new Map(
    balances.map((row) => [row.inventoryItemId, decimalToNumber(row._sum.onHandQuantity)]),
  );

  return items
    .map((item) => ({
      ...item,
      onHand: onHandById.get(item.id) ?? 0,
      reorder: decimalToNumber(item.reorderPoint),
    }))
    .filter((item) => item.onHand <= item.reorder)
    .sort((a, b) => a.onHand - b.onHand);
}

async function lowStockItems(context: UserContext, take: number) {
  return (await lowStockRows(context)).slice(0, take);
}

async function countLowStock(context: UserContext): Promise<number> {
  return (await lowStockRows(context)).length;
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  if (!value) return 0;
  return Number(value);
}

/** "3 min ago", "Yesterday" — spelled out on the server, so every browser agrees (PRD #45 §210). */
function relativeTime(iso: string, now = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}
