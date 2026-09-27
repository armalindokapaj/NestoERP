import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound, redirect } from "next/navigation";
import { Files } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { DocumentTable } from "@/components/documents/document-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import { firstValue, listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.documents") };
}

/**
 * Client documents (PRD #12 §96–§99, PRD #13 §198).
 *
 * Documents filed directly against the client. A generic `document.view` never
 * reaches a client this reader cannot open (PRD #12 §99).
 */
export default async function ClientDocumentsPage({ params, searchParams }: Params) {
  const { clientId } = await params;
  const raw = await searchParams;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewDocuments) notFound();
  const t = await getTranslations("clients");

  // Every document, a page of 100 at a time with a true count; it used to
  // show the first 100 and drop the rest silently (AUD-08 §4, DT-05).
  const page = Number.parseInt(firstValue(raw.page) ?? "1", 10);
  const query = documentListQuerySchema.parse({ clientId, limit: 100, page: Number.isFinite(page) && page > 0 ? page : 1 });
  const result = await documents.listDocuments(context, query);
  const basePath = `/clients/${clientId}/documents`;
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, raw, result.pagination.page));

  const archived = client.archivedAt !== null || client.status === "ARCHIVED";
  const canUpload = !archived && can(context, "document.create");
  const uploadHref = `/documents/new?clientId=${client.id}`;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={clientBreadcrumbs(client, t("tabs.documents"), t("meta.clients"))}
        title={client.name}
        subtitle={client.code ?? undefined}
        status={client.status}
        actions={
          canUpload ? (
            <Button asChild size="sm">
              <Link href={uploadHref}>{t("documentsPage.add")}</Link>
            </Button>
          ) : null
        }
      />

      <ClientTabs
        clientId={client.id}
        active="documents"
        capabilities={client.capabilities}
      />

      {result.data.length === 0 ? (
        <EmptyState
          icon={<Files />}
          title={t("documentsPage.emptyTitle")}
          description={t("documentsPage.emptyDescription")}
          action={canUpload ? { label: t("documentsPage.add"), href: uploadHref } : undefined}
        />
      ) : (
        <>
          <DocumentTable documents={result.data} listId="clients.documents" />
          <Pagination meta={result.pagination} buildHref={(next) => pageHref(basePath, raw, next)} />
        </>
      )}
    </div>
  );
}
