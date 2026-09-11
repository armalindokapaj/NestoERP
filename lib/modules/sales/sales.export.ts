import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as leads from "./leads/lead.service";
import * as opportunities from "./opportunities/opportunity.service";
import * as proposals from "./proposals/proposal.service";
import { leadSourceLabels, leadStatusLabels } from "./leads/lead.status";
import { opportunityStageLabels } from "./opportunities/opportunity.stage";
import { proposalStatusLabels } from "./proposals/proposal.status";
import { parseLeadQuery, parseOpportunityQuery, parseProposalQuery } from "./sales.query";

/**
 * CSV export (PRD #17 §170, §171, §362, §446).
 *
 * Deliberately built on the list services rather than beside them: the export
 * parses the same query, calls the same function and therefore inherits the
 * same scope, the same permissions and the same filters. An export that went to
 * the database on its own would eventually disagree with the screen it claims
 * to be a copy of — and the direction it disagrees in is a leak (PRD #17 §171).
 */
export const EXPORT_TYPES = ["leads", "opportunities", "proposals"] as const;
export type SalesExportType = (typeof EXPORT_TYPES)[number];

/** A hard cap: an export is a spreadsheet, not a database dump (PRD #17 §362). */
const MAX_ROWS = 1000;

export async function exportSales(
  context: UserContext,
  type: SalesExportType,
  params: URLSearchParams,
): Promise<{ filename: string; csv: string }> {
  assertModule(context, "sales");
  assertPermission(context, "sales.export");

  if (type === "leads") {
    const query = { ...parseLeadQuery(params), page: 1, limit: MAX_ROWS };
    const result = await leads.listLeads(context, query);

    return {
      filename: "sales-leads.csv",
      csv: toCsv(
        ["Lead", "Company", "Source", "Owner", "Estimated value", "Currency", "Status", "Updated"],
        result.data.map((row) => [
          row.name,
          row.companyName ?? "",
          leadSourceLabels[row.source],
          row.owner?.fullName ?? "",
          row.estimatedValue ?? "",
          row.currency ?? "",
          leadStatusLabels[row.status],
          row.updatedAt.slice(0, 10),
        ]),
      ),
    };
  }

  if (type === "opportunities") {
    const query = { ...parseOpportunityQuery(params), page: 1, limit: MAX_ROWS };
    const result = await opportunities.listOpportunities(context, query);

    return {
      filename: "sales-opportunities.csv",
      csv: toCsv(
        [
          "Opportunity",
          "Client",
          "Owner",
          "Stage",
          "Value",
          "Currency",
          "Probability",
          "Weighted value",
          "Expected close",
          "Next step",
        ],
        result.data.map((row) => [
          row.name,
          row.client?.name ?? "",
          row.owner.fullName,
          opportunityStageLabels[row.stage],
          row.estimatedValue,
          row.currency,
          row.probability,
          row.weightedValue,
          row.expectedCloseDate ?? "",
          row.nextStep ?? "",
        ]),
      ),
    };
  }

  const query = { ...parseProposalQuery(params), page: 1, limit: MAX_ROWS };
  const result = await proposals.listProposals(context, query);

  // No notes column: a proposal's notes are the internal commercial reasoning
  // behind a price, and a file on somebody's laptop is exactly where that stops
  // being governed (PRD #17 §364, §446).
  return {
    filename: "sales-proposals.csv",
    csv: toCsv(
      ["Number", "Title", "Opportunity", "Client", "Total", "Currency", "Valid until", "Status"],
      result.data.map((row) => [
        row.proposalNumber,
        row.title,
        row.opportunity.name,
        row.client.name,
        row.totalAmount,
        row.currency,
        row.validUntil ?? "",
        proposalStatusLabels[row.status],
      ]),
    ),
  };
}

/**
 * Quotes every field, always.
 *
 * A client name with a comma in it, or a next step with a line break, is
 * ordinary data — and a spreadsheet that splits one row into two is a worse
 * answer than a file with more quotation marks in it than strictly necessary.
 */
function toCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}
