import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { formatFileSize } from "@/lib/modules/documents/document.files";
import type { DocumentSummaryDTO } from "@/lib/modules/documents/document.types";
import { formatDate } from "@/lib/utils/format";

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
 */
export function DocumentTable({
  documents,
  showStatus = false,
  group = false,
}: {
  documents: DocumentSummaryDTO[];
  showStatus?: boolean;
  group?: boolean;
}) {
  const columns: TableColumn<DocumentSummaryDTO>[] = [
    {
      key: "name",
      label: "Document",
      primary: true,
      render: (document) => {
        const title = (
          <>
            <span className="block truncate">{document.name}</span>
            {document.originalFileName && document.originalFileName !== document.name ? (
              <span className="block text-meta font-normal text-fg-subtle">
                {document.originalFileName}
              </span>
            ) : null}
            {/* A row can be ACTIVE and still have no downloadable file behind it.
                Saying so beats implying one is there (PRD #29 §162, §342). */}
            {document.storageMessage && document.storageStatus !== "ARCHIVED" ? (
              <span className="block text-meta font-normal text-warning-strong">
                {document.storageMessage}
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
            label: "Company",
            render: (document: DocumentSummaryDTO) =>
              document.company ? <CompanyTag name={document.company.name} /> : <span className="text-fg-subtle">—</span>,
          },
        ]
      : []),
    {
      key: "type",
      label: "Type",
      hideBelow: "md",
      render: (document) => <span className="text-fg-muted">{document.typeLabel}</span>,
    },
    {
      key: "context",
      label: "Context",
      hideBelow: "lg",
      render: (document) => <span className="text-fg-muted">{document.context.label}</span>,
    },
    {
      key: "related",
      label: "Related record",
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
      label: "Uploaded by",
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
      label: "Size",
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
            label: "Status",
            render: (document: DocumentSummaryDTO) => <StatusBadge status={document.status} />,
          },
        ]
      : []),
    {
      key: "updated",
      label: "Updated",
      hideBelow: "md",
      render: (document) => <span className="text-fg-muted">{formatDate(document.updatedAt)}</span>,
    },
  ];

  return (
    <DataTable
      caption="Documents"
      columns={columns}
      records={documents}
      rowKey={(document) => document.id}
      rowHref={group ? undefined : (document) => `/documents/${document.id}`}
    />
  );
}
