import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { DocumentActions } from "@/components/inventory/document-actions";
import { TransferLinesTable } from "@/components/inventory/document-lines-table";
import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as transfers from "@/lib/modules/inventory/documents/transfer.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ transferId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { transferId } = await params;
  try {
    const context = await requireModule("inventory");
    const transfer = await transfers.getTransfer(context, transferId);
    return { title: transfer.transferNumber };
  } catch {
    const t = await getTranslations("inventory");
    return { title: t("meta.stockTransfer") };
  }
}

/** One transfer (PRD #20 §130, §315, §316). */
export default async function TransferPage({ params }: Params) {
  const { transferId } = await params;
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");

  let transfer;
  try {
    transfer = await transfers.getTransfer(context, transferId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.transfers"), href: "/inventory/transfers" },
          { label: transfer.transferNumber },
        ]}
        title={transfer.transferNumber}
        subtitle={`${transfer.fromWarehouse.name} → ${transfer.toWarehouse.name}`}
        status={transfer.status}
        meta={[
          { label: t("detail.transferred"), value: formatDate(transfer.transferDate) },
          { label: t("columns.lines"), value: String(transfer.lineCount) },
        ]}
        actions={
          <DocumentActions
            kind="transfers"
            documentId={transfer.id}
            documentNumber={transfer.transferNumber}
            capabilities={transfer.capabilities}
          />
        }
      />

      {transfer.status === "DRAFT" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("notice.transferDraft")}
        </p>
      ) : transfer.status === "REVERSED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("notice.transferReversed")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("documentForm.lines")}</h2>
            <TransferLinesTable
              lines={transfer.lines}
              caption={t("detail.linesOn", { number: transfer.transferNumber })}
            />
          </section>

          {transfer.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("fields.notes")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {transfer.notes}
              </p>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("detail.from"), value: transfer.fromWarehouse.name },
                { label: t("detail.to"), value: transfer.toWarehouse.name },
                { label: t("detail.draftedBy"), value: transfer.createdBy ? <PersonLink memberId={transfer.createdBy.memberId} name={transfer.createdBy.fullName} /> : "—" },
                { label: t("detail.drafted"), value: formatDateTime(transfer.createdAt) },
                { label: t("columns.postedBy"), value: transfer.postedBy ? <PersonLink memberId={transfer.postedBy.memberId} name={transfer.postedBy.fullName} /> : "—" },
              ]}
            />
          </section>

          {transfer.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("meta.activity")}</h2>
              <InventoryActivityFeed
                context={context}
                entityType="StockTransfer"
                entityId={transfer.id}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
