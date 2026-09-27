import { redirect } from "next/navigation";
import { Files } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { DocumentTable } from "@/components/documents/document-table";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { fileTypeGroupLabels, FILE_TYPE_GROUPS } from "@/lib/modules/documents/document.files";
import {
  parseDocumentListQuery,
  type DocumentQueryDefaults,
} from "@/lib/modules/documents/document.query";
import { DOCUMENT_SORT_KEYS } from "@/lib/modules/documents/document.schema";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
import { documentsLabel } from "@/lib/i18n/modules/documents/labels";
import { getTranslations } from "@/lib/i18n/server";
import {
  documentFilterOptionsForWorkspace,
  listDocumentCompanies,
  listDocumentsForWorkspace,
  resolveDocumentReaders,
} from "@/lib/modules/documents/document.workspace";

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
 *
 * In the Group workspace the list is every company's documents this person may
 * read, each row carrying its company, with a Company filter to narrow it —
 * a filter, not the workspace (Workspace Context §35, §45, §87). What the
 * reader may do is asked of each company they read, never of the session's home
 * company alone.
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
  const group = inGroupWorkspace(context);
  const t = await getTranslations("documents");

  // The company workspace's own context, or one per company the group reads.
  const readers = await resolveDocumentReaders(context);
  const [result, options, companies] = await Promise.all([
    listDocumentsForWorkspace(context, query),
    documentFilterOptionsForWorkspace(context, query.companyId),
    listDocumentCompanies(context),
  ]);
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, searchParams, result.pagination.page));

  const hasFilters = Boolean(
    (group && query.companyId) ||
      query.search ||
      query.fileType?.length ||
      query.context?.length ||
      query.projectId ||
      query.clientId ||
      query.uploadedByMemberId ||
      query.datePreset ||
      query.dateFrom ||
      query.dateTo,
  );

  // Only the contexts this reader actually has documents in are offered.
  const contextOptions = [
    { value: "project", label: t("list.project") },
    ...(options.clients.length > 0 ? [{ value: "client", label: t("list.client") }] : []),
    ...(readers.some((reader) => can(reader, "task.view")) ? [{ value: "task", label: t("list.task") }] : []),
    ...(readers.some((reader) => can(reader, "document.company.view"))
      ? [{ value: "company", label: t("list.company") }]
      : []),
  ];

  const filters: FilterConfig[] = [
    // The Group workspace's company filter: only companies this person reads
    // are offered, and one company has nothing to narrow (§86, §87).
    ...(group && companies.length > 1
      ? [{ param: "company", label: t("list.company"), options: companies.map((company) => ({ value: company.id, label: company.name })) }]
      : []),
    {
      param: "fileType",
      label: t("list.fileType"),
      options: (Object.keys(FILE_TYPE_GROUPS) as (keyof typeof FILE_TYPE_GROUPS)[]).map(
        (group) => ({ value: group, label: documentsLabel(t, "fileType", group, fileTypeGroupLabels[group]) }),
      ),
    },
    { param: "context", label: t("list.context"), options: contextOptions },
    {
      param: "projectId",
      label: t("list.project"),
      options: options.projects.map((project) => ({ value: project.id, label: project.name })),
    },
    ...(options.clients.length > 0
      ? [
          {
            param: "clientId",
            label: t("list.client"),
            options: options.clients.map((client) => ({ value: client.id, label: client.name })),
          },
        ]
      : []),
    {
      param: "uploadedBy",
      label: t("list.uploadedBy"),
      options: options.uploaders.map((member) => ({ value: member.id, label: member.name })),
    },
    {
      param: "date",
      label: t("list.added"),
      options: [
        { value: "today", label: t("list.today") },
        { value: "7d", label: t("list.last7") },
        { value: "30d", label: t("list.last30") },
        { value: "year", label: t("list.thisYear") },
      ],
    },
  ];

  const buildHref = (page: number) => pageHref(basePath, searchParams, page);
  // Clear filters drops only this list's filter and search keys; the sort and
  // any other route key stay (AUD-08 §3).
  const cleared = clearListFilters(pageHref("", searchParams, 1).slice(1), ["search", "fileType", "context", "projectId", "clientId", "uploadedBy", "company", "date", "dateFrom", "dateTo"]);
  const clearHref = cleared ? `${basePath}?${cleared}` : basePath;

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("list.search")}
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: t("list.sortUpdated") },
          { value: "created-desc", label: t("list.sortCreated") },
          { value: "name-asc", label: t("list.sortNameAsc") },
          { value: "name-desc", label: t("list.sortNameDesc") },
          { value: "size-desc", label: t("list.sortLargest") },
          { value: "size-asc", label: t("list.sortSmallest") },
          { value: "type-asc", label: t("list.sortType") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Files />}
            title={t("list.noMatch")}
            description={t("list.adjustFilters")}
            action={{ label: t("list.clearFilters"), href: clearHref }}
          />
        ) : (
          <EmptyState
            icon={<Files />}
            title={group ? t("overview.noAccessibleData") : t(EMPTY_TITLE[variant])}
            description={t(EMPTY_DESCRIPTION[variant])}
            action={
              !group && variant !== "archived" && can(context, "document.create")
                ? { label: t("overview.addDocument"), href: "/documents/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <DocumentTable documents={result.data} showStatus={variant === "archived"} group={group} sort={{ value: query.sort, keys: DOCUMENT_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}

/** Empty-state copy from PRD #13 §183–§185. */
const EMPTY_TITLE = {
  all: "list.emptyAll",
  recent: "list.emptyRecent",
  archived: "list.emptyArchived",
} as const satisfies Record<DocumentListVariant, string>;

const EMPTY_DESCRIPTION = {
  all: "list.emptyAllText",
  recent: "list.emptyRecentText",
  archived: "list.emptyArchivedText",
} as const satisfies Record<DocumentListVariant, string>;
