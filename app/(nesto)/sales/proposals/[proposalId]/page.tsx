import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.proposal") };
}

type Params = { params: Promise<{ proposalId: string }> };

/** Proposal detail (PRD #17 §287). */
export default async function ProposalPage({ params }: Params) {
  const { proposalId } = await params;
  const { context, proposal } = await proposalContext(proposalId);
  const t = await getTranslations("sales");
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle =
    proposal.capabilities.canApprove || proposal.capabilities.canReject
      ? await pendingCycle(context, "PROPOSAL", proposal.id)
      : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.proposals"), href: "/sales/proposals" },
          { label: proposal.proposalNumber },
        ]}
        title={proposal.proposalNumber}
        subtitle={proposal.title}
        status={proposal.status}
        badges={
          <>
            {proposal.expiry === "EXPIRING_SOON" ? <Badge tone="warning">{t("detail.expiringSoon")}</Badge> : null}
            {proposal.expiry === "EXPIRED" ? <Badge tone="danger">{t("detail.expired")}</Badge> : null}
          </>
        }
        meta={[
          {
            label: t("detail.opportunity"),
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
            label: t("detail.client"),
            value: (
              <Link href={`/clients/${proposal.client.id}`} className="text-accent-strong">
                {proposal.client.name}
              </Link>
            ),
          },
          {
            label: t("detail.total"),
            value: formatAmount(proposal.totalAmount, proposal.currency),
          },
          {
            label: t("detail.validUntil"),
            value: proposal.validUntil ? formatDate(proposal.validUntil) : "—",
          },
        ]}
        actions={<ProposalActions proposal={proposal} cycle={cycle} />}
      />

      <section className="nesto-card overflow-hidden">
        <div className="p-5 pb-0">
          <h2 className="text-card font-semibold text-fg">{t("detail.lineItems")}</h2>
          <p className="mt-1 text-meta text-fg-subtle">
            {t("detail.lineItemsHint")}
          </p>
        </div>

        {/* The Table primitive is the labelled scroll region itself (AUD-04 §5, SP-02). */}
        <div className="mt-4">
          <Table label={t("detail.proposalLines")}>
            <TableHead>
              <tr>
                <TableHeaderCell scope="col">{t("detail.description")}</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">{t("detail.quantity")}</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">{t("detail.unitPrice")}</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">{t("detail.tax")}</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">{t("detail.total")}</TableHeaderCell>
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
          <Row label={t("detail.subtotal")} value={formatAmount(proposal.subtotal, proposal.currency)} />
          <Row label={t("detail.tax")} value={formatAmount(proposal.taxAmount, proposal.currency)} />
          <Row
            label={t("detail.total")}
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
          <h2 className="text-card font-semibold text-fg">{t("detail.approval")}</h2>
          <ApprovalHistory approvals={proposal.approvals} />
        </section>

        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">{t("detail.documents")}</h2>
          <Suspense fallback={<SkeletonTable rows={2} />}>
            <SalesRecordDocuments
              context={context}
              entityType="proposal"
              entityId={proposal.id}
              emptyDescription={t("detail.proposalDocuments")}
            />
          </Suspense>
        </section>
      </div>

      {proposal.notes ? (
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("detail.notes")}</h2>
          <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{proposal.notes}</p>
        </section>
      ) : null}

      {proposal.capabilities.canViewActivity ? (
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
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
