import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { engineeringLabel } from "@/lib/i18n/modules/engineering/labels";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { RecordDocuments } from "@/components/documents/record-documents";
import { Facts, Panel, Ref, ReviewBadge, dateLabel } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { CommandBar, type CommandSpec } from "@/components/engineering/record-dialogs";
import { EditTransmittalButton } from "@/components/engineering/transmittal-editor";
import { PersonLink } from "@/components/people/person-link";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requireModule } from "@/lib/context/current-user";
import { getTransmittal } from "@/lib/modules/engineering/engineering.transmittals";
import { TRANSMITTAL_DIRECTION_LABELS, TRANSMITTAL_PURPOSE_LABELS } from "@/lib/modules/engineering/engineering.types";
import { prisma } from "@/lib/database/prisma";

type Params = { params: Promise<{ projectId: string; transmittalId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("transmittalPage.metaTitle") };
}

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
  const t = await getTranslations("engineering");
  const number = { number: item.transmittalNumber };
  const purpose = engineeringLabel(t, "purpose", item.purpose, TRANSMITTAL_PURPOSE_LABELS[item.purpose]);
  const draftItems = caps.canEditDraft ? await prisma.documentTransmittalItem.findMany({ where: { transmittalId: item.id }, orderBy: { sortOrder: "asc" }, select: { engineeringDocumentId: true, engineeringRevisionId: true, documentId: true, remarks: true } }) : [];
  const commands: CommandSpec[] = [
    ...(caps.canIssue ? [{ url: `/api/transmittals/${item.id}/issue`, label: t("transmittalPage.issue"), success: t("transmittalPage.issuedToast", number), variant: "primary" as const, testId: "issue-transmittal", confirm: { title: t("transmittalPage.issueTitle", number), description: t("transmittalPage.issueBody"), confirmLabel: t("transmittalPage.issueConfirm") } }] : []),
    ...(caps.canVoid ? [{ url: `/api/transmittals/${item.id}/void`, label: t("transmittalPage.void"), success: t("transmittalPage.voided", number), variant: "ghost" as const, testId: "void-transmittal", reason: { title: t("transmittalPage.voidTitle", number), description: t("transmittalPage.voidBody"), confirmLabel: t("transmittalPage.voidConfirm") } }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="transmittal-detail">
      <div className="space-y-3">
        <Link href={`/projects/${projectId}/engineering/transmittals`} className="inline-flex items-center gap-1.5 text-table text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("project.transmittals")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-table text-fg-muted">{item.transmittalNumber}</p>
            <h2 className="mt-1 text-page font-semibold tracking-tight text-fg">{item.subject ?? purpose}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <ReviewBadge status={item.status} testId="transmittal-status" />
              <span className="text-table text-fg-muted">
                {engineeringLabel(t, "direction", item.direction, TRANSMITTAL_DIRECTION_LABELS[item.direction])} · {purpose}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {caps.canEditDraft ? (
              <EditTransmittalButton
                projectId={projectId}
                transmittal={{ id: item.id, direction: item.direction, purpose: item.purpose, subject: item.subject, contractorId: item.contractor?.id ?? null, workPackageId: item.workPackage?.id ?? null, senderText: item.senderText, recipientText: item.recipientText, notes: item.notes, items: draftItems.map((row) => {
                    // Every item, a loose file or one without a revision included: the editor keeps what it cannot pick, and a save never drops it (AUD-09 §4, FV-05).
                    const shown = item.items.find((entry) => entry.document?.id === row.documentId);
                    return { engineeringDocumentId: row.engineeringDocumentId, engineeringRevisionId: row.engineeringRevisionId, documentId: row.documentId, remarks: row.remarks ?? "", label: shown?.document?.name ?? shown?.engineeringDocument?.label ?? t("transmittalPage.aFile") };
                  }) }}
              />
            ) : null}
            <CommandBar commands={commands} />
          </div>
        </div>
        {item.status === "VOID" ? <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">{t("ui.void")}{item.voidReason ? ` · ${item.voidReason}` : ""}</p> : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Panel title={t("transmittalPage.documents")} description={item.status === "DRAFT" ? t("transmittalPage.documentsDraftBody") : t("transmittalPage.documentsIssuedBody")} testId="transmittal-items">
            {item.items.length === 0 ? (
              <p className="text-table text-fg-muted">{t("transmittalPage.noDocuments")}</p>
            ) : (
              <Table flush label={t("transmittalPage.tableLabel")}>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell scope="col">{t("columns.document")}</TableHeaderCell>
                    <TableHeaderCell scope="col">{t("columns.revision")}</TableHeaderCell>
                    <TableHeaderCell scope="col">{t("columns.file")}</TableHeaderCell>
                    <TableHeaderCell scope="col">{t("columns.remarks")}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {item.items.map((row) => (
                    <TableRow key={row.id} data-testid="transmittal-item">
                      <TableCell>
                        <Ref value={row.engineeringDocument} fallback={t("transmittalPage.document")} />
                      </TableCell>
                      <TableCell className="font-mono">{row.revisionCode ? t("ui.rev", { code: row.revisionCode }) : "—"}</TableCell>
                      <TableCell>
                        {row.document ? (
                          <Link href={row.document.href} className="text-fg underline-offset-4 hover:underline">
                            {row.document.name}
                          </Link>
                        ) : (
                          <span className="text-fg-subtle">{t("transmittalPage.notAvailable")}</span>
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
            <Panel title={t("transmittalPage.coverLetter")} description={t("transmittalPage.coverLetterBody")}>
              <RecordDocuments context={context} entityType="transmittal" entityId={item.id} emptyTitle={t("transmittalPage.noCoverLetter")} emptyDescription={t("transmittalPage.optional")} />
            </Panel>
          ) : null}
        </div>
        <aside>
          <Panel title={t("details.details")}>
            <Facts
              columns={2}
              items={[
                { label: t("details.from"), value: item.senderText },
                { label: t("details.to"), value: item.recipientText },
                { label: t("details.contractor"), value: <Ref value={item.contractor} /> },
                { label: t("details.workPackage"), value: <Ref value={item.workPackage} /> },
                { label: t("details.issued"), value: item.issuedAt ? dateLabel(item.issuedAt) : t("details.notIssued") },
                { label: t("details.issuedBy"), value: item.issuedBy ? <PersonLink memberId={item.issuedBy.id} name={item.issuedBy.name} /> : null },
              ]}
            />
            {item.notes ? <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-table text-fg-muted">{item.notes}</p> : null}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
