import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import * as salesApprovals from "@/lib/modules/sales/approvals/approval.service";
import { approveProposal, rejectProposal, returnProposal } from "@/lib/modules/sales/proposals/proposal.service";
import { buildProposalScopeWhere } from "@/lib/modules/sales/sales.scope";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { amountWhere, formatAmount, formatDate, MATCH_LIMIT, moneyOf, startOfToday, term, valueSignals } from "./shared";

/**
 * Sales approvals in the Center (PRD #41 §70, §145): a proposal's price is
 * approved before it is sent. Its validity date is a real deadline — a
 * proposal approved after it has lapsed is a proposal nobody can accept.
 */
export const salesApprovalProvider = createCycleProvider({
  key: "sales",
  moduleKey: "sales",
  label: "Sales",
  table: () => prisma.salesApproval as unknown as CycleTable,
  records: {
    PROPOSAL: {
      recordType: "proposal",
      noun: "Proposal",
      canView: (context) => can(context, "sales.proposal.view"),
      canApprove: (context) => salesApprovals.canApproveType(context, "PROPOSAL"),
      canReject: (context) => salesApprovals.canRejectType(context, "PROPOSAL"),
      selfPermission: "sales.approval.self",
      reason: "A proposal's price is approved before it is sent to the client.",
      async match(context, filters) {
        // Proposals belong to opportunities, not projects: a project filter matches none.
        if (filters.projectId) return [];
        const rows = await prisma.proposal.findMany({
          where: {
            AND: [
              buildProposalScopeWhere(context),
              amountWhere("totalAmount", filters),
              filters.q ? { OR: [{ proposalNumber: term(filters.q) }, { title: term(filters.q) }, { client: { name: term(filters.q) } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.proposal.findMany({
          where: { AND: [buildProposalScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            proposalNumber: true,
            title: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            validUntil: true,
            notes: true,
            client: { select: { name: true } },
            opportunity: { select: { name: true } },
            _count: { select: { lineItems: true } },
          },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.proposalNumber,
              title: `${row.proposalNumber} — ${row.title}`,
              subtitle: row.client.name,
              amount: moneyOf(row.totalAmount, row.currency),
              project: null,
              href: `/sales/proposals/${row.id}`,
              dueAt: row.validUntil,
              ...valueSignals(row.totalAmount),
              summary: [
                { label: "Client", value: row.client.name },
                { label: "Opportunity", value: row.opportunity.name },
                { label: "Lines", value: String(row._count.lineItems) },
                { label: "Valid until", value: formatDate(row.validUntil) },
                { label: "Subtotal", value: formatAmount(row.subtotal, row.currency) },
                { label: "Tax", value: formatAmount(row.taxAmount, row.currency) },
                { label: "Total", value: formatAmount(row.totalAmount, row.currency), emphasis: "strong" },
              ],
              description: row.notes,
              warnings:
                row.validUntil && row.validUntil < startOfToday()
                  ? [{ code: "PROPOSAL_LAPSED", message: `The proposal's validity ended ${formatDate(row.validUntil)}.`, severity: "WARNING" }]
                  : [],
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => approveProposal(context, id, note, guard),
      reject: (context, id, note, guard) => rejectProposal(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnProposal(context, id, note, guard),
    },
  },
});
