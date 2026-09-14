import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RecordDocuments } from "@/components/documents/record-documents";
import { Due, Facts, Panel, Person, Ref, ReviewBadge } from "@/components/engineering/engineering-ui";
import { LinksPanel } from "@/components/engineering/links-panel";
import { orNotFound } from "@/components/engineering/page-helpers";
import { CommandBar, EditDocumentButton } from "@/components/engineering/record-dialogs";
import { RevisionPanel } from "@/components/engineering/revision-panel";
import { Badge } from "@/components/ui/badge";
import { requireModule } from "@/lib/context/current-user";
import { getEngineeringDocument, projectEngineeringOptions } from "@/lib/modules/engineering/engineering.documents";
import { linkableTypesFor } from "@/lib/modules/engineering/engineering.links";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";
import { DISCIPLINE_LABELS, DOCUMENT_TYPE_LABELS, DRAWING_TYPES, LINKABLE_TYPES } from "@/lib/modules/engineering/engineering.types";

type Params = { params: Promise<{ projectId: string; documentId: string }> };

export const metadata: Metadata = { title: "Engineering document" };

/**
 * One register entry (PRD #46 §79, §171, §172): its revisions and reviews, the
 * RFIs, submittals and transmittals that mention it, linked work and its files.
 */
export default async function EngineeringDocumentPage({ params }: Params) {
  const { projectId, documentId } = await params;
  const context = await requireModule("engineering");
  const doc = await orNotFound(getEngineeringDocument(context, documentId));
  if (doc.projectId !== projectId) notFound();
  const [settings, options] = await Promise.all([resolveEngineeringSettings(context.companyId), doc.capabilities.canCreateTask ? projectEngineeringOptions(context, projectId, "engineering_document.review") : null]);
  const drawing = DRAWING_TYPES.includes(doc.documentType);
  const register = `/projects/${projectId}/engineering/${drawing ? "drawings" : "documents"}`;
  const closed = doc.status === "SUPERSEDED" || doc.status === "VOID";

  return (
    <div className="space-y-5" data-testid="engineering-document">
      <div className="space-y-3">
        <Link href={register} className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {drawing ? "Drawing register" : "Engineering documents"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-table text-fg-muted" data-testid="document-number">
              {doc.documentNumber}
              {doc.currentRevision ? <span className="ml-2 text-fg">Rev {doc.currentRevision.code}</span> : null}
            </p>
            <h2 className="mt-1 text-page font-semibold tracking-tight text-fg">{doc.title}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <ReviewBadge status={doc.overdue ? "OVERDUE" : doc.status} label={doc.overdue ? "Review overdue" : undefined} />
              <Badge tone="default">{DOCUMENT_TYPE_LABELS[doc.documentType]}</Badge>
              <Badge tone="default">{DISCIPLINE_LABELS[doc.discipline]}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {doc.capabilities.canEdit ? <EditDocumentButton projectId={projectId} document={{ id: doc.id, version: doc.version, documentNumber: doc.documentNumber, title: doc.title, documentType: doc.documentType, discipline: doc.discipline, contractorId: doc.contractor?.id ?? null, workPackageId: doc.workPackage?.id ?? null, authorText: doc.authorText, responsibleMemberId: doc.responsible?.id ?? null, reviewerMemberId: doc.reviewer?.id ?? null, reviewDueAt: doc.reviewDueAt }} /> : null}
            {doc.capabilities.canVoid ? (
              <CommandBar
                commands={[
                  {
                    url: `/api/engineering-documents/${doc.id}/void`,
                    label: "Retire",
                    success: "Document retired.",
                    variant: "ghost",
                    testId: "retire-document",
                    reason: { title: "Retire this document", description: "Mark it superseded by another number, or void a mistaken entry. Its revisions stay on the record.", confirmLabel: "Retire", extraFields: [{ name: "status", label: "Mark as", type: "select", required: true, options: [{ value: "SUPERSEDED", label: "Superseded" }, { value: "VOID", label: "Void" }] }] },
                  },
                ]}
              />
            ) : null}
          </div>
        </div>
        {closed ? (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-table text-warning-strong" data-testid="document-closed-banner">
            {doc.status === "SUPERSEDED" ? "Superseded — this document is kept for the record. Do not build from it." : "Void"}
            {doc.voidReason ? ` · ${doc.voidReason}` : ""}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <RevisionPanel kind="document" recordId={doc.id} recordType="engineering_document" revisions={doc.revisions} capabilities={doc.revisionCapabilities} canAddRevision={doc.capabilities.canAddRevision} canUploadFiles={doc.capabilities.canUploadFiles} zone={settings.timezone} />
          <LinksPanel apiBase={`/api/engineering-documents/${doc.id}`} links={doc.links} types={linkableTypesFor(context, LINKABLE_TYPES)} canLink={doc.capabilities.canLink} canCreateTask={doc.capabilities.canCreateTask} assignees={options?.members ?? []} />
          {doc.capabilities.canViewFiles ? (
            <Panel title="Files" description="Every file uploaded to this document. A file carried by a submitted revision is frozen.">
              <RecordDocuments context={context} entityType="engineering_document" entityId={doc.id} canAttach={doc.capabilities.canUploadFiles} emptyTitle="No files yet." emptyDescription="Upload a revision's file from the revisions panel." />
            </Panel>
          ) : null}
          <CollaborationPanel parentType="engineering_document" parentId={doc.id} />
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel title="Details">
            <Facts
              columns={2}
              items={[
                { label: "Contractor", value: <Ref value={doc.contractor} /> },
                { label: "Work package", value: <Ref value={doc.workPackage} /> },
                { label: "Author", value: doc.authorText },
                { label: "Responsible", value: <Person value={doc.responsible} fallback="—" /> },
                { label: "Reviewer", value: <Person value={doc.reviewer} /> },
                { label: "Review due", value: <Due date={doc.reviewDueAt} overdue={doc.overdue} /> },
              ]}
            />
          </Panel>
          <Panel title="Referenced by" testId="document-references">
            {doc.linkedRfis.length + doc.linkedSubmittals.length + doc.linkedTransmittals.length === 0 ? (
              <p className="text-table text-fg-muted">No RFI, submittal or transmittal mentions this document yet.</p>
            ) : (
              <div className="space-y-3 text-table">
                {[
                  { label: "RFIs", rows: doc.linkedRfis },
                  { label: "Submittals", rows: doc.linkedSubmittals },
                  { label: "Transmittals", rows: doc.linkedTransmittals },
                ]
                  .filter((group) => group.rows.length)
                  .map((group) => (
                    <div key={group.label}>
                      <h3 className="nesto-eyebrow mb-1 text-fg-subtle">{group.label}</h3>
                      <ul className="space-y-1">
                        {group.rows.map((row) => (
                          <li key={row.id}>
                            <Link href={row.href} className="text-fg underline-offset-4 hover:underline">
                              {row.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
