import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import * as documents from "@/lib/modules/documents/document.service";
import { formatDateTime } from "@/lib/utils/format";
import { documentBreadcrumbs, loadDocument } from "../document-context";
import { listPageRedirect } from "@/lib/modules/shared/list-query";
import { getTranslations } from "@/lib/i18n/server";

type Params = {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents");
  return { title: t("meta.activity") };
}

/** Full document history (PRD #13 §118, §119). */
export default async function DocumentActivityPage({ params, searchParams }: Params) {
  const { documentId } = await params;
  const { context, document } = await loadDocument(documentId);

  if (!document.capabilities.canViewActivity) notFound();

  const query = await searchParams;
  const t = await getTranslations("documents");
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await documents.listActivity(context, documentId, { page, limit: 25 });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/documents/${documentId}/activity`, query, activity.pagination.page));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={documentBreadcrumbs(document, t("crumbs.documents"), t("crumbs.activity"))}
        title={document.name}
        subtitle={document.file.originalFileName ?? undefined}
        status={document.status}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t("detail.noActivity")}
          description={t("detail.activityHint")}
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("detail.someone")}</span>}{" "}
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
                ? `/documents/${document.id}/activity?page=${next}`
                : `/documents/${document.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
