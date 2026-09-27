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
import { invoiceBreadcrumbs, loadInvoice } from "../invoice-context";
import { FinanceRecordTabs } from "../record-tabs";

type Params = {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Invoice activity" };

/** The invoice's own history (PRD #15 §193). */
export default async function InvoiceActivityPage({ params, searchParams }: Params) {
  const { invoiceId } = await params;
  const { context, invoice } = await loadInvoice(invoiceId);

  if (!invoice.capabilities.canViewActivity) notFound();

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await listRecordActivity(context, "Invoice", invoiceId, { page, limit: 25 });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/finance/invoices/${invoice.id}/activity`, query, activity.pagination.page));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={invoiceBreadcrumbs(invoice, "Activity")}
        title={invoice.invoiceNumber}
        subtitle={invoice.client.name}
        status={invoice.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/invoices/${invoice.id}`}
        active="activity"
        show={{ documents: invoice.capabilities.canViewDocuments, activity: true }}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No activity recorded yet."
          description="Changes to this invoice will be listed here."
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
                ? `/finance/invoices/${invoice.id}/activity?page=${next}`
                : `/finance/invoices/${invoice.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
