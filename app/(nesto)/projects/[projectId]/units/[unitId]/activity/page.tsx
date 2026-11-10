import type { Metadata } from "next";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { localizeActivity } from "@/lib/i18n/system";
import { notFound } from "next/navigation";
import { History } from "@/components/icons";

import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import { listUnitActivity } from "@/lib/modules/project-structure/structure.service";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitPage.activityTitle") };
}

/** What happened to the unit, newest first (E-05D §48, §49). Audit evidence lives in the audit log. */
export default async function UnitActivityPage({ params }: Params) {
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  const t = await getTranslations("projects");
  const locale = await getLocale();
  if (!page.actions.canViewActivity) notFound();
  const activity = await listUnitActivity(page.context, page.unit.id, { limit: 100 });
  return (
    <UnitShell page={page} active="activity">
      {activity.items.length === 0 ? (
        <EmptyState icon={<History />} title={t("unitPage.nothingRecorded")} description={t("unitPage.activityBody")} />
      ) : (
        <ol className="nesto-card divide-y divide-line" data-testid="unit-activity">
          {activity.items.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
              <p className="min-w-0 text-table text-fg">
                {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("unitPage.somebody")}</span>} <span className="text-fg-muted">{localizeActivity(locale, entry) ?? entry.action}</span>
              </p>
              <time className="shrink-0 text-meta text-fg-subtle" dateTime={entry.createdAt}>
                {formatRelativeTime(entry.createdAt, locale)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </UnitShell>
  );
}
