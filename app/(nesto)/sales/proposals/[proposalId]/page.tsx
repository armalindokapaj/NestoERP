import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { SalesContractHandoff } from "@/components/contracts/sales-handoff";
import { ProposalInvoiceHandoff } from "@/components/finance/proposal-invoice-handoff";
import { RecordHeader } from "@/components/modules/record-header";
import { ApprovalHistory } from "@/components/sales/approval-history";
import { ProposalActions } from "@/components/sales/proposal-actions";
import { SalesRecordDocuments } from "@/components/sales/record-documents";
import { SalesActivityFeed } from "@/components/sales/sales-activity";
import { Badge } from "@/components/ui/badge";
import { SkeletonTable } from "@/components/ui/loading-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { formatAmount } from "@/components/sales/sales-format";
import { formatDate } from "@/lib/utils/format";
import { pendingCycle } from "@/lib/modules/sales/approvals/approval.service";
import { proposalContext } from "./proposal-context";

export const metadata: Metadata = { title: "Proposal" };

type Params = { params: Promise<{ proposalId: string }> };

/** Proposal detail (PRD #17 §287). */
export default async function ProposalPage({ params }: Params) {
  const { proposalId } = await params;
  const { context, proposal } = await proposalContext(proposalId);
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle =
    proposal.capabilities.canApprove || proposal.capabilities.canReject
      ? await pendingCycle(context, "PROPOSAL", proposal.id)
      : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Proposals", href: "/sales/proposals" },
          { label: proposal.proposalNumber },
        ]}
        title={proposal.proposalNumber}
        subtitle={proposal.title}
        status={proposal.status}
        badges={
          <>
            {proposal.expiry === "EXPIRING_SOON" ? <Badge tone="warning">Expiring soon</Badge> : null}
            {proposal.expiry === "EXPIRED" ? <Badge tone="danger">Expired</Badge> : null}
          </>
        }
        meta={[
          {
            label: "Opportunity",
            value: (
              <Link
                href={`/sales/opportunities/${proposal.opportunity.id}`}
                className="text-accent-strong"
              >
                {proposal.opportunity.name}
              </Link>
            ),
          },
          {
            label: "Client",
            value: (
              <Link href={`/clients/${proposal.client.id}`} className="text-accent-strong">
                {proposal.client.name}
              </Link>
            ),
          },
          {
            label: "Total",
            value: formatAmount(proposal.totalAmount, proposal.currency),
          },
          {
            label: "Valid until",
            value: proposal.validUntil ? formatDate(proposal.validUntil) : "—",
          },
        ]}
        actions={<ProposalActions proposal={proposal} cycle={cycle} />}
      />

      <section className="nesto-card overflow-hidden">
        <div className="p-5 pb-0">
          <h2 className="text-card font-semibold text-fg">Line items</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            Every figure is calculated by the server from quantity, unit price and tax rate.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell scope="col">Description</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Quantity</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Unit price</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Tax</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Total</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {proposal.lineItems.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(line.unitPrice, proposal.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{line.taxRate}%</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(line.totalAmount, proposal.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <dl className="space-y-1.5 border-t border-line p-5 text-table">
          <Row label="Subtotal" value={formatAmount(proposal.subtotal, proposal.currency)} />
          <Row label="Tax" value={formatAmount(proposal.taxAmount, proposal.currency)} />
          <Row
            label="Total"
            value={formatAmount(proposal.totalAmount, proposal.currency)}
            emphasis
          />
        </dl>
      </section>

      {/*
        * The agreement behind an accepted proposal (PRD #18 §12, §366, §367).
        *
        * The proposal total prefills the contract value and does not fix it:
        * what was quoted and what was signed are allowed to differ.
        */}
      {proposal.status === "ACCEPTED" ? (
        <SalesContractHandoff
          context={context}
          source={{ proposalId: proposal.id, opportunityId: proposal.opportunity.id }}
          prefill={{
            title: proposal.title,
            clientId: proposal.client.id,
            currency: proposal.currency,
            contractValue: proposal.totalAmount,
          }}
        />
      ) : null}

      {/*
        * Billing what was accepted (PRD #35 §180). Rendered whatever the
        * proposal's status, because invoices already raised stay worth showing
        * even after the proposal moves on.
        */}
      <ProposalInvoiceHandoff
        context={context}
        proposalId={proposal.id}
        proposalStatus={proposal.status}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">Approval</h2>
          <ApprovalHistory approvals={proposal.approvals} />
        </section>

        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">Documents</h2>
          <Suspense fallback={<SkeletonTable rows={2} />}>
            <SalesRecordDocuments
              context={context}
              entityType="proposal"
              entityId={proposal.id}
              emptyDescription="The proposal PDF and any pricing or scope attachments appear here."
            />
          </Suspense>
        </section>
      </div>

      {proposal.notes ? (
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{proposal.notes}</p>
        </section>
      ) : null}

      {proposal.capabilities.canViewActivity ? (
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">Activity</h2>
          <Suspense fallback={<SkeletonTable rows={3} />}>
            <SalesActivityFeed context={context} entityType="Proposal" entityId={proposal.id} />
          </Suspense>
        </section>
      ) : null}
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="proposal" parentId={proposalId} />
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={emphasis ? "font-semibold text-fg" : "text-fg-muted"}>{label}</dt>
      <dd className={`tabular-nums ${emphasis ? "font-semibold text-fg" : "text-fg"}`}>{value}</dd>
    </div>
  );
}
