import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import { listRecordActivity } from "@/lib/modules/finance/finance.activity";
import { listPageRedirect } from "@/lib/modules/shared/list-query";
import { formatDateTime } from "@/lib/utils/format";
import {
  commitmentBreadcrumbs,
  commitmentLabel,
  loadCommitment,
} from "../commitment-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";

type Params = {
  params: Promise<{ commitmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Commitment activity" };

export default async function CommitmentActivityPage({ params, searchParams }: Params) {
  const { commitmentId } = await params;
  const { context, commitment } = await loadCommitment(commitmentId);

  if (!commitment.capabilities.canViewActivity) notFound();

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await listRecordActivity(context, "Commitment", commitmentId, {
    page,
    limit: 25,
  });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/finance/commitments/${commitment.id}/activity`, query, activity.pagination.page));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={commitmentBreadcrumbs(commitment, "Activity")}
        title={commitmentLabel(commitment)}
        status={commitment.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/commitments/${commitment.id}`}
        active="activity"
        show={{ documents: commitment.capabilities.canViewDocuments, activity: true }}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No activity recorded yet."
          description="Changes to this commitment will be listed here."
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">Someone</span>}{" "}
                  {entry.message ?? entry.action}
                </p>
                <p className="mt-0.5 text-meta text-fg-subtle">
                  {formatDateTime(entry.createdAt)}
                </p>
              </li>
            ))}
          </ol>
          <Pagination
            meta={activity.pagination}
            buildHref={(next) =>
              next > 1
                ? `/finance/commitments/${commitment.id}/activity?page=${next}`
                : `/finance/commitments/${commitment.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
