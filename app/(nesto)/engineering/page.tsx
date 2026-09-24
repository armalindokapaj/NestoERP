import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { Due, EmptyNote, Metric, MetricStrip, Panel } from "@/components/engineering/engineering-ui";
import { RfiRegister } from "@/components/engineering/registers";
import { ModulePage } from "@/components/modules/module-page";
import { Badge } from "@/components/ui/badge";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { myEngineeringWork } from "@/lib/modules/engineering/engineering.overview";

export const metadata: Metadata = { title: "Engineering" };

/**
 * My engineering work (PRD #46 §278): the RFIs waiting for my answer, the
 * reviews assigned to me, and the answered RFIs I raised that are waiting to be
 * closed — across every project I can open.
 */
export default async function EngineeringPage() {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const work = await myEngineeringWork(context);
  return (
    <ModulePage experience={experience} activeSection="overview" title="My engineering work" description="What is waiting on you across your projects: answers, reviews and RFIs to close.">
      <div className="space-y-6">
        <MetricStrip>
          <Metric label="RFIs to answer" value={work.counts.assignedRfis} href="/engineering/rfis?assignee=me&open=1" testId="my-rfis" />
          <Metric label="Answers overdue" value={work.counts.overdueRfis} tone="danger" />
          <Metric label="Reviews assigned" value={work.counts.reviews} testId="my-reviews" />
          <Metric label="Reviews overdue" value={work.counts.overdueReviews} tone="danger" />
        </MetricStrip>
        <Panel title="RFIs waiting for your answer" testId="my-rfis-panel">
          <RfiRegister items={work.assignedRfis} showProject showAssignee={false} emptyTitle="No RFI is waiting for your answer." />
        </Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
          <Panel title="Reviews assigned to you" description="Submittals and engineering documents with you." testId="my-reviews-panel">
            {work.reviews.length === 0 ? (
              <EmptyNote>Nothing is waiting for your review.</EmptyNote>
            ) : (
              <ul className="divide-y divide-line">
                {work.reviews.map((item) => (
                  <li key={`${item.kind}:${item.id}`} className="flex items-center justify-between gap-3 py-2.5 text-table" data-testid="my-review">
                    <div className="min-w-0">
                      <Link href={item.href} className="text-table font-medium text-fg hover:underline">
                        <span className="font-mono">{item.number}</span>
                        {item.revisionCode ? <span className="font-mono text-fg-muted"> Rev {item.revisionCode}</span> : null} · {item.title}
                      </Link>
                      <p className="text-meta text-fg-muted">
                        {item.kind === "submittal" ? "Submittal" : "Engineering document"} · {item.projectName}
                      </p>
                    </div>
                    <Due date={item.dueAt} overdue={item.overdue} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Answered — ready to close" description="RFIs you raised that have their answer.">
            {work.toClose.length === 0 ? (
              <EmptyNote>No answered RFI is waiting for you to close it.</EmptyNote>
            ) : (
              <ul className="divide-y divide-line">
                {work.toClose.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={row.href} className="min-w-0 truncate text-table text-fg hover:underline">
                      <span className="font-mono">{row.rfiNumber}</span> · {row.subject}
                    </Link>
                    <Badge tone="info">Answered</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </ModulePage>
  );
}
