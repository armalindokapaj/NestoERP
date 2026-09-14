import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { RecordDocuments } from "@/components/documents/record-documents";
import { Facts, Panel, Ref, ReviewBadge, dateLabel } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { CommandBar, type CommandSpec } from "@/components/engineering/record-dialogs";
import { EditTransmittalButton } from "@/components/engineering/transmittal-editor";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requireModule } from "@/lib/context/current-user";
import { getTransmittal } from "@/lib/modules/engineering/engineering.transmittals";
import { TRANSMITTAL_DIRECTION_LABELS, TRANSMITTAL_PURPOSE_LABELS } from "@/lib/modules/engineering/engineering.types";
import { prisma } from "@/lib/database/prisma";

type Params = { params: Promise<{ projectId: string; transmittalId: string }> };

export const metadata: Metadata = { title: "Transmittal" };

/**
 * One transmittal (PRD #46 §118-§124, §292): its purpose and parties, and each
 * document with the revision and file version it carried. A draft is edited
 * and issued; an issued one is fixed, and a mistake is voided and reissued.
 */
export default async function TransmittalPage({ params }: Params) {
  const { projectId, transmittalId } = await params;
  const context = await requireModule("engineering");
  const item = await orNotFound(getTransmittal(context, transmittalId));
  if (item.projectId !== projectId) notFound();
  const caps = item.capabilities;
  const draftItems = caps.canEditDraft ? await prisma.documentTransmittalItem.findMany({ where: { transmittalId: item.id }, orderBy: { sortOrder: "asc" }, select: { engineeringDocumentId: true, engineeringRevisionId: true, documentId: true, remarks: true } }) : [];
  const commands: CommandSpec[] = [
    ...(caps.canIssue ? [{ url: `/api/transmittals/${item.id}/issue`, label: "Issue", success: `${item.transmittalNumber} issued.`, variant: "primary" as const, testId: "issue-transmittal", confirm: { title: `Issue ${item.transmittalNumber}`, description: "Its documents and the file versions they carry are fixed from now on.", confirmLabel: "Issue transmittal" } }] : []),
    ...(caps.canVoid ? [{ url: `/api/transmittals/${item.id}/void`, label: "Void", success: `${item.transmittalNumber} voided.`, variant: "ghost" as const, testId: "void-transmittal", reason: { title: `Void ${item.transmittalNumber}`, description: "A voided transmittal stays on the register. Issue a new one to correct it.", confirmLabel: "Void transmittal" } }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="transmittal-detail">
      <div className="space-y-3">
        <Link href={`/projects/${projectId}/engineering/transmittals`} className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Transmittals
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-table text-fg-muted">{item.transmittalNumber}</p>
            <h2 className="mt-1 text-page font-semibold tracking-tight text-fg">{item.subject ?? TRANSMITTAL_PURPOSE_LABELS[item.purpose]}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <ReviewBadge status={item.status} testId="transmittal-status" />
              <span className="text-table text-fg-muted">
                {TRANSMITTAL_DIRECTION_LABELS[item.direction]} · {TRANSMITTAL_PURPOSE_LABELS[item.purpose]}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {caps.canEditDraft ? (
              <EditTransmittalButton
                projectId={projectId}
                transmittal={{ id: item.id, direction: item.direction, purpose: item.purpose, subject: item.subject, contractorId: item.contractor?.id ?? null, workPackageId: item.workPackage?.id ?? null, senderText: item.senderText, recipientText: item.recipientText, notes: item.notes, items: draftItems.filter((row) => row.engineeringDocumentId && row.engineeringRevisionId).map((row) => ({ engineeringDocumentId: row.engineeringDocumentId!, engineeringRevisionId: row.engineeringRevisionId!, documentId: row.documentId, remarks: row.remarks ?? "" })) }}
              />
            ) : null}
            <CommandBar commands={commands} />
          </div>
        </div>
        {item.status === "VOID" ? <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">Void{item.voidReason ? ` · ${item.voidReason}` : ""}</p> : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Panel title="Documents" description={item.status === "DRAFT" ? "What will travel when it is issued." : "What travelled, with the revision and file version each carried."} testId="transmittal-items">
            {item.items.length === 0 ? (
              <p className="text-table text-fg-muted">No documents yet. Edit the draft to add them.</p>
            ) : (
              <Table flush>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell scope="col">Document</TableHeaderCell>
                    <TableHeaderCell scope="col">Revision</TableHeaderCell>
                    <TableHeaderCell scope="col">File</TableHeaderCell>
                    <TableHeaderCell scope="col">Remarks</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {item.items.map((row) => (
                    <TableRow key={row.id} data-testid="transmittal-item">
                      <TableCell>
                        <Ref value={row.engineeringDocument} fallback="Document" />
                      </TableCell>
                      <TableCell className="font-mono">{row.revisionCode ? `Rev ${row.revisionCode}` : "—"}</TableCell>
                      <TableCell>
                        {row.document ? (
                          <Link href={row.document.href} className="text-fg underline-offset-4 hover:underline">
                            {row.document.name}
                          </Link>
                        ) : (
                          <span className="text-fg-subtle">Not available to you</span>
                        )}
                        {row.versionNumber ? <span className="ml-1.5 text-meta text-fg-subtle">v{row.versionNumber}</span> : null}
                      </TableCell>
                      <TableCell className="text-fg-muted">{row.remarks ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
          {item.status === "DRAFT" ? (
            <Panel title="Cover letter" description="Attach a cover letter while the transmittal is a draft.">
              <RecordDocuments context={context} entityType="transmittal" entityId={item.id} emptyTitle="No cover letter." emptyDescription="Optional." />
            </Panel>
          ) : null}
        </div>
        <aside>
          <Panel title="Details">
            <Facts
              columns={2}
              items={[
                { label: "From", value: item.senderText },
                { label: "To", value: item.recipientText },
                { label: "Contractor", value: <Ref value={item.contractor} /> },
                { label: "Work package", value: <Ref value={item.workPackage} /> },
                { label: "Issued", value: item.issuedAt ? dateLabel(item.issuedAt) : "Not issued" },
                { label: "Issued by", value: item.issuedBy?.name },
              ]}
            />
            {item.notes ? <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-table text-fg-muted">{item.notes}</p> : null}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
