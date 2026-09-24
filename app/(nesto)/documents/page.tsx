import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ArrowRight, Files } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { DocumentSummaryDTO } from "@/lib/modules/documents/document.types";
import {
  getDocumentOverviewForWorkspace,
  listMyUploadsForWorkspace,
  listRecentForWorkspace,
  workspaceExperience,
} from "@/lib/modules/documents/document.workspace";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Documents" };

/**
 * Documents module overview (PRD #13 §9, §10).
 *
 * Counts are scoped: a reader is never told how many documents exist that they
 * cannot open (PRD #13 §10, §167). In the Group workspace they are the sum of
 * what each company lets this person open, and only the sections that answer
 * for the whole group are offered — archive and new documents belong to one
 * company (Workspace Context §35, §25).
 */
export default async function DocumentsOverviewPage() {
  const context = await requireModule("documents");
  const group = inGroupWorkspace(context);
  const experience = workspaceExperience(context, resolveModuleExperience(context, "documents"));

  const [stats, recent, mine] = await Promise.all([
    getDocumentOverviewForWorkspace(context),
    listRecentForWorkspace(context, 6),
    listMyUploadsForWorkspace(context, 6),
  ]);

  const cards = [
    { label: "Visible documents", value: stats.visible, href: "/documents/all" },
    { label: "Added this month", value: stats.addedThisMonth, href: "/documents/recent" },
    {
      label: "Project documents",
      value: stats.projectDocuments,
      href: "/documents/all?context=project",
    },
    ...(group ? [] : [{ label: "Archived", value: stats.archived, href: "/documents/archived" }]),
  ];

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        !group && can(context, "document.create") ? (
          <Button asChild size="sm">
            <Link href="/documents/new">Add document</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <div className={group ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"}>
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
            title={group ? "No accessible data for this module." : "No documents yet."}
            description="Documents you can access will appear here."
            action={
              !group && can(context, "document.create")
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

const LINK_CLASS = "block truncate text-table font-medium text-fg transition-colors hover:text-accent";

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
                {/* A row of the Group workspace names its company, and opening it
                    enters that company first (Workspace Context §31, §45). */}
                {document.company ? (
                  <CompanyRecordLink
                    companyId={document.company.id}
                    companyName={document.company.name}
                    href={`/documents/${document.id}`}
                    className={LINK_CLASS}
                  >
                    {document.name}
                  </CompanyRecordLink>
                ) : (
                  <Link href={`/documents/${document.id}`} className={LINK_CLASS}>
                    {document.name}
                  </Link>
                )}
                <p className="truncate text-meta text-fg-subtle">
                  {document.typeLabel} · {document.context.relatedRecordName ?? document.context.label}
                </p>
                {document.company ? <CompanyTag name={document.company.name} className="mt-1" /> : null}
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
