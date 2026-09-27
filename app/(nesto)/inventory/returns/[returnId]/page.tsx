import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { DocumentActions } from "@/components/inventory/document-actions";
import { DocumentLinesTable } from "@/components/inventory/document-lines-table";
import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as returns from "@/lib/modules/inventory/documents/return.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ returnId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { returnId } = await params;
  try {
    const context = await requireModule("inventory");
    const record = await returns.getReturn(context, returnId);
    return { title: record.returnNumber };
  } catch {
    const t = await getTranslations("inventory");
    return { title: t("meta.stockReturn") };
  }
}

/** One return (PRD #20 §123, §126, §127). */
export default async function ReturnPage({ params }: Params) {
  const { returnId } = await params;
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");

  let record;
  try {
    record = await returns.getReturn(context, returnId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.returns"), href: "/inventory/returns" },
          { label: record.returnNumber },
        ]}
        title={record.returnNumber}
        subtitle={t("detail.backInto", { name: record.warehouse.name })}
        status={record.status}
        badges={<Badge tone="info">{record.project.code}</Badge>}
        meta={[
          { label: t("detail.returned"), value: formatDate(record.returnDate) },
          { label: t("columns.lines"), value: String(record.lineCount) },
          { label: t("fields.returnedBy"), value: record.returnedBy ? <PersonLink memberId={record.returnedBy.memberId} name={record.returnedBy.fullName} /> : "—" },
        ]}
        actions={
          <DocumentActions
            kind="returns"
            documentId={record.id}
            documentNumber={record.returnNumber}
            capabilities={record.capabilities}
          />
        }
      />

      {record.status === "DRAFT" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("notice.returnDraft")}
        </p>
      ) : record.status === "POSTED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("notice.returnPosted")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">{t("documentForm.lines")}</h2>
            <DocumentLinesTable lines={record.lines} caption={t("detail.linesOn", { number: record.returnNumber })} />
          </section>

          {record.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("fields.notes")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{record.notes}</p>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("fields.fromProject"),
                  value: (
                    <Link href={`/projects/${record.project.id}`} className="hover:text-accent">
                      {record.project.code} — {record.project.name}
                    </Link>
                  ),
                },
                { label: t("columns.backInto"), value: record.warehouse.name },
                { label: t("detail.draftedBy"), value: record.createdBy ? <PersonLink memberId={record.createdBy.memberId} name={record.createdBy.fullName} /> : "—" },
                { label: t("detail.drafted"), value: formatDateTime(record.createdAt) },
                { label: t("columns.postedBy"), value: record.postedBy ? <PersonLink memberId={record.postedBy.memberId} name={record.postedBy.fullName} /> : "—" },
              ]}
            />
          </section>

          {record.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("meta.activity")}</h2>
              <InventoryActivityFeed
                context={context}
                entityType="StockReturn"
                entityId={record.id}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
