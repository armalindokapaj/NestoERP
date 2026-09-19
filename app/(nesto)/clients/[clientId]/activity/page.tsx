import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import * as clients from "@/lib/modules/clients/client.service";
import { formatDateTime } from "@/lib/utils/format";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Client Activity" };

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

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await clients.listActivity(context, clientId, { page, limit: 25 });

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={clientBreadcrumbs(client, "Activity")}
        title={client.name}
        subtitle={client.code ?? undefined}
        status={client.status}
      />

      <ClientTabs
        clientId={client.id}
        active="activity"
        capabilities={client.capabilities}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No activity recorded yet."
          description="Changes to this client will be listed here."
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
                ? `/clients/${client.id}/activity?page=${next}`
                : `/clients/${client.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
