import { can } from "@/lib/access/can";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildInvoiceScopeWhere } from "@/lib/modules/finance/finance.scope";
import { listCompanyContexts } from "@/lib/modules/organization/company-context.service";
import { currencyTotals } from "@/lib/modules/sales/opportunities/opportunity.forecast";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { formatCurrency } from "@/lib/utils/format";
import type { WidgetListItem } from "./dashboard.types";

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

async function companyContexts(context: UserContext): Promise<Array<{ name: string; context: UserContext }>> {
  const companies = await listCompanyContexts(context);
  const contexts = await Promise.all(
    companies.map(async (company) => ({ name: company.companyName, context: await contextInCompany(context, company.companyId) })),
  );
  return contexts.filter((row): row is { name: string; context: UserContext } => row.context !== null);
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** §108: the companies of the group, their active projects and their people. */
export async function groupCompanies(context: UserContext): Promise<WidgetListItem[]> {
  const rows = await companyContexts(context);
  return Promise.all(
    rows.map(async ({ name, context: company }) => {
      const [projects, people] = await Promise.all([
        can(company, "project.view")
          ? prisma.project.count({ where: { AND: [buildProjectScopeWhere(company), { status: "ACTIVE", archivedAt: null }] } })
          : Promise.resolve(null),
        prisma.companyMember.count({ where: { companyId: company.companyId, status: "ACTIVE" } }),
      ]);
      return {
        id: company.companyId,
        title: name,
        subtitle: [projects === null ? null : plural(projects, "active project"), plural(people, "person", "people")].filter(Boolean).join(" · "),
        meta: company.roleLabel,
        href: "/organization",
      };
    }),
  );
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
