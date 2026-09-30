import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn, type TableSortConfig } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { formatFileSize } from "@/lib/modules/documents/document.files";
import type { DocumentSummaryDTO } from "@/lib/modules/documents/document.types";
import { formatDate } from "@/lib/utils/format";
import { contextLabel, fileTypeLabel, storageMessageLabel } from "@/lib/i18n/modules/documents/labels";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The Documents list (PRD #13 §71–§74, §176).
 *
 * ERP density rather than a consumer file grid. A related record is named only
 * when the reader is authorised to discover it — which the access clause has
 * already decided by the time a row exists here (PRD #13 §73).
 *
 * `group` is the Group workspace list (Workspace Context §45): a Company column
 * names whose file each row is, and every link to a company page — the file
 * itself, its related record — enters that company's workspace first.
 *
 * Column metadata (AUD-08 §5): the document name is the identity column (and
 * the company, in a group). Header sorts only where the page passes `sort`.
 */
export async function DocumentTable({
  documents,
  showStatus = false,
  group = false,
  listId = "documents.list",
  sort,
}: {
  documents: DocumentSummaryDTO[];
  showStatus?: boolean;
  group?: boolean;
  /** A nested use (a project's or client's Documents tab) names its own list (AUD-08 §5). */
  listId?: string;
  /** Header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const sortable = Boolean(sort);
  const t = await getTranslations("documents");
  const columns: TableColumn<DocumentSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      sortKey: sortable ? "name" : undefined,
      label: t("table.document"),
      primary: true,
      render: (document) => {
        const title = (
          <>
            <span className="block truncate">{document.name}</span>
            {/* An unspaced file name breaks instead of widening the phone card (AUD-04 §3, D-09-02, MW-01). */}
            {document.originalFileName && document.originalFileName !== document.name ? (
              <span className="block text-meta font-normal text-fg-subtle [overflow-wrap:anywhere]">
                {document.originalFileName}
              </span>
            ) : null}
            {/* A row can be ACTIVE and still have no downloadable file behind it.
                Saying so beats implying one is there (PRD #29 §162, §342). */}
            {document.storageMessage && document.storageStatus !== "ARCHIVED" ? (
              <span className="block text-meta font-normal text-warning-strong">
                {storageMessageLabel(t, document.storageStatus, document.storageMessage)}
              </span>
            ) : null}
          </>
        );
        // The table cannot link a group row itself: its own link would open the
        // file inside whichever company the session happens to be anchored in.
        return group && document.company ? (
          <CompanyRecordLink
            companyId={document.company.id}
            companyName={document.company.name}
            href={`/documents/${document.id}`}
            className="font-medium text-fg transition-colors hover:text-accent focus-visible:text-accent"
          >
            {title}
          </CompanyRecordLink>
        ) : (
          title
        );
      },
    },
    ...(group
      ? [
          {
            key: "company",
            id: "company",
            mandatory: true,
            label: t("table.company"),
            render: (document: DocumentSummaryDTO) =>
              document.company ? <CompanyTag name={document.company.name} /> : <span className="text-fg-subtle">—</span>,
          },
        ]
      : []),
    {
      key: "type",
      id: "type",
      sortKey: sortable ? "type" : undefined,
      label: t("table.type"),
      hideBelow: "md",
      render: (document) => <span className="text-fg-muted">{fileTypeLabel(t, document.typeLabel)}</span>,
    },
    {
      key: "context",
      id: "context",
      label: t("table.context"),
      hideBelow: "lg",
      render: (document) => <span className="text-fg-muted">{contextLabel(t, document.context.label)}</span>,
    },
    {
      key: "related",
      id: "related",
      label: t("table.related"),
      hideBelow: "xl",
      render: (document) =>
        document.context.relatedRecordName && document.context.relatedRecordHref ? (
          group && document.company ? (
            <CompanyRecordLink
              companyId={document.company.id}
              companyName={document.company.name}
              href={document.context.relatedRecordHref}
              className="text-fg-muted transition-colors hover:text-accent"
            >
              {document.context.relatedRecordName}
            </CompanyRecordLink>
          ) : (
            <Link
              href={document.context.relatedRecordHref}
              className="text-fg-muted transition-colors hover:text-accent"
            >
              {document.context.relatedRecordName}
            </Link>
          )
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "uploadedBy",
      id: "uploadedBy",
      label: t("table.uploadedBy"),
      hideBelow: "xl",
      render: (document) => (
        document.uploadedBy ? (
          <PersonLink memberId={document.uploadedBy.memberId} name={document.uploadedBy.fullName} />
        ) : (
          <span className="text-fg-muted">—</span>
        )
      ),
    },
    {
      key: "size",
      id: "size",
      valueType: "number",
      sortKey: sortable ? "size" : undefined,
      label: t("table.size"),
      hideBelow: "lg",
      align: "right",
      render: (document) => (
        <span className="text-fg-muted">
          {formatFileSize(document.sizeBytes === null ? null : Number(document.sizeBytes))}
        </span>
      ),
    },
    ...(showStatus
      ? [
          {
            key: "status",
            id: "status",
            mandatory: true,
            valueType: "status" as const,
            label: t("table.status"),
            render: (document: DocumentSummaryDTO) => <StatusBadge status={document.status} />,
          },
        ]
      : []),
    {
      key: "updated",
      id: "updated",
      valueType: "date",
      sortKey: sortable ? "updated" : undefined,
      label: t("table.updated"),
      hideBelow: "md",
      render: (document) => <span className="text-fg-muted">{formatDate(document.updatedAt)}</span>,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("table.caption")}
      columns={columns}
      records={documents}
      rowKey={(document) => document.id}
      // Phone (MOB-03 §47): a compact file row: name, type, where it belongs, when it changed.
      mobile={{
        variant: "row",
        facts: ["type", "context", "updated"],
        omit: showStatus ? ["status"] : [],
        status: showStatus ? (document) => <StatusBadge status={document.status} /> : undefined,
        label: (document) => [document.name, fileTypeLabel(t, document.typeLabel), formatDate(document.updatedAt)].join(", "),
      }}
      rowHref={group ? undefined : (document) => `/documents/${document.id}`}
    />
  );
}
