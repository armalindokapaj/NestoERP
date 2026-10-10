import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ContractApprovalHistory } from "@/components/contracts/approval-history";
import { commercialLabel } from "@/components/contracts/contract-format";
import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { renewalTypeLabels } from "@/lib/modules/contracts/contracts/contract.status";
import { formatDate, formatDateTime, orDash } from "@/lib/utils/format";
import { contractContext } from "../contract-context";
import { contractsLabel } from "@/lib/i18n/modules/contracts/labels";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ contractId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { contractId } = await params;
  try {
    const { contract } = await contractContext(contractId);
    return { title: `${contract.contractNumber} — ${contract.title}` };
  } catch {
    const t = await getTranslations("contracts");
    return { title: t("meta.contract") };
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
  const t = await getTranslations("contracts");
  const may = contract.capabilities;
  const value = commercialLabel(contract.commercial, t);
  const readOnly =
    contract.archivedAt !== null ||
    contract.status === "TERMINATED" ||
    contract.status === "EXPIRED" ||
    contract.status === "CANCELLED";

  return (
    <div className="space-y-5">
      {contract.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("detail.archivedNotice")}
        </p>
      ) : readOnly ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("detail.readOnlyNotice", {
            status: contractsLabel(t, "contractStatus", contract.status, contract.status).toLowerCase(),
          })}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Commercial — omitted entirely without the grant (PRD #18 §22, §255). */}
          {contract.commercial ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("detail.commercial")}</h2>
              <DetailGrid
                className="mt-4"
                items={[
                  { label: t("detail.contractValue"), value: value ?? "—" },
                  { label: t("detail.currency"), value: orDash(contract.commercial.currency) },
                  ...(contract.commercialNotes
                    ? [
                        {
                          label: t("detail.commercialNotes"),
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
                  {t("detail.includesAmendment", { number: contract.activeAmendment.amendmentNumber })}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.dates")}</h2>
            <DetailGrid
              className="mt-4"
              columns={3}
              items={[
                { label: t("detail.effective"), value: dateOrDash(contract.dates.effectiveDate) },
                { label: t("detail.expiry"), value: dateOrDash(contract.dates.expiryDate) },
                { label: t("detail.signed"), value: dateOrDash(contract.dates.signedDate) },
                { label: t("detail.sent"), value: dateOrDash(contract.dates.sentAt) },
                ...(contract.dates.terminationDate
                  ? [
                      {
                        label: t("detail.terminated"),
                        value: formatDate(contract.dates.terminationDate),
                      },
                    ]
                  : []),
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.renewal")}</h2>
            <DetailGrid
              className="mt-4"
              columns={3}
              items={[
                { label: t("detail.type"), value: contractsLabel(t, "renewalType", contract.renewal.type, renewalTypeLabels[contract.renewal.type]) },
                {
                  label: t("detail.notice"),
                  value:
                    contract.renewal.noticeDays === null
                      ? "—"
                      : t("detail.noticeDays", { count: contract.renewal.noticeDays }),
                },
                {
                  label: t("detail.renewalPeriod"),
                  value:
                    contract.renewal.autoRenewalPeriodMonths === null
                      ? "—"
                      : t("detail.months", { count: contract.renewal.autoRenewalPeriodMonths }),
                },
                {
                  label: t("detail.alertDate"),
                  value: dateOrDash(contract.renewal.alertDate),
                },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.legalTerms")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("detail.governingLaw"), value: orDash(contract.legal.governingLaw) },
                { label: t("detail.jurisdiction"), value: orDash(contract.legal.jurisdiction) },
              ]}
            />
            {contract.legal.summary ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="nesto-eyebrow text-fg-subtle">{t("detail.summary")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg">
                  {contract.legal.summary}
                </p>
              </div>
            ) : null}
            {/* Null without `legal.confidential_terms.view` (PRD #18 §23, §257). */}
            {contract.legal.legalNotes ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="nesto-eyebrow text-fg-subtle">{t("detail.legalNotes")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg">
                  {contract.legal.legalNotes}
                </p>
              </div>
            ) : null}
            {contract.legal.terminationReason ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="nesto-eyebrow text-fg-subtle">{t("detail.terminationReason")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg">
                  {contract.legal.terminationReason}
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("detail.approvalHistory")}</h2>
            <ContractApprovalHistory approvals={contract.approvals} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.clientProject")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta
                label={t("detail.client")}
                value={<ModuleLink link={contract.clientLink} fallback={t("detail.noClient")} />}
              />
              <Meta
                label={t("detail.project")}
                value={<ModuleLink link={contract.projectLink} fallback={t("detail.noProject")} />}
              />
            </dl>
          </section>

          {/* Null without `legal.sales_source.view` plus the Sales grant (PRD #18 §252). */}
          {contract.salesSource ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("detail.salesSource")}</h2>
              <dl className="mt-4 space-y-3">
                <Meta
                  label={t("detail.opportunity")}
                  value={
                    <ModuleLink link={contract.salesSource.opportunity} fallback={t("detail.none")} />
                  }
                />
                <Meta
                  label={t("detail.proposal")}
                  value={<ModuleLink link={contract.salesSource.proposal} fallback={t("detail.none")} />}
                />
              </dl>
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.thisContract")}</h2>
            <dl className="mt-4 space-y-3">
              {may.canViewParties ? (
                <Meta
                  label={t("detail.parties")}
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
                  label={t("detail.openObligations")}
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
                  label={t("detail.amendments")}
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
                  label={t("detail.documents")}
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
                <h2 className="text-card font-semibold text-fg">{t("detail.currentAmendment")}</h2>
                <Link
                  href={`/contracts/${contract.id}/amendments/${contract.activeAmendment.id}`}
                  className="text-table font-medium text-accent-strong"
                >
                  {t("detail.open")}
                </Link>
              </div>
              <p className="mt-3 text-table font-medium text-fg">
                {contract.activeAmendment.amendmentNumber} — {contract.activeAmendment.title}
              </p>
              <p className="mt-1 text-meta text-fg-subtle">
                {contract.activeAmendment.status}
                {contract.activeAmendment.effectiveDate
                  ? t("detail.effectiveOn", { date: formatDate(contract.activeAmendment.effectiveDate) })
                  : ""}
              </p>
            </section>
          ) : null}

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("detail.created")} value={formatDateTime(contract.createdAt)} />
              <Meta label={t("detail.updated")} value={formatDateTime(contract.updatedAt)} />
              {contract.createdBy ? (
                <Meta label={t("detail.draftedBy")} value={<PersonLink memberId={contract.createdBy.memberId} name={contract.createdBy.fullName} />} />
              ) : null}
              {contract.archivedAt ? (
                <Meta label={t("detail.archived")} value={formatDateTime(contract.archivedAt)} />
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
