import type { Metadata } from "next";
import Link from "next/link";
import { RecordFavorite } from "@/components/productivity/record-favorite";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ContractActions } from "@/components/contracts/contract-actions";
import { ContractApprovalHistory } from "@/components/contracts/approval-history";
import { commercialLabel, expiryLabel } from "@/components/contracts/contract-format";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { RecordTasks } from "@/components/tasks/record-tasks";
import {
  contractTypeLabels,
} from "@/lib/modules/contracts/contracts/contract.schema";
import { renewalTypeLabels } from "@/lib/modules/contracts/contracts/contract.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { contractBreadcrumbs, contractContext } from "./contract-context";
import { ContractTabs } from "./contract-tabs";

type Params = { params: Promise<{ contractId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { contractId } = await params;
  try {
    const { contract } = await contractContext(contractId);
    return { title: `${contract.contractNumber} — ${contract.title}` };
  } catch {
    return { title: "Contract" };
  }
}

/**
 * Contract overview (PRD #18 §100–§103).
 *
 * Every section is permission-aware, and absence is how this module redacts: a
 * reader without `legal.commercial.view` gets `commercial: null` from the
 * service and therefore no Commercial card at all. A card with a blank money
 * row would tell them there is a figure they are not being shown, which is the
 * leak the permission exists to prevent (PRD #18 §255, §495).
 */
export default async function ContractOverviewPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);

  const may = contract.capabilities;
  const value = commercialLabel(contract.commercial);
  const readOnly =
    contract.archivedAt !== null ||
    contract.status === "TERMINATED" ||
    contract.status === "EXPIRED" ||
    contract.status === "CANCELLED";

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={contractBreadcrumbs(contract)}
        title={contract.title}
        subtitle={contract.contractNumber}
        status={contract.status}
        badges={
          <>
            <Badge tone="neutral">{contractTypeLabels[contract.contractType]}</Badge>
            {/* Attention badges are derived at read time, never stored (PRD #18 §102, §193). */}
            {contract.attention.expiringSoon ? <Badge tone="warning">Expiring soon</Badge> : null}
            {contract.attention.renewalNoticeDue ? (
              <Badge tone="warning">Renewal notice due</Badge>
            ) : null}
            {contract.attention.unsigned ? <Badge tone="info">Unsigned</Badge> : null}
            {contract.attention.readyToActivate ? (
              <Badge tone="info">Ready to activate</Badge>
            ) : null}
            {contract.attention.overdueObligations > 0 ? (
              <Badge tone="danger">
                {contract.attention.overdueObligations} overdue obligation
                {contract.attention.overdueObligations === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </>
        }
        meta={[
          {
            label: "Owner",
            value: (
              <span className="flex items-center gap-2">
                {contract.owner.fullName}
                {/* An inactive owner is a real operational problem, not cosmetic (PRD #18 §323). */}
                {contract.attention.ownerInactive ? <Badge tone="warning">Inactive</Badge> : null}
              </span>
            ),
          },
          {
            label: "Counterparty",
            value: orDash(contract.counterpartyName),
          },
          ...(value ? [{ label: "Value", value }] : []),
          { label: "Expiry", value: expiryLabel(contract.attention.daysToExpiry) },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="contract" entityId={contract.id} />
            <ContractActions contract={contract} />
          </>
        }
      />

      <ContractTabs contractId={contract.id} active="overview" capabilities={may} />

      {contract.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This contract is archived and read-only. Restore it to make changes.
        </p>
      ) : readOnly ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This contract is {contract.status.toLowerCase()} and its terms are read-only
          (PRD §499–§503).
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Commercial — omitted entirely without the grant (PRD #18 §22, §255). */}
          {contract.commercial ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Commercial</h2>
              <DetailGrid
                className="mt-4"
                items={[
                  { label: "Contract value", value: value ?? "—" },
                  { label: "Currency", value: orDash(contract.commercial.currency) },
                  ...(contract.commercialNotes
                    ? [
                        {
                          label: "Commercial notes",
                          value: (
                            <span className="whitespace-pre-wrap">{contract.commercialNotes}</span>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {contract.activeAmendment?.commercial ? (
                <p className="mt-4 border-t border-line pt-4 text-meta text-fg-subtle">
                  Includes amendment {contract.activeAmendment.amendmentNumber}.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Dates</h2>
            <DetailGrid
              className="mt-4"
              columns={3}
              items={[
                { label: "Effective", value: dateOrDash(contract.dates.effectiveDate) },
                { label: "Expiry", value: dateOrDash(contract.dates.expiryDate) },
                { label: "Signed", value: dateOrDash(contract.dates.signedDate) },
                { label: "Sent", value: dateOrDash(contract.dates.sentAt) },
                ...(contract.dates.terminationDate
                  ? [
                      {
                        label: "Terminated",
                        value: formatDate(contract.dates.terminationDate),
                      },
                    ]
                  : []),
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Renewal</h2>
            <DetailGrid
              className="mt-4"
              columns={3}
              items={[
                { label: "Type", value: renewalTypeLabels[contract.renewal.type] },
                {
                  label: "Notice",
                  value:
                    contract.renewal.noticeDays === null
                      ? "—"
                      : `${contract.renewal.noticeDays} days`,
                },
                {
                  label: "Renewal period",
                  value:
                    contract.renewal.autoRenewalPeriodMonths === null
                      ? "—"
                      : `${contract.renewal.autoRenewalPeriodMonths} months`,
                },
                {
                  label: "Alert date",
                  value: dateOrDash(contract.renewal.alertDate),
                },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Legal terms</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Governing law", value: orDash(contract.legal.governingLaw) },
                { label: "Jurisdiction", value: orDash(contract.legal.jurisdiction) },
              ]}
            />
            {contract.legal.summary ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="nesto-eyebrow text-fg-subtle">Summary</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg">
                  {contract.legal.summary}
                </p>
              </div>
            ) : null}
            {/* Null without `legal.confidential_terms.view` (PRD #18 §23, §257). */}
            {contract.legal.legalNotes ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="nesto-eyebrow text-fg-subtle">Legal notes</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg">
                  {contract.legal.legalNotes}
                </p>
              </div>
            ) : null}
            {contract.legal.terminationReason ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="nesto-eyebrow text-fg-subtle">Termination reason</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg">
                  {contract.legal.terminationReason}
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Approval history</h2>
            <ContractApprovalHistory approvals={contract.approvals} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Client &amp; project</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label="Client"
                value={<ModuleLink link={contract.clientLink} fallback="No client named" />}
              />
              <Meta
                label="Project"
                value={<ModuleLink link={contract.projectLink} fallback="No project attached" />}
              />
            </dl>
          </section>

          {/* Null without `legal.sales_source.view` plus the Sales grant (PRD #18 §252). */}
          {contract.salesSource ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Sales source</h2>
              <dl className="mt-4 space-y-3">
                <Meta
                  label="Opportunity"
                  value={
                    <ModuleLink link={contract.salesSource.opportunity} fallback="None" />
                  }
                />
                <Meta
                  label="Proposal"
                  value={<ModuleLink link={contract.salesSource.proposal} fallback="None" />}
                />
              </dl>
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">This contract</h2>
            <dl className="mt-4 space-y-3">
              {may.canViewParties ? (
                <Meta
                  label="Parties"
                  value={
                    <Link
                      href={`/contracts/${contract.id}/parties`}
                      className="text-fg transition-colors hover:text-accent"
                    >
                      {contract.counts.parties}
                    </Link>
                  }
                />
              ) : null}
              {may.canViewObligations ? (
                <Meta
                  label="Open obligations"
                  value={
                    <Link
                      href={`/contracts/${contract.id}/obligations`}
                      className="text-fg transition-colors hover:text-accent"
                    >
                      {contract.counts.openObligations}
                    </Link>
                  }
                />
              ) : null}
              {may.canViewAmendments ? (
                <Meta
                  label="Amendments"
                  value={
                    <Link
                      href={`/contracts/${contract.id}/amendments`}
                      className="text-fg transition-colors hover:text-accent"
                    >
                      {contract.counts.amendments}
                    </Link>
                  }
                />
              ) : null}
              {may.canViewDocuments ? (
                <Meta
                  label="Documents"
                  value={
                    <Link
                      href={`/contracts/${contract.id}/documents`}
                      className="text-fg transition-colors hover:text-accent"
                    >
                      {contract.counts.documents}
                    </Link>
                  }
                />
              ) : null}
            </dl>
          </section>

          {contract.activeAmendment ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Current amendment</h2>
                <Link
                  href={`/contracts/${contract.id}/amendments/${contract.activeAmendment.id}`}
                  className="text-table font-medium text-accent-strong"
                >
                  Open
                </Link>
              </div>
              <p className="mt-3 text-table font-medium text-fg">
                {contract.activeAmendment.amendmentNumber} — {contract.activeAmendment.title}
              </p>
              <p className="mt-1 text-meta text-fg-subtle">
                {contract.activeAmendment.status}
                {contract.activeAmendment.effectiveDate
                  ? ` · effective ${formatDate(contract.activeAmendment.effectiveDate)}`
                  : ""}
              </p>
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Created" value={formatDateTime(contract.createdAt)} />
              <Meta label="Updated" value={formatDateTime(contract.updatedAt)} />
              {contract.createdBy ? (
                <Meta label="Drafted by" value={contract.createdBy.fullName} />
              ) : null}
              {contract.archivedAt ? (
                <Meta label="Archived" value={formatDateTime(contract.archivedAt)} />
              ) : null}
            </dl>
          </section>
        </div>
      </div>
      {/* Follow-up work raised from this record, in the reader's task scope (PRD #38 §45). */}
      <RecordTasks context={context} parentType="contract" parentId={contractId} />
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="contract" parentId={contractId} />
    </div>
  );
}

/** A date, or a dash where there is no date to show. */
function dateOrDash(value: string | null): string {
  return value === null ? "—" : formatDate(value);
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}

/**
 * A cross-module link, or its name as plain text.
 *
 * `href` is null when the reader may see that the link exists but not open what
 * it points at — a dead link would be worse than a label (PRD #18 §496, §497).
 */
function ModuleLink({
  link,
  fallback,
}: {
  link: { id: string; label: string; href: string | null } | null;
  fallback: string;
}) {
  if (!link) return <span className="text-fg-subtle">{fallback}</span>;
  if (!link.href) return <span>{link.label}</span>;
  return (
    <Link href={link.href} className="text-accent-strong transition-colors hover:text-accent">
      {link.label}
    </Link>
  );
}
