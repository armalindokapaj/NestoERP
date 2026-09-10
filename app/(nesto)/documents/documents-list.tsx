import { Files } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { DocumentTable } from "@/components/documents/document-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { fileTypeGroupLabels, FILE_TYPE_GROUPS } from "@/lib/modules/documents/document.files";
import {
  parseDocumentListQuery,
  type DocumentQueryDefaults,
} from "@/lib/modules/documents/document.query";
import { documentFilterOptions } from "@/lib/modules/documents/document.repository";
import * as documents from "@/lib/modules/documents/document.service";

type SearchParams = Record<string, string | string[] | undefined>;

export type DocumentListVariant = "all" | "recent" | "archived";

const VARIANT_DEFAULTS: Record<DocumentListVariant, DocumentQueryDefaults> = {
  all: {},
  recent: { sort: "updated-desc" },
  archived: { archived: true },
};

/**
 * The shared list body behind All Documents, Recent and Archived
 * (PRD #13 §68–§70).
 *
 * Filter options are supplied already narrowed to what the reader can
 * discover, so a Context dropdown never names Finance to somebody without
 * Finance access (PRD #13 §79, §231).
 */
export async function DocumentsList({
  context,
  searchParams,
  variant,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  variant: DocumentListVariant;
  basePath: string;
}) {
  const query = parseDocumentListQuery(searchParams, VARIANT_DEFAULTS[variant]);

  const [result, options] = await Promise.all([
    documents.listDocuments(context, query),
    documentFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.fileType?.length ||
      query.context?.length ||
      query.projectId ||
      query.clientId ||
      query.uploadedByMemberId ||
      query.dateFrom,
  );

  // Only the contexts this reader actually has documents in are offered.
  const contextOptions = [
    { value: "project", label: "Project" },
    ...(options.clients.length > 0 ? [{ value: "client", label: "Client" }] : []),
    ...(can(context, "task.view") ? [{ value: "task", label: "Task" }] : []),
    ...(can(context, "document.company.view")
      ? [{ value: "company", label: "Company" }]
      : []),
  ];

  const filters: FilterConfig[] = [
    {
      param: "fileType",
      label: "File type",
      options: (Object.keys(FILE_TYPE_GROUPS) as (keyof typeof FILE_TYPE_GROUPS)[]).map(
        (group) => ({ value: group, label: fileTypeGroupLabels[group] }),
      ),
    },
    { param: "context", label: "Context", options: contextOptions },
    {
      param: "projectId",
      label: "Project",
      options: options.projects.map((project) => ({ value: project.id, label: project.name })),
    },
    ...(options.clients.length > 0
      ? [
          {
            param: "clientId",
            label: "Client",
            options: options.clients.map((client) => ({ value: client.id, label: client.name })),
          },
        ]
      : []),
    {
      param: "uploadedBy",
      label: "Uploaded by",
      options: options.uploaders.map((member) => ({ value: member.id, label: member.name })),
    },
    {
      param: "date",
      label: "Added",
      options: [
        { value: "today", label: "Today" },
        { value: "7d", label: "Last 7 days" },
        { value: "30d", label: "Last 30 days" },
        { value: "year", label: "This year" },
      ],
    },
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search documents…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently added" },
          { value: "name-asc", label: "Name A–Z" },
          { value: "name-desc", label: "Name Z–A" },
          { value: "size-desc", label: "Largest" },
          { value: "size-asc", label: "Smallest" },
          { value: "type-asc", label: "File type" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Files />}
            title="No documents match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<Files />}
            title={EMPTY_TITLE[variant]}
            description={EMPTY_DESCRIPTION[variant]}
            action={
              variant !== "archived" && can(context, "document.create")
                ? { label: "Add document", href: "/documents/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <DocumentTable documents={result.data} showStatus={variant === "archived"} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}

/** Empty-state copy from PRD #13 §183–§185. */
const EMPTY_TITLE: Record<DocumentListVariant, string> = {
  all: "No documents yet.",
  recent: "No recent documents.",
  archived: "No archived documents.",
};

const EMPTY_DESCRIPTION: Record<DocumentListVariant, string> = {
  all: "Documents you can access will appear here.",
  recent: "Recently updated documents will appear here.",
  archived: "Documents removed from active lists will appear here.",
};
