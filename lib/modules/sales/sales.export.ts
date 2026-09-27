import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prepareExport, type ExportColumn, type ExportLimits, type PreparedExport } from "@/lib/core/export/exporter";
import { assertExportParams, assertExportRange, assertOwnCompany, type ParamRules } from "@/lib/core/export/export-params";
import * as leads from "./leads/lead.service";
import { LEAD_SORT_KEYS, LEAD_SOURCES, LEAD_STATUSES } from "./leads/lead.schema";
import { leadSourceLabels, leadStatusLabels } from "./leads/lead.status";
import * as opportunities from "./opportunities/opportunity.service";
import { OPPORTUNITY_OUTCOMES, OPPORTUNITY_SORT_KEYS, OPPORTUNITY_STAGE_VALUES } from "./opportunities/opportunity.schema";
import { opportunityStageLabels } from "./opportunities/opportunity.stage";
import * as proposals from "./proposals/proposal.service";
import { PROPOSAL_SORT_KEYS, PROPOSAL_STATUSES } from "./proposals/proposal.schema";
import { proposalStatusLabels } from "./proposals/proposal.status";
import { parseLeadQuery, parseOpportunityQuery, parseProposalQuery } from "./sales.query";
import type { LeadSummaryDTO, OpportunitySummaryDTO, ProposalSummaryDTO } from "./sales.types";

/**
 * CSV export (PRD #17 §170, §171, §362, §446; AUD-08 §7).
 *
 * Deliberately built on the list services rather than beside them: the export
 * parses the same query, calls the same function and therefore inherits the
 * same scope, the same permissions, the same filters and the same order — only
 * the page is gone (DT-02, DT-14). An export that went to the database on its
 * own would eventually disagree with the screen it claims to be a copy of —
 * and the direction it disagrees in is a leak (PRD #17 §171).
 *
 * Every parameter must be one the list applies, spelled so it applies:
 * `stage=NEGOTATION` is refused, not dropped into "every stage" (DT-03). A
 * `company` other than the active one is refused (DT-22).
 *
 * Standard columns (AUD-08 §7): the record id and company id first, then the
 * list's fields; amounts are decimal strings in numeric columns beside their
 * currency; no notes — a proposal's notes are the internal commercial
 * reasoning behind a price (PRD #17 §364, §446).
 *
 * Limits: 1,000 rows (the existing hard cap, PRD #17 §362), 10 MiB, 30 s.
 * Every cell is quoted and lines end CRLF, as this file always has.
 */
export const EXPORT_TYPES = ["leads", "opportunities", "proposals"] as const;
export type SalesExportType = (typeof EXPORT_TYPES)[number];

/** A hard cap: an export is a spreadsheet, not a database dump (PRD #17 §362). */
export const SALES_EXPORT_LIMITS: Partial<ExportLimits> = { maxRows: 1000 };

const LAYOUT = { lineBreak: "\r\n", quoteAll: true } as const;

const SHARED: ParamRules = {
  search: { kind: "text" },
  owner: { kind: "id" },
  company: { kind: "id" },
  currency: { kind: "text", max: 8 },
  archived: { kind: "flag" },
};

export const SALES_EXPORT_PARAMS: Record<SalesExportType, ParamRules> = {
  leads: {
    ...SHARED,
    status: { kind: "enumList", allowed: LEAD_STATUSES, caseInsensitive: true },
    source: { kind: "enumList", allowed: LEAD_SOURCES, caseInsensitive: true },
    minValue: { kind: "decimal" },
    maxValue: { kind: "decimal" },
    createdFrom: { kind: "date" },
    createdTo: { kind: "date" },
    mine: { kind: "flag" },
    sort: { kind: "enum", allowed: LEAD_SORT_KEYS },
  },
  opportunities: {
    ...SHARED,
    stage: { kind: "enumList", allowed: OPPORTUNITY_STAGE_VALUES, caseInsensitive: true },
    outcome: { kind: "enumList", allowed: OPPORTUNITY_OUTCOMES, caseInsensitive: true },
    clientId: { kind: "id" },
    minValue: { kind: "decimal" },
    maxValue: { kind: "decimal" },
    minProbability: { kind: "decimal" },
    maxProbability: { kind: "decimal" },
    closeFrom: { kind: "date" },
    closeTo: { kind: "date" },
    mine: { kind: "flag" },
    sort: { kind: "enum", allowed: OPPORTUNITY_SORT_KEYS },
  },
  proposals: {
    ...SHARED,
    status: { kind: "enumList", allowed: PROPOSAL_STATUSES, caseInsensitive: true },
    opportunityId: { kind: "id" },
    clientId: { kind: "id" },
    sort: { kind: "enum", allowed: PROPOSAL_SORT_KEYS },
  },
};

/** The standard columns of each file (AUD-08 §7, DT-15). */
export function leadColumns(context: UserContext): ExportColumn<LeadSummaryDTO>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Lead ID", kind: "code", value: (row) => row.id },
    { header: "Lead", kind: "text", value: (row) => row.name },
    { header: "Company", kind: "text", value: (row) => row.companyName },
    { header: "Source", kind: "status", value: (row) => leadSourceLabels[row.source] },
    { header: "Owner", kind: "text", value: (row) => row.owner?.fullName },
    { header: "Estimated value", kind: "decimal", value: (row) => row.estimatedValue },
    { header: "Currency", kind: "code", value: (row) => row.currency },
    { header: "Status", kind: "status", value: (row) => leadStatusLabels[row.status] },
    { header: "Updated at", kind: "datetime", value: (row) => row.updatedAt },
  ];
}

export function opportunityColumns(context: UserContext): ExportColumn<OpportunitySummaryDTO>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Opportunity ID", kind: "code", value: (row) => row.id },
    { header: "Opportunity", kind: "text", value: (row) => row.name },
    { header: "Client ID", kind: "code", value: (row) => row.client?.id },
    { header: "Client", kind: "text", value: (row) => row.client?.name },
    { header: "Owner", kind: "text", value: (row) => row.owner.fullName },
    { header: "Stage", kind: "status", value: (row) => opportunityStageLabels[row.stage] },
    { header: "Value", kind: "decimal", value: (row) => row.estimatedValue },
    { header: "Currency", kind: "code", value: (row) => row.currency },
    { header: "Probability", kind: "decimal", value: (row) => row.probability },
    { header: "Weighted value", kind: "decimal", value: (row) => row.weightedValue },
    { header: "Expected close", kind: "date", value: (row) => row.expectedCloseDate },
    { header: "Next step", kind: "text", value: (row) => row.nextStep },
  ];
}

export function proposalColumns(context: UserContext): ExportColumn<ProposalSummaryDTO>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Proposal ID", kind: "code", value: (row) => row.id },
    { header: "Number", kind: "code", value: (row) => row.proposalNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Opportunity", kind: "text", value: (row) => row.opportunity.name },
    { header: "Client ID", kind: "code", value: (row) => row.client.id },
    { header: "Client", kind: "text", value: (row) => row.client.name },
    { header: "Total", kind: "decimal", value: (row) => row.totalAmount },
    { header: "Currency", kind: "code", value: (row) => row.currency },
    { header: "Valid until", kind: "date", value: (row) => row.validUntil },
    { header: "Status", kind: "status", value: (row) => proposalStatusLabels[row.status] },
  ];
}

export async function exportSales(
  context: UserContext,
  type: SalesExportType,
  params: URLSearchParams,
  options: { evaluatedAt?: Date } = {},
): Promise<PreparedExport> {
  assertModule(context, "sales");
  assertPermission(context, "sales.export");
  assertExportParams(params, SALES_EXPORT_PARAMS[type], { selector: ["type"] });
  assertOwnCompany(context, params);
  const shared = { limits: SALES_EXPORT_LIMITS, layout: LAYOUT, evaluatedAt: options.evaluatedAt };

  if (type === "leads") {
    assertExportRange(params, "createdFrom", "createdTo");
    const query = parseLeadQuery(params);
    return prepareExport({
      ...shared,
      id: "sales.leads",
      filename: "sales-leads.csv",
      columns: leadColumns(context),
      read: async (take) => {
        const result = await leads.listLeads(context, { ...query, page: 1, limit: take });
        return { rows: result.data, total: result.pagination.total };
      },
    });
  }

  if (type === "opportunities") {
    assertExportRange(params, "closeFrom", "closeTo");
    const query = parseOpportunityQuery(params);
    return prepareExport({
      ...shared,
      id: "sales.opportunities",
      filename: "sales-opportunities.csv",
      columns: opportunityColumns(context),
      read: async (take) => {
        const result = await opportunities.listOpportunities(context, { ...query, page: 1, limit: take });
        // Probability is derived and filtered after the read (see the service),
        // so the rows may be fewer than the query's count by design.
        const refined = query.minProbability !== undefined || query.maxProbability !== undefined;
        return { rows: result.data, total: result.pagination.total, refined };
      },
    });
  }

  const query = parseProposalQuery(params);
  return prepareExport({
    ...shared,
    id: "sales.proposals",
    filename: "sales-proposals.csv",
    columns: proposalColumns(context),
    read: async (take) => {
      const result = await proposals.listProposals(context, { ...query, page: 1, limit: take });
      return { rows: result.data, total: result.pagination.total };
    },
  });
}
