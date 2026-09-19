import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import { listUnitActivity } from "@/lib/modules/project-structure/structure.service";
import { formatRelativeTime } from "@/lib/utils/format";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export const metadata: Metadata = { title: "Unit activity" };

/** What happened to the unit, newest first (E-05D §48, §49). Audit evidence lives in the audit log. */
export default async function UnitActivityPage({ params }: Params) {
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  if (!page.actions.canViewActivity) notFound();
  const activity = await listUnitActivity(page.context, page.unit.id, { limit: 100 });
  return (
    <UnitShell page={page} active="activity">
      {activity.items.length === 0 ? (
        <EmptyState icon={<History />} title="Nothing recorded yet." description="Changes to this unit appear here as they happen." />
      ) : (
        <ol className="nesto-card divide-y divide-line" data-testid="unit-activity">
          {activity.items.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
              <p className="min-w-0 text-table text-fg">
                {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">Somebody</span>} <span className="text-fg-muted">{entry.message ?? entry.action}</span>
              </p>
              <time className="shrink-0 text-meta text-fg-subtle" dateTime={entry.createdAt}>
                {formatRelativeTime(entry.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </UnitShell>
  );
}
