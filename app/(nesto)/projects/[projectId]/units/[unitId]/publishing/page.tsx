import type { Metadata } from "next";
import Link from "next/link";

import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { PublicationBadge, ReadinessPanel, UnpublishedChangesBadge } from "@/components/project-structure/unit-page/publication-badge";
import { listUnitPublications } from "@/lib/modules/project-structure/unit-publishing.service";
import { formatDateTime } from "@/lib/utils/format";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export const metadata: Metadata = { title: "Unit publishing" };

/**
 * Publishing: where the unit stands, what a reviewer needs to decide, and every
 * version ever published (E-05D §28, §45, §47, §50). The actions are in the
 * header, the same on every section of the unit.
 */
export default async function UnitPublishingPage({ params }: Params) {
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  const { context, unit, publishing } = page;
  const history = publishing.capabilities.canViewHistory ? await listUnitPublications(context, unit.id) : null;
  const base = `/projects/${unit.projectId}/units/${unit.id}`;
  const current = publishing.currentPublication;

  return (
    <UnitShell page={page} active="publishing">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-4">
          <section className="nesto-card p-5" aria-labelledby="publishing-state" data-testid="publishing-state">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="publishing-state" className="text-card font-semibold text-fg">
                Publishing
              </h2>
              <PublicationBadge status={publishing.status} versionNumber={current?.versionNumber} />
              {publishing.hasUnpublishedChanges ? <UnpublishedChangesBadge /> : null}
            </div>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: "Current version",
                  value: current ? (
                    <>
                      v{current.versionNumber} · {formatDateTime(current.publishedAt)}
                      {current.publishedBy ? <> · <PersonLink memberId={current.publishedByMemberId} name={current.publishedBy} /></> : null}
                    </>
                  ) : (
                    "Never published"
                  ),
                },
                { label: "Status since", value: publishing.statusChangedAt ? formatDateTime(publishing.statusChangedAt) : "—" },
                ...(publishing.pendingRequest
                  ? [
                      { label: "Submitted by", value: publishing.pendingRequest.submittedBy ? <PersonLink memberId={publishing.pendingRequest.submittedByMemberId} name={publishing.pendingRequest.submittedBy} /> : "—" },
                      { label: "Submitted", value: formatDateTime(publishing.pendingRequest.submittedAt) },
                    ]
                  : []),
              ]}
            />
            {publishing.hasUnpublishedChanges && current ? (
              <p className="mt-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong">
                The unit has changed since version {current.versionNumber}. Sales and other modules still see version {current.versionNumber} until the changes are published.
              </p>
            ) : null}
            {publishing.revisionReason ? (
              <div className="mt-4 rounded-md border border-line bg-surface-muted px-3 py-2" data-testid="revision-reason">
                <p className="nesto-eyebrow text-fg-subtle">Revision requested</p>
                <p className="mt-1 whitespace-pre-line text-table text-fg">{publishing.revisionReason}</p>
              </div>
            ) : null}
          </section>

          {history ? (
            <section className="nesto-card p-5" aria-labelledby="publication-history">
              <h2 id="publication-history" className="text-card font-semibold text-fg">
                Publication history
              </h2>
              {history.length === 0 ? (
                <p className="mt-3 text-table text-fg-muted">No version has been published yet.</p>
              ) : (
                <ol className="mt-3 divide-y divide-line" data-testid="publication-history">
                  {history.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-table">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={`${base}/publishing/${row.id}`} className="font-medium text-fg hover:underline">
                          v{row.versionNumber} Published
                        </Link>
                        {row.isCurrent ? <span className="text-meta font-medium text-success-strong">Current</span> : null}
                        <span className="text-fg-muted">{formatDateTime(row.publishedAt)}</span>
                        {row.publishedBy ? <span className="text-fg-muted">by <PersonLink memberId={row.publishedByMemberId} name={row.publishedBy} /></span> : null}
                      </span>
                      {row.salesPlanVersionNumber ? <span className="text-meta text-fg-subtle">Sales Plan v{row.salesPlanVersionNumber}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </div>

        {publishing.status === "ARCHIVED" ? null : <ReadinessPanel readiness={publishing.readiness} />}
      </div>
    </UnitShell>
  );
}
