import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Files } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { DocumentTable } from "@/components/documents/document-table";
import { CredentialWorklist } from "@/components/hr/credential-worklist";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import { CREDENTIAL_WORKLIST_VIEWS } from "@/lib/modules/hr/credentials/credential.types";
import { getCredentialWorklist } from "@/lib/modules/hr/credentials/credential.worklist";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "HR documents" };

/**
 * HR documents (PRD #16 §128–§135).
 *
 * The canonical Documents module, filtered to `module: "hr"`. Filtering narrows
 * what is listed; it never widens it — each row is reachable because the reader
 * can reach the record it is filed against, and the parent-access resolver
 * fails closed for anything else (PRD #16 §205).
 *
 * HR also finds its credential worklists here (E-02 §153, §154): what waits
 * to be verified, what runs out within 30 days, what has run out.
 */
export default async function HrDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hr");

  if (!can(context, "hr.document.view") && !can(context, "hr.self.documents")) {
    redirect("/access-denied");
  }

  const experience = resolveModuleExperience(context, "hr");
  const params = await searchParams;
  const pageValue = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const requested = typeof params.view === "string" ? params.view : undefined;
  // One read gives the counts on the chips, the views this reader has, and the rows of the one asked for.
  const lists = await getCredentialWorklist(context, requested);
  const showing = lists && requested && lists.view === requested ? lists : null;
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={experience}
      activeSection="documents"
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href="/documents?module=hr">All documents</Link>
        </Button>
      }
    >
      <div className="space-y-4">
        {lists ? (
          <nav aria-label="Document views" className="flex flex-wrap gap-2" data-testid="hr-document-views">
            <Link href="/hr/documents" className={chip(!showing)} aria-current={!showing ? "page" : undefined}>
              Files
            </Link>
            {CREDENTIAL_WORKLIST_VIEWS.filter((entry) => lists.views.includes(entry.key)).map((entry) => (
              <Link key={entry.key} href={`/hr/documents?view=${entry.key}`} className={chip(showing?.view === entry.key)} aria-current={showing?.view === entry.key ? "page" : undefined} data-view={entry.key}>
                {entry.label}
                <span className="ml-1.5 tabular-nums text-fg-subtle">{lists.counts[entry.key]}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        {showing ? (
          <CredentialWorklist data={showing} />
        ) : (
          <Suspense fallback={<SkeletonTable rows={8} />}>
            <HrDocumentList context={context} page={page} />
          </Suspense>
        )}
      </div>
    </ModulePage>
  );
}

async function HrDocumentList({ context, page }: { context: UserContext; page: number }) {
  const query = documentListQuerySchema.parse({ moduleKey: "hr", page, limit: 25 });
  const result = await documents.listDocuments(context, query);

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No HR documents in your view."
        description="Employment contracts, certificates and sick notes are filed against the record they belong to."
      />
    );
  }

  return (
    <div className="space-y-4">
      <DocumentTable documents={result.data} />
      <Pagination
        meta={result.pagination}
        buildHref={(next) => (next > 1 ? `/hr/documents?page=${next}` : "/hr/documents")}
      />
    </div>
  );
}
