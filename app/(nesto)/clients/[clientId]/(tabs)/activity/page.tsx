import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import * as clients from "@/lib/modules/clients/client.service";
import { formatDateTime } from "@/lib/utils/format";
import { loadClient } from "../../client-context";
import { listPageRedirect } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.activity") };
}

/**
 * Client history (PRD #12 §100–§102).
 *
 * Filtered to the modules this reader may see, so Finance activity about a
 * shared client never reaches somebody without Finance access (PRD #12 §102).
 */
export default async function ClientActivityPage({ params, searchParams }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewActivity) notFound();
  const t = await getTranslations("clients");

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await clients.listActivity(context, clientId, { page, limit: 25 });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/clients/${clientId}/activity`, query, activity.pagination.page));

  return (
    <div className="space-y-5">
      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t("activityPage.emptyTitle")}
          description={t("activityPage.emptyDescription")}
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("common.someone")}</span>}{" "}
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
                ? `/clients/${client.id}/activity?page=${next}`
                : `/clients/${client.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
