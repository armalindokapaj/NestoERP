import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Files } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as documents from "@/lib/modules/documents/document.service";
import type { DocumentSummaryDTO } from "@/lib/modules/documents/document.types";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Documents" };

/**
 * Documents module overview (PRD #13 §9, §10).
 *
 * Counts are scoped: a reader is never told how many documents exist that they
 * cannot open (PRD #13 §10, §167).
 */
export default async function DocumentsOverviewPage() {
  const context = await requireModule("documents");
  const experience = resolveModuleExperience(context, "documents");

  const [stats, recent, mine] = await Promise.all([
    documents.getDocumentOverview(context),
    documents.listRecent(context, 6),
    documents.listMyUploads(context, 6),
  ]);

  const cards = [
    { label: "Visible documents", value: stats.visible, href: "/documents/all" },
    { label: "Added this month", value: stats.addedThisMonth, href: "/documents/recent" },
    {
      label: "Project documents",
      value: stats.projectDocuments,
      href: "/documents/all?context=project",
    },
    { label: "Archived", value: stats.archived, href: "/documents/archived" },
  ];

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "document.create") ? (
          <Button asChild size="sm">
            <Link href="/documents/new">Add document</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="nesto-card p-4 transition-colors hover:border-line-strong"
            >
              <p className="text-table text-fg-muted">{card.label}</p>
              <p className="mt-2 text-page font-semibold tabular-nums text-fg">{card.value}</p>
            </Link>
          ))}
        </div>

        {recent.length === 0 ? (
          <EmptyState
            icon={<Files />}
            title="No documents yet."
            description="Documents you can access will appear here."
            action={
              can(context, "document.create")
                ? { label: "Add document", href: "/documents/new" }
                : undefined
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <DocumentPanel title="Recent documents" href="/documents/recent" documents={recent} />
            <DocumentPanel
              title="Your recent uploads"
              href="/documents/all?mine=true"
              documents={mine}
              emptyMessage="You have not uploaded anything yet."
            />
          </div>
        )}
      </div>
    </ModulePage>
  );
}

function DocumentPanel({
  title,
  href,
  documents: rows,
  emptyMessage = "Nothing to show yet.",
}: {
  title: string;
  href: string;
  documents: DocumentSummaryDTO[];
  emptyMessage?: string;
}) {
  return (
    <section className="nesto-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
        >
          All documents
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyMessage}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((document) => (
            <li
              key={document.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
            >
              <div className="min-w-0">
                <Link
                  href={`/documents/${document.id}`}
                  className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                >
                  {document.name}
                </Link>
                <p className="truncate text-meta text-fg-subtle">
                  {document.typeLabel} · {document.context.relatedRecordName ?? document.context.label}
                </p>
              </div>
              <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                {formatDate(document.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
