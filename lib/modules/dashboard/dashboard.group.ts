import { cache } from "react";

import { can, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { contractorDirectoryWhere } from "@/lib/modules/contractors/contractor.permissions";
import { buildBudgetScopeWhere, buildInvoiceScopeWhere } from "@/lib/modules/finance/finance.scope";
import { buildEmployeeScopeWhere, hasCompanyHrScope } from "@/lib/modules/hr/hr.scope";
import { listCompanyContexts } from "@/lib/modules/organization/company-context.service";
import { buildSupplierWhere } from "@/lib/modules/procurement/procurement.scope";
import { readableMilestoneWhere } from "@/lib/modules/project-planning/planning.permissions";
import { upcomingMilestones } from "@/lib/modules/project-planning/planning.reports";
import { keyPortfolioProjects, portfolioBreakdown } from "@/lib/modules/projects/project.portfolio";
import { currencyTotals } from "@/lib/modules/sales/opportunities/opportunity.forecast";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { loadRecentActivityRows } from "./dashboard.activity";
import type { WidgetActivityItem, WidgetBreakdownItem, WidgetListItem, WidgetProjectCard } from "./dashboard.types";

/**
 * The group on a dashboard (E-06 §96, §108-§111).
 *
 * One row per company the reader works in. Each row is computed as the
 * reader's own membership in that company, with that company's scope
 * builders, so a group view is the same answers the company pages give and
 * never a query with the company boundary taken off (§161, §171). A reader in
 * one company sees one row.
 */

const OPEN_STAGES = ["PROSPECTING", "QUALIFIED", "DISCOVERY", "PROPOSAL", "NEGOTIATION"] as const;

/** The reader's own membership in each company they work in, resolved once per request. */
const companyContexts = cache(async (context: UserContext): Promise<Array<{ name: string; context: UserContext }>> => {
  const companies = await listCompanyContexts(context);
  const contexts = await Promise.all(
    companies.map(async (company) => ({ name: company.companyName, context: await contextInCompany(context, company.companyId) })),
  );
  return contexts.filter((row): row is { name: string; context: UserContext } => row.context !== null);
});

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A company's registration number, which NESTO's Albanian labels call the NIPT. */
const nipt = (registrationNumber: string | null) => (registrationNumber ? `NIPT ${registrationNumber}` : null);

/**
 * §108, D-01 §30: the companies of the group, their active projects and their
 * people, NIPT and status — and the suspended ones the reader belongs to, which
 * stay visible and take no new work (D-01 §5).
 */
export async function groupCompanies(context: UserContext): Promise<WidgetListItem[]> {
  const rows = await companyContexts(context);
  const identities = new Map(
    (await prisma.company.findMany({ where: { parentGroupId: context.parentGroupId, memberships: { some: { userId: context.userId } } }, select: { id: true, name: true, registrationNumber: true, status: true } })).map((row) => [row.id, row]),
  );
  const active = await Promise.all(
    rows.map(async ({ name, context: company }) => {
      const [projects, people] = await Promise.all([
        can(company, "project.view")
          ? prisma.project.count({ where: { AND: [buildProjectScopeWhere(company), { status: "ACTIVE", archivedAt: null }] } })
          : Promise.resolve(null),
        prisma.companyMember.count({ where: { companyId: company.companyId, status: "ACTIVE" } }),
      ]);
      const identity = identities.get(company.companyId);
      return {
        id: company.companyId,
        title: name,
        subtitle: [projects === null ? null : plural(projects, "active project"), plural(people, "person", "people"), nipt(identity?.registrationNumber ?? null)].filter(Boolean).join(" · "),
        meta: company.roleLabel,
        status: identity?.status,
        href: `/organization/companies/${company.companyId}`,
      };
    }),
  );
  const suspended = [...identities.values()]
    .filter((company) => company.status === "SUSPENDED")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((company) => ({
      id: company.id,
      title: company.name,
      subtitle: ["Suspended — no new work", nipt(company.registrationNumber)].filter(Boolean).join(" · "),
      status: company.status,
      href: `/organization/companies/${company.id}`,
    }));
  return [...active, ...suspended];
}

/** §109: invoices waiting and overdue, per company the reader has Finance in. */
export async function groupFinance(context: UserContext): Promise<WidgetListItem[]> {
  const rows = (await companyContexts(context)).filter(({ context: company }) => company.enabledModules.includes("finance") && can(company, "finance.invoice.view"));
  const now = new Date();
  return Promise.all(
    rows.map(async ({ name, context: company }) => {
      const scope = buildInvoiceScopeWhere(company);
      const [pending, sent, overdue] = await Promise.all([
        prisma.invoice.count({ where: { AND: [scope, { status: "PENDING_APPROVAL" }] } }),
        prisma.invoice.count({ where: { AND: [scope, { status: "SENT" }] } }),
        prisma.invoice.count({ where: { AND: [scope, { status: "SENT", dueDate: { lt: now } }] } }),
      ]);
      return {
        id: company.companyId,
        title: name,
        subtitle: `${pending} awaiting approval · ${sent} sent · ${overdue} overdue`,
        status: overdue > 0 ? "OVERDUE" : undefined,
      };
    }),
  );
}

/** §111: the open pipeline, per company the reader has Sales in; currencies never summed (PRD #17 §31). */
export async function groupPipeline(context: UserContext): Promise<WidgetListItem[]> {
  const rows = (await companyContexts(context)).filter(({ context: company }) => company.enabledModules.includes("sales") && can(company, "sales.opportunity.view"));
  return Promise.all(
    rows.map(async ({ name, context: company }) => {
      const deals = await prisma.opportunity.findMany({
        where: { AND: [buildOpportunityScopeWhere(company), { archivedAt: null, stage: { in: [...OPEN_STAGES] } }] },
        select: { currency: true, estimatedValue: true, probabilityOverride: true, stage: true },
      });
      const totals = currencyTotals(deals);
      return {
        id: company.companyId,
        title: name,
        subtitle: plural(deals.length, "open deal"),
        meta: totals.map((total) => formatCurrency(Number.parseFloat(total.value), total.currency)).join(" · ") || undefined,
      };
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* The group's executive view (D-01 §25-§36, §66, §79-§85)                      */
/* -------------------------------------------------------------------------- */

export type GroupIdentity = {
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  city: string | null;
  country: string | null;
  isDemo: boolean;
  activeCompanies: number;
  suspendedCompanies: number;
};

/** Who sees the group as a group: its Owner and the heads of its functions (E-06 §78). */
export function seesGroup(context: UserContext): boolean {
  return can(context, "department.group.view");
}

/** The group's identity for the dashboard's banner (D-01 §26), or null for a reader who works in one company's view. */
export async function groupIdentity(context: UserContext): Promise<GroupIdentity | null> {
  if (!seesGroup(context)) return null;
  const [group, companies] = await Promise.all([
    // The session's own group, reached through its company.
    prisma.parentGroup.findFirstOrThrow({ where: { id: context.parentGroupId, companies: { some: { id: context.companyId } } }, select: { name: true, legalName: true, registrationNumber: true, city: true, country: true, isDemo: true } }),
    prisma.company.groupBy({ by: ["status"], where: { parentGroupId: context.parentGroupId }, _count: { _all: true } }),
  ]);
  const count = (status: string) => companies.find((row) => row.status === status)?._count._all ?? 0;
  return { ...group, activeCompanies: count("ACTIVE"), suspendedCompanies: count("SUSPENDED") };
}

export type GroupFigure = { value: string; hint?: string };

/** D-01 §28: the group's companies, from the database, suspended ones counted and named as such. */
export async function groupCompanyCount(context: UserContext): Promise<GroupFigure | null> {
  const identity = await groupIdentity(context);
  if (!identity) return null;
  const total = identity.activeCompanies + identity.suspendedCompanies;
  return { value: String(total), hint: identity.suspendedCompanies ? `${identity.activeCompanies} active · ${identity.suspendedCompanies} suspended` : undefined };
}

/** D-01 §28: active projects the reader can open, across the group — the Projects page's own portfolio. */
export async function groupActiveProjects(context: UserContext): Promise<GroupFigure | null> {
  if (!seesGroup(context)) return null;
  const { byStatus } = await portfolioBreakdown(context);
  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const active = byStatus.find((row) => row.status === "ACTIVE")?.count ?? 0;
  return { value: String(active), hint: `of ${plural(total, "project")} in the portfolio` };
}

/**
 * D-01 §28: people employed — active or on leave — in the companies where the
 * reader holds HR's company-wide view. A company where they do not is not
 * counted at all rather than counted partly.
 */
export async function groupEmployees(context: UserContext): Promise<GroupFigure | null> {
  if (!seesGroup(context)) return null;
  const rows = (await companyContexts(context)).filter(({ context: company }) => isModuleEnabled(company, "hr") && can(company, "hr.employee.view") && hasCompanyHrScope(company));
  if (rows.length === 0) return null;
  const counts = await Promise.all(
    rows.map(({ context: company }) => prisma.employeeProfile.count({ where: { AND: [buildEmployeeScopeWhere(company), { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } }] } })),
  );
  return { value: String(counts.reduce((sum, count) => sum + count, 0)), hint: `in ${plural(rows.length, "company", "companies")}` };
}

const external = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * D-01 §28, §45: the external companies the group works with — suppliers,
 * contractors and client companies — each counted once however many roles it
 * plays and however many of the group's companies deal with it: by its tax
 * number where one is recorded, by its name otherwise. Each register only
 * where the reader may read it.
 */
export async function groupExternalCompanies(context: UserContext): Promise<GroupFigure | null> {
  if (!seesGroup(context)) return null;
  const keys = new Set<string>();
  let registers = 0;
  for (const { context: company } of await companyContexts(context)) {
    const [suppliers, contractors, clients] = await Promise.all([
      isModuleEnabled(company, "procurement") ? prisma.supplier.findMany({ where: { AND: [buildSupplierWhere(company), { status: "ACTIVE" }] }, select: { name: true, taxId: true } }) : Promise.resolve(null),
      isModuleEnabled(company, "contractors") && can(company, "contractor.view") ? prisma.contractorProfile.findMany({ where: contractorDirectoryWhere(company), select: { legalName: true, vatNumber: true, registrationNumber: true } }) : Promise.resolve(null),
      isModuleEnabled(company, "clients") && can(company, "client.view") ? prisma.client.findMany({ where: { AND: [buildClientScopeWhere(company), { type: { in: ["COMPANY", "PUBLIC_ENTITY"] }, status: "ACTIVE" }] }, select: { name: true } }) : Promise.resolve(null),
    ]);
    for (const register of [suppliers, contractors, clients]) if (register) registers += 1;
    for (const row of suppliers ?? []) keys.add(external(row.taxId) || external(row.name));
    for (const row of contractors ?? []) keys.add(external(row.vatNumber ?? row.registrationNumber) || external(row.legalName));
    for (const row of clients ?? []) keys.add(external(row.name));
  }
  if (registers === 0) return null;
  keys.delete("");
  return { value: String(keys.size), hint: "suppliers, contractors and client companies, each once" };
}

/**
 * D-01 §28, §29: the portfolio's value — the approved current budgets of the
 * projects the reader may see the budgets of, company by company, never summed
 * across currencies. A demonstration tenant says the figure is synthetic.
 */
export async function groupPortfolioValue(context: UserContext): Promise<GroupFigure | null> {
  if (!seesGroup(context)) return null;
  const rows = (await companyContexts(context)).filter(({ context: company }) => isModuleEnabled(company, "finance") && can(company, "finance.budget.view"));
  if (rows.length === 0) return null;
  const totals = new Map<string, number>();
  let projects = 0;
  for (const { context: company } of rows) {
    const budgets = await prisma.projectBudget.findMany({
      where: { AND: [buildBudgetScopeWhere(company), { isCurrent: true, status: "APPROVED", archivedAt: null, project: { archivedAt: null } }] },
      select: { currency: true, totalAmount: true },
    });
    projects += budgets.length;
    for (const budget of budgets) totals.set(budget.currency, (totals.get(budget.currency) ?? 0) + Number(budget.totalAmount));
  }
  if (totals.size === 0) return { value: "—", hint: "No approved project budgets yet" };
  const value = [...totals].map(([currency, amount]) => compactCurrency(amount, currency)).join(" · ");
  const basis = `Approved budgets of ${plural(projects, "project")}`;
  return { value, hint: context.parentGroup.isDemo ? `${basis} · synthetic demo figure` : basis };
}

/** "€124.5M": a portfolio is read in millions. */
function compactCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

const STATUS_ORDER = ["ACTIVE", "PENDING", "FINISHED"];

/** D-01 §32: the portfolio by status. */
export async function groupPortfolioByStatus(context: UserContext): Promise<WidgetBreakdownItem[]> {
  if (!seesGroup(context)) return [];
  const { byStatus } = await portfolioBreakdown(context);
  return byStatus
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    .map((row) => ({ label: row.status, value: row.count, status: row.status, href: `/projects?status=${row.status}` }));
}

/** D-01 §33: the portfolio by project type — each company's own types, one category per name. */
export async function groupProjectTypes(context: UserContext): Promise<WidgetBreakdownItem[]> {
  if (!seesGroup(context)) return [];
  const { byType } = await portfolioBreakdown(context);
  return byType.map((row) => ({ label: row.name, value: row.count }));
}

/**
 * D-01 §31: the group's key projects as cards — cover, company, place, type and
 * the kinds of unit it holds, status, and progress from its plan (completed
 * milestones over those not cancelled, PRD #44 §129) where the reader may open
 * the plan.
 */
export async function groupKeyProjects(context: UserContext): Promise<WidgetProjectCard[]> {
  if (!seesGroup(context)) return [];
  const projects = await keyPortfolioProjects(context, 4);
  if (projects.length === 0) return [];
  const contexts = new Map((await companyContexts(context)).map((row) => [row.context.companyId, row.context]));
  return Promise.all(
    projects.map(async (project) => {
      const company = contexts.get(project.company.id);
      const [milestones, categories] = await Promise.all([
        company ? prisma.projectMilestone.groupBy({ by: ["status"], where: { AND: [readableMilestoneWhere(company), { projectId: project.id, archivedAt: null }] }, _count: { _all: true } }) : Promise.resolve([]),
        company && can(company, "project.structure.view")
          ? prisma.projectUnitType.findMany({ where: { companyId: project.company.id, units: { some: { projectId: project.id, isActive: true } }, category: { in: ["RESIDENTIAL", "COMMERCIAL"] } }, distinct: ["category"], select: { category: true } })
          : Promise.resolve([]),
      ]);
      const counted = milestones.filter((row) => row.status !== "CANCELLED").reduce((sum, row) => sum + row._count._all, 0);
      const completed = milestones.find((row) => row.status === "COMPLETED")?._count._all ?? 0;
      const tags = [project.projectType?.name, ...categories.map((row) => (row.category === "RESIDENTIAL" ? "Residential" : "Commercial"))].filter((tag): tag is string => Boolean(tag));
      return {
        id: project.id,
        name: project.name,
        href: project.href,
        company: project.company.name,
        location: [project.location.city, project.location.country].filter(Boolean).join(", ") || null,
        tags: [...new Set(tags)],
        status: project.status,
        progress: counted ? Math.round((completed / counted) * 100) : null,
        coverUrl: project.cover?.thumbnailUrl ?? null,
      };
    }),
  );
}

/** D-01 §34: the group's departments and how many people each counts, from E-13's places. */
export async function groupDepartments(context: UserContext): Promise<WidgetBreakdownItem[]> {
  if (!seesGroup(context)) return [];
  const [departments, places] = await Promise.all([
    prisma.groupDepartment.findMany({ where: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.departmentAssignment.findMany({
      where: { parentGroupId: context.parentGroupId, positionLevel: "MEMBER", status: "ACTIVE", company: { is: { status: "ACTIVE" } } },
      distinct: ["groupDepartmentId", "userId"],
      select: { groupDepartmentId: true },
    }),
  ]);
  const members = new Map<string, number>();
  for (const place of places) members.set(place.groupDepartmentId, (members.get(place.groupDepartmentId) ?? 0) + 1);
  return departments
    .map((department) => ({ label: department.name, value: members.get(department.id) ?? 0, href: `/organization/departments/${department.id}` }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** D-01 §36: the next milestones across the group's projects, each company's plans read as that company reads them. */
export async function groupMilestones(context: UserContext, limit = 6): Promise<WidgetListItem[]> {
  if (!seesGroup(context)) return [];
  const rows = (await Promise.all((await companyContexts(context)).map(async ({ name, context: company }) => (await upcomingMilestones(company, limit)).map((row) => ({ ...row, company: name }))))).flat();
  return rows
    .sort((a, b) => Number(b.delayed) - Number(a.delayed) || (a.displayDate ?? "").localeCompare(b.displayDate ?? ""))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: [row.projectName, row.phaseName, row.company].filter(Boolean).join(" · "),
      meta: row.displayDate ? formatDate(new Date(`${row.displayDate}T12:00:00Z`)) : undefined,
      status: row.delayed ? "DELAYED" : row.status,
      href: row.href,
    }));
}

/** D-01 §35: recent activity across the group's companies, each entry only where its reader could open the record. */
export async function groupActivity(context: UserContext, take = 8): Promise<WidgetActivityItem[]> {
  if (!seesGroup(context)) return [];
  const rows = (
    await Promise.all(
      (await companyContexts(context)).map(async ({ name, context: company }) => (await loadRecentActivityRows(company, take)).map((row) => ({ ...row, item: { ...row.item, context: name } }))),
    )
  ).flat();
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take).map((row) => row.item);
}

export type GroupDashboardDTO = {
  group: GroupIdentity;
  /** Null where the reader has no company whose figure is theirs to read. */
  figures: Record<"companies" | "activeProjects" | "employees" | "externalCompanies" | "portfolioValue", GroupFigure | null>;
  companies: WidgetListItem[];
  keyProjects: WidgetProjectCard[];
  portfolio: WidgetBreakdownItem[];
  projectTypes: WidgetBreakdownItem[];
  departments: WidgetBreakdownItem[];
  milestones: WidgetListItem[];
  activity: WidgetActivityItem[];
};

/**
 * The whole executive view in one aggregate (D-01 §79, §82): the same
 * functions the dashboard's widgets run, in parallel. Refused to a reader who
 * does not see the group as a group, with nothing about it (§66).
 */
export async function getGroupDashboard(context: UserContext): Promise<GroupDashboardDTO> {
  const group = await groupIdentity(context);
  if (!group) throw new AccessError("FORBIDDEN");
  const [companies, activeProjects, employees, externalCompanies, portfolioValue, companyRows, keyProjects, portfolio, projectTypes, departments, milestones, activity] = await Promise.all([
    groupCompanyCount(context),
    groupActiveProjects(context),
    groupEmployees(context),
    groupExternalCompanies(context),
    groupPortfolioValue(context),
    groupCompanies(context),
    groupKeyProjects(context),
    groupPortfolioByStatus(context),
    groupProjectTypes(context),
    groupDepartments(context),
    groupMilestones(context),
    groupActivity(context),
  ]);
  return { group, figures: { companies, activeProjects, employees, externalCompanies, portfolioValue }, companies: companyRows, keyProjects, portfolio, projectTypes, departments, milestones, activity };
}
