import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DocumentActions } from "@/components/inventory/document-actions";
import { DocumentLinesTable } from "@/components/inventory/document-lines-table";
import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { InventoryRecordDocuments } from "@/components/inventory/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as issues from "@/lib/modules/inventory/documents/issue.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ issueId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { issueId } = await params;
  try {
    const context = await requireModule("inventory");
    const issue = await issues.getIssue(context, issueId);
    return { title: issue.issueNumber };
  } catch {
    return { title: "Stock issue" };
  }
}

/** One issue (PRD #20 §105, §312, §314). */
export default async function IssuePage({ params }: Params) {
  const { issueId } = await params;
  const context = await requireModule("inventory");

  let issue;
  try {
    issue = await issues.getIssue(context, issueId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Issues", href: "/inventory/issues" },
          { label: issue.issueNumber },
        ]}
        title={issue.issueNumber}
        subtitle={issue.warehouse.name}
        status={issue.status}
        badges={
          issue.project ? (
            <Badge tone="info">{issue.project.code}</Badge>
          ) : (
            <Badge tone="neutral">General issue</Badge>
          )
        }
        meta={[
          { label: "Issued", value: formatDate(issue.issueDate) },
          { label: "Lines", value: String(issue.lineCount) },
          { label: "Issued to", value: issue.issuedTo ? <PersonLink memberId={issue.issuedTo.memberId} name={issue.issuedTo.fullName} /> : "—" },
        ]}
        actions={
          <DocumentActions
            kind="issues"
            documentId={issue.id}
            documentNumber={issue.issueNumber}
            capabilities={issue.capabilities}
          />
        }
      />

      {issue.status === "DRAFT" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This is a draft. Stock is unchanged until it is posted, and posting refuses any line
          without enough available stock behind it.
        </p>
      ) : issue.status === "REVERSED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This issue has been reversed and the material is back in stock. The original movements
          stay on the ledger.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-card font-semibold text-fg">Lines</h2>
            <DocumentLinesTable lines={issue.lines} caption={`Lines on ${issue.issueNumber}`} />
          </section>

          {issue.notes ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{issue.notes}</p>
            </section>
          ) : null}

          {issue.capabilities.canViewDocuments ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Documents</h2>
              <InventoryRecordDocuments
                context={context}
                entityType="stock_issue"
                entityId={issue.id}
                emptyDescription="Signed dockets and site paperwork filed against this issue appear here."
              />
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
                  label: "Project",
                  value: issue.project ? (
                    <Link
                      href={`/projects/${issue.project.id}`}
                      className="hover:text-accent"
                    >
                      {issue.project.code} — {issue.project.name}
                    </Link>
                  ) : (
                    "Not charged to a project"
                  ),
                },
                { label: "Warehouse", value: issue.warehouse.name },
                { label: "Requested by", value: issue.requestedBy ? <PersonLink memberId={issue.requestedBy.memberId} name={issue.requestedBy.fullName} /> : "—" },
                { label: "Drafted by", value: issue.createdBy ? <PersonLink memberId={issue.createdBy.memberId} name={issue.createdBy.fullName} /> : "—" },
                { label: "Drafted", value: formatDateTime(issue.createdAt) },
                { label: "Posted by", value: issue.postedBy ? <PersonLink memberId={issue.postedBy.memberId} name={issue.postedBy.fullName} /> : "—" },
              ]}
            />
          </section>

          {issue.capabilities.canViewActivity ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Activity</h2>
              <InventoryActivityFeed
                context={context}
                entityType="StockIssue"
                entityId={issue.id}
              />
            </section>
          ) : null}
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="stock_issue" parentId={issueId} />
    </div>
  );
}
