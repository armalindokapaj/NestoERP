import type { Metadata } from "next";
import Link from "next/link";
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
    return { title: "Stock return" };
  }
}

/** One return (PRD #20 §123, §126, §127). */
export default async function ReturnPage({ params }: Params) {
  const { returnId } = await params;
  const context = await requireModule("inventory");

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
          { label: "Inventory", href: "/inventory" },
          { label: "Returns", href: "/inventory/returns" },
          { label: record.returnNumber },
        ]}
        title={record.returnNumber}
        subtitle={`Back into ${record.warehouse.name}`}
        status={record.status}
        badges={<Badge tone="info">{record.project.code}</Badge>}
        meta={[
          { label: "Returned", value: formatDate(record.returnDate) },
          { label: "Lines", value: String(record.lineCount) },
          { label: "Returned by", value: record.returnedBy ? <PersonLink memberId={record.returnedBy.memberId} name={record.returnedBy.fullName} /> : "—" },
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
          This is a draft. Posting is what puts the material back into stock.
        </p>
      ) : record.status === "POSTED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          Posted. A posted return is corrected by an adjustment rather than reversed — the
          material is physically back in the rack either way.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Lines</h2>
            <DocumentLinesTable lines={record.lines} caption={`Lines on ${record.returnNumber}`} />
          </section>

          {record.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{record.notes}</p>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: "From project",
                  value: (
                    <Link href={`/projects/${record.project.id}`} className="hover:text-accent">
                      {record.project.code} — {record.project.name}
                    </Link>
                  ),
                },
                { label: "Back into", value: record.warehouse.name },
                { label: "Drafted by", value: record.createdBy ? <PersonLink memberId={record.createdBy.memberId} name={record.createdBy.fullName} /> : "—" },
                { label: "Drafted", value: formatDateTime(record.createdAt) },
                { label: "Posted by", value: record.postedBy ? <PersonLink memberId={record.postedBy.memberId} name={record.postedBy.fullName} /> : "—" },
              ]}
            />
          </section>

          {record.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
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
