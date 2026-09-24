import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { RecordHeader } from "@/components/modules/record-header";
import { OpportunityActions } from "@/components/sales/opportunity-actions";
import { ProposalTable } from "@/components/sales/proposal-table";
import { SalesContractHandoff } from "@/components/contracts/sales-handoff";
import { SalesRecordDocuments } from "@/components/sales/record-documents";
import { SalesActivityFeed } from "@/components/sales/sales-activity";
import { DealUnits } from "@/components/sales/unit-sales/deal-units";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can, canAccessModule } from "@/lib/access/can";
import { lostReasonLabels } from "@/lib/modules/sales/proposals/proposal.status";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { formatAmount } from "@/components/sales/sales-format";
import { formatDate } from "@/lib/utils/format";
import { opportunityContext } from "./opportunity-context";

export const metadata: Metadata = { title: "Opportunity" };

type Params = { params: Promise<{ opportunityId: string }> };

/** Opportunity detail (PRD #17 §285). */
export default async function OpportunityPage({ params }: Params) {
  const { opportunityId } = await params;
  const { context, opportunity } = await opportunityContext(opportunityId);

  const relatedProposals = await proposals.listForOpportunity(context, opportunityId);

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Opportunities", href: "/sales/opportunities" },
          { label: opportunity.name },
        ]}
        title={opportunity.name}
        subtitle={opportunity.client?.name ?? "No client yet"}
        status={opportunity.stage}
        badges={
          <>
            {opportunity.archivedAt ? <Badge tone="default">Archived</Badge> : null}
            {opportunity.expectedCloseOverdue ? (
              <Badge tone="warning">Expected close overdue</Badge>
            ) : null}
            {opportunity.owner.active ? null : <Badge tone="warning">Owner inactive</Badge>}
          </>
        }
        meta={[
          {
            label: "Value",
            value: formatAmount(opportunity.estimatedValue, opportunity.currency),
          },
          {
            label: "Probability",
            value: `${opportunity.probability}%${opportunity.probabilityIsOverride ? " (override)" : " (stage default)"}`,
          },
          {
            label: "Weighted",
            value: formatAmount(opportunity.weightedValue, opportunity.currency),
          },
          { label: "Owner", value: <PersonLink memberId={opportunity.owner.memberId} name={opportunity.owner.fullName} /> },
          {
            label: opportunity.actualCloseDate ? "Closed" : "Expected close",
            value: opportunity.actualCloseDate
              ? formatDate(opportunity.actualCloseDate)
              : opportunity.expectedCloseDate
                ? formatDate(opportunity.expectedCloseDate)
                : "—",
          },
        ]}
        actions={<OpportunityActions opportunity={opportunity} />}
      />

      {opportunity.stage === "WON" ? (
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Won</h2>
          {opportunity.wonReason ? (
            <p className="mt-1 text-table text-fg-muted">{opportunity.wonReason}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-table">
            {opportunity.client ? (
              <Link href={`/clients/${opportunity.client.id}`} className="font-medium text-accent-strong">
                {opportunity.client.name}
              </Link>
            ) : null}
            {opportunity.convertedProject ? (
              <Link
                href={`/projects/${opportunity.convertedProject.id}`}
                className="font-medium text-accent-strong"
              >
                {opportunity.convertedProject.code} — {opportunity.convertedProject.name}
              </Link>
            ) : opportunity.capabilities.canLinkProject ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/sales/opportunities/${opportunityId}/project`}>Link a project</Link>
              </Button>
            ) : (
              <span className="text-fg-subtle">No delivery project yet.</span>
            )}
          </div>
        </section>
      ) : null}

      {/* The agreement behind a won deal (PRD #18 §12, §366). */}
      {opportunity.stage === "WON" ? (
        <SalesContractHandoff
          context={context}
          source={{ opportunityId: opportunity.id }}
          prefill={{
            title: opportunity.name,
            clientId: opportunity.client?.id ?? null,
            currency: opportunity.currency,
            contractValue: opportunity.estimatedValue,
          }}
        />
      ) : null}

      {opportunity.stage === "LOST" && opportunity.lostReason ? (
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">
            Lost — {lostReasonLabels[opportunity.lostReason]}
          </h2>
          {opportunity.lostNote ? (
            <p className="mt-1 text-table text-fg-muted">{opportunity.lostNote}</p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Details</h2>

          {opportunity.nextStep ? (
            <div className="mt-4">
              <h3 className="nesto-eyebrow text-fg-subtle">Next step</h3>
              <p className="mt-1 text-table text-fg">{opportunity.nextStep}</p>
            </div>
          ) : null}

          <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="nesto-eyebrow text-fg-subtle">Contact</dt>
              <dd className="mt-0.5 text-table text-fg">
                {opportunity.contact ? opportunity.contact.fullName : <span className="text-fg-subtle">—</span>}
              </dd>
            </div>
            <div>
              <dt className="nesto-eyebrow text-fg-subtle">From lead</dt>
              <dd className="mt-0.5 text-table text-fg">
                {opportunity.sourceLead ? (
                  <Link
                    href={`/sales/leads/${opportunity.sourceLead.id}`}
                    className="text-accent-strong"
                  >
                    {opportunity.sourceLead.name}
                  </Link>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="nesto-eyebrow text-fg-subtle">In this stage since</dt>
              <dd className="mt-0.5 text-table text-fg">{formatDate(opportunity.stageChangedAt)}</dd>
            </div>
            <div>
              <dt className="nesto-eyebrow text-fg-subtle">Created</dt>
              <dd className="mt-0.5 text-table text-fg">{formatDate(opportunity.createdAt)}</dd>
            </div>
          </dl>

          {opportunity.description ? (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="nesto-eyebrow text-fg-subtle">Description</h3>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {opportunity.description}
              </p>
            </div>
          ) : null}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Documents</h2>
          <div className="mt-4">
            <Suspense fallback={<SkeletonTable rows={2} />}>
              <SalesRecordDocuments
                context={context}
                entityType="opportunity"
                entityId={opportunity.id}
              />
            </Suspense>
          </div>
        </section>
      </div>

      {/* The units this deal is for (E-05E §17): only for readers who may open project units. */}
      {canAccessModule(context, "projects") && can(context, "project.structure.view") ? (
        <Suspense fallback={<SkeletonTable rows={2} />}>
          <DealUnits context={context} opportunityId={opportunity.id} canEdit={opportunity.capabilities.canEdit} />
        </Suspense>
      ) : null}

      {can(context, "sales.proposal.view") ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-card font-semibold text-fg">Proposals</h2>
            {opportunity.capabilities.canCreateProposal ? (
              <Button asChild size="sm">
                <Link href={`/sales/proposals/new?opportunityId=${opportunityId}`}>
                  New proposal
                </Link>
              </Button>
            ) : null}
          </div>

          {relatedProposals.length === 0 ? (
            <p className="nesto-card p-5 text-table text-fg-subtle">No proposals yet.</p>
          ) : (
            <ProposalTable proposals={relatedProposals} showOpportunity={false} />
          )}
        </section>
      ) : null}

      {opportunity.capabilities.canViewTasks ? (
        <Suspense fallback={<SkeletonTable rows={2} />}>
          <RecordTasks context={context} parentType="opportunity" parentId={opportunity.id} title="Follow-up tasks" />
        </Suspense>
      ) : null}

      <CollaborationPanel parentType="opportunity" parentId={opportunity.id} />

      {opportunity.capabilities.canViewActivity ? (
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">Activity</h2>
          <Suspense fallback={<SkeletonTable rows={3} />}>
            <SalesActivityFeed
              context={context}
              entityType="Opportunity"
              entityId={opportunity.id}
            />
          </Suspense>
        </section>
      ) : null}
    </div>
  );
}
