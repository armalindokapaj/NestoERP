import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { RecordFavorite } from "@/components/productivity/record-favorite";

import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocumentFilePanel } from "@/components/documents/document-file-panel";
import { DocumentVersions } from "@/components/documents/document-versions";
import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/modules/documents/document.files";
import * as documents from "@/lib/modules/documents/document.service";
import type { DocumentDetailDTO } from "@/lib/modules/documents/document.types";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { documentBreadcrumbs, loadDocument } from "./document-context";
import { contextLabel, documentsLabel, fileTypeLabel } from "@/lib/i18n/modules/documents/labels";
import type { Translate } from "@/lib/i18n/translator";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ documentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { documentId } = await params;
  try {
    const { document } = await loadDocument(documentId);
    return { title: document.name };
  } catch {
    return { title: (await getTranslations("documents"))("meta.document") };
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
  const t = await getTranslations("documents");

  const archived = document.archivedAt !== null || document.status === "ARCHIVED";
  const activity = document.capabilities.canViewActivity
    ? await documents.listActivity(context, documentId, { page: 1, limit: 5 })
    : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={documentBreadcrumbs(document, t("crumbs.documents"))}
        title={document.name}
        subtitle={document.file.originalFileName ?? undefined}
        status={document.status}
        badges={<Badge tone="neutral">{fileTypeLabel(t, document.file.typeLabel)}</Badge>}
        meta={[
          {
            label: t("detail.context"),
            value:
              document.context.relatedRecordName && document.context.relatedRecordHref ? (
                <Link
                  href={document.context.relatedRecordHref}
                  className="text-fg transition-colors hover:text-accent"
                >
                  {document.context.relatedRecordName}
                </Link>
              ) : (
                contextLabel(t, document.context.label)
              ),
          },
          {
            label: t("detail.uploadedBy"),
            value: document.uploadedBy ? <PersonLink memberId={document.uploadedBy.memberId} name={document.uploadedBy.fullName} /> : "—",
          },
          {
            label: t("detail.size"),
            value: formatFileSize(
              document.file.sizeBytes === null ? null : Number(document.file.sizeBytes),
            ),
          },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="document" entityId={document.id} />
            <DocumentActions document={document} />
          </>
        }
      />

      {archived ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("detail.archivedNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("detail.description")}</h2>
          {document.description ? (
            <p className="mt-3 whitespace-pre-wrap text-body text-fg-muted">
              {document.description}
            </p>
          ) : (
            <p className="mt-3 text-table text-fg-subtle">{t("detail.noDescription")}</p>
          )}

          <div className="mt-5 border-t border-line pt-5">
            <h3 className="text-table font-semibold text-fg">{t("detail.file")}</h3>
            <div className="mt-3">
              {/* Download and preview both ask the server for a short-lived
                  grant, so the access decision is made at the click with the
                  reader's current permissions (PRD #29 §100, §104). */}
              <DocumentFilePanel document={document} />
            </div>
          </div>
        </section>

        <div className="space-y-4 lg:col-span-2 lg:row-start-2">
          {/* Earlier files stay downloadable and reviewable; the current one is
              what the panel above serves (PRD #38 §56-§63). */}
          <DocumentVersions documentId={document.id} />
          <CollaborationPanel parentType="document" parentId={document.id} />
        </div>

        <div className="space-y-4 lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.file")}</h2>
            <DetailGrid
              className="mt-4 sm:grid-cols-1"
              items={[
                { label: t("detail.originalFileName"), value: orDash(document.file.originalFileName) },
                { label: t("detail.type"), value: fileTypeLabel(t, document.file.typeLabel) },
                { label: t("detail.mimeType"), value: orDash(document.file.mimeType) },
                {
                  label: t("detail.size"),
                  value: formatFileSize(
                    document.file.sizeBytes === null ? null : Number(document.file.sizeBytes),
                  ),
                },
                { label: t("detail.added"), value: formatDateTime(document.createdAt) },
                { label: t("detail.updated"), value: formatDateTime(document.updatedAt) },
                // The storage lifecycle, which is not the business status
                // (PRD #29 §2).
                { label: t("detail.storage"), value: storageLabel(t, document.file.storageStatus) },
                {
                  label: t("detail.checksum"),
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
                <h2 className="text-card font-semibold text-fg">{t("detail.activity")}</h2>
                <Link
                  href={`/documents/${document.id}/activity`}
                  className="text-table font-medium text-accent-strong"
                >
                  {t("detail.viewAll")}
                </Link>
              </div>
              {activity.data.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">{t("detail.noActivity")}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="text-table">
                      <p className="text-fg">
                        {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("detail.someone")}</span>}{" "}
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
function storageLabel(t: Translate<"documents">, status: DocumentDetailDTO["file"]["storageStatus"]): string {
  switch (status) {
    case "AVAILABLE":
    case "ARCHIVED":
    case "REJECTED":
    case "FAILED":
    case "SCANNING":
      return documentsLabel(t, "storage", status);
    default:
      return t("labels.storage.OTHER");
  }
}
