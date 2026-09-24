import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { dateLabel, Metric, MetricStrip, Panel, EmptyNote } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { NewDocumentButton, NewRfiButton, NewSubmittalButton } from "@/components/engineering/record-dialogs";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { projectEngineeringOverview } from "@/lib/modules/engineering/engineering.overview";
import { REVIEW_DECISION_LABELS } from "@/lib/modules/engineering/engineering.types";
import { cn } from "@/lib/utils/cn";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Engineering" };

/**
 * The project's engineering dashboard (PRD #46 §159, §165): what is open, what
 * is late, what came back, and what was decided lately — each number opening
 * the register behind it.
 */
export default async function ProjectEngineeringOverviewPage({ params }: Params) {
  const { projectId } = await params;
  const context = await requireModule("engineering");
  const overview = await orNotFound(projectEngineeringOverview(context, projectId));
  const base = `/projects/${projectId}/engineering`;
  const { counts } = overview;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-section font-semibold text-fg">Overview</h2>
        <div className="flex flex-wrap gap-2">
          {can(context, "rfi.create") ? <NewRfiButton projectId={projectId} /> : null}
          {can(context, "submittal.create") ? <NewSubmittalButton projectId={projectId} /> : null}
          {can(context, "engineering_document.create") ? <NewDocumentButton projectId={projectId} drawing /> : null}
        </div>
      </div>
      <MetricStrip>
        <Metric label="Open RFIs" value={counts.openRfis} href={`${base}/rfis?open=1`} testId="metric-open-rfis" />
        <Metric label="Overdue RFIs" value={counts.overdueRfis} tone="danger" href={`${base}/rfis?overdue=1`} testId="metric-overdue-rfis" />
        <Metric label="Submittals under review" value={counts.submittalsInReview} href={`${base}/submittals?inReview=1`} testId="metric-in-review" />
        <Metric label="Revision required" value={counts.revisionRequired} tone="warning" href={`${base}/submittals?status=REVISION_REQUIRED`} testId="metric-revision-required" />
        <Metric label="Approved this week" value={counts.approvedThisWeek} tone="success" testId="metric-approved" />
        <Metric label="Drawings awaiting review" value={counts.drawingsAwaitingReview} href={`${base}/drawings?awaitingReview=1`} testId="metric-drawings-awaiting" />
        <Metric label="Reviews overdue" value={counts.overdueReviews} tone="danger" testId="metric-overdue-reviews" />
        <Metric label="Compliance alerts" value={counts.complianceAlerts} tone="warning" href={`/projects/${projectId}/contractors`} testId="metric-compliance" />
      </MetricStrip>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <Panel title="Needs attention" description="Answers and reviews past their date, and submittals sent back." testId="engineering-attention">
          {overview.attention.length === 0 ? (
            <EmptyNote>Nothing on this project is late or sent back.</EmptyNote>
          ) : (
            <ul className="divide-y divide-line">
              {overview.attention.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="flex items-start gap-3 py-2.5">
                  <AlertTriangle aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", item.tone === "danger" ? "text-danger" : "text-warning")} />
                  <div className="min-w-0">
                    <Link href={item.href} className="text-table font-medium text-fg hover:underline">
                      {item.label}
                    </Link>
                    <p className="text-meta text-fg-muted">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent decisions" description="The latest reviews on drawings, documents and submittals.">
          {overview.recentDecisions.length === 0 ? (
            <EmptyNote>No reviews have been decided yet.</EmptyNote>
          ) : (
            <ul className="divide-y divide-line">
              {overview.recentDecisions.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    <Link href={item.href} className="truncate font-mono text-table text-fg hover:underline">
                      {item.label}
                    </Link>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={item.decision === "APPROVED" || item.decision === "APPROVED_WITH_COMMENTS" ? "success" : item.decision === "REJECTED" ? "danger" : "warning"}>{REVIEW_DECISION_LABELS[item.decision]}</Badge>
                    <span className="text-meta tabular-nums text-fg-subtle">{dateLabel(item.at.slice(0, 10))}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
