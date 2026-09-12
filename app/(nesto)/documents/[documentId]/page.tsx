import type { Metadata } from "next";
import Link from "next/link";

import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocumentFilePanel } from "@/components/documents/document-file-panel";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/modules/documents/document.files";
import * as documents from "@/lib/modules/documents/document.service";
import type { DocumentDetailDTO } from "@/lib/modules/documents/document.types";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { documentBreadcrumbs, loadDocument } from "./document-context";

type Params = { params: Promise<{ documentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { documentId } = await params;
  try {
    const { document } = await loadDocument(documentId);
    return { title: document.name };
  } catch {
    return { title: "Document" };
  }
}

/**
 * Document detail (PRD #13 §101–§105).
 *
 * Preview and download both go through the authenticated route, so neither is
 * a way around the authorisation the page has already applied (PRD #13 §35).
 */
export default async function DocumentDetailPage({ params }: Params) {
  const { documentId } = await params;
  const { context, document } = await loadDocument(documentId);

  const archived = document.archivedAt !== null || document.status === "ARCHIVED";
  const activity = document.capabilities.canViewActivity
    ? await documents.listActivity(context, documentId, { page: 1, limit: 5 })
    : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={documentBreadcrumbs(document)}
        title={document.name}
        subtitle={document.file.originalFileName ?? undefined}
        status={document.status}
        badges={<Badge tone="neutral">{document.file.typeLabel}</Badge>}
        meta={[
          {
            label: "Context",
            value:
              document.context.relatedRecordName && document.context.relatedRecordHref ? (
                <Link
                  href={document.context.relatedRecordHref}
                  className="text-fg transition-colors hover:text-accent"
                >
                  {document.context.relatedRecordName}
                </Link>
              ) : (
                document.context.label
              ),
          },
          { label: "Uploaded by", value: document.uploadedBy?.fullName ?? "—" },
          {
            label: "Size",
            value: formatFileSize(
              document.file.sizeBytes === null ? null : Number(document.file.sizeBytes),
            ),
          },
        ]}
        actions={<DocumentActions document={document} />}
      />

      {archived ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          This document is archived and read-only. The file itself is kept — restore it to make
          changes.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Description</h2>
          {document.description ? (
            <p className="mt-3 whitespace-pre-wrap text-body text-fg-muted">
              {document.description}
            </p>
          ) : (
            <p className="mt-3 text-table text-fg-subtle">No description was added.</p>
          )}

          <div className="mt-5 border-t border-line pt-5">
            <h3 className="text-table font-semibold text-fg">File</h3>
            <div className="mt-3">
              {/* Download and preview both ask the server for a short-lived
                  grant, so the access decision is made at the click with the
                  reader's current permissions (PRD #29 §100, §104). */}
              <DocumentFilePanel document={document} />
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">File</h2>
            <DetailGrid
              className="mt-4 sm:grid-cols-1"
              items={[
                { label: "Original file name", value: orDash(document.file.originalFileName) },
                { label: "Type", value: document.file.typeLabel },
                { label: "MIME type", value: orDash(document.file.mimeType) },
                {
                  label: "Size",
                  value: formatFileSize(
                    document.file.sizeBytes === null ? null : Number(document.file.sizeBytes),
                  ),
                },
                { label: "Added", value: formatDateTime(document.createdAt) },
                { label: "Updated", value: formatDateTime(document.updatedAt) },
                // The storage lifecycle, which is not the business status
                // (PRD #29 §2).
                { label: "Storage", value: storageLabel(document.file.storageStatus) },
                {
                  label: "Checksum",
                  value: document.file.checksum ? (
                    <span className="font-mono text-meta">
                      {document.file.checksum.slice(0, 16)}…
                    </span>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </section>

          {activity ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Activity</h2>
                <Link
                  href={`/documents/${document.id}/activity`}
                  className="text-table font-medium text-accent-strong"
                >
                  View all
                </Link>
              </div>
              {activity.data.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">No activity recorded yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="text-table">
                      <p className="text-fg">
                        <span className="font-medium">{entry.actor ?? "Someone"}</span>{" "}
                        {entry.message ?? entry.action}
                      </p>
                      <p className="text-meta text-fg-subtle">{formatDateTime(entry.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The storage lifecycle in words, not an enum value (PRD #29 §162). */
function storageLabel(status: DocumentDetailDTO["file"]["storageStatus"]): string {
  switch (status) {
    case "AVAILABLE":
      return "Verified and available";
    case "ARCHIVED":
      return "Archived — file kept";
    case "REJECTED":
      return "Rejected";
    case "FAILED":
      return "Upload failed";
    case "SCANNING":
      return "Being checked";
    default:
      return "Processing";
  }
}
