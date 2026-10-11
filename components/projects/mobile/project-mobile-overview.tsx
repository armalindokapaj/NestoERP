import Link from "@/components/navigation/nav-link";
import { AlertCircle, Box, CalendarPlus, CheckSquare, ClipboardList, FilePlus2, type LucideIcon } from "lucide-react";

import { getTranslations } from "@/lib/i18n/server";
import type { ProjectMobileSummary, ProjectWorkItem } from "@/lib/modules/projects/project-workspace.service";

export type ProjectQuickAction = { key: "task" | "document" | "siteDiary" | "meeting"; href: string };

const ACTION_ICONS: Record<ProjectQuickAction["key"], LucideIcon> = { task: CheckSquare, document: FilePlus2, siteDiary: ClipboardList, meeting: CalendarPlus };
const ACTION_LABELS = { task: "newTask", document: "addDocument", siteDiary: "siteDiary", meeting: "newMeeting" } as const;

/**
 * The phone's answer to "what is happening in this project right now?" (MOB-05 §28-§36).
 *
 * Phones only (`sm:hidden`); the desktop hero and cards stay as they are. It
 * shows what already exists and adds nothing: the counters come from the task
 * and unit owners through one summary read, "requires attention" from the same
 * approval and overdue-task states the lists use — each item links to that
 * list, filtered — and progress is the plan's own, absent when the plan has none
 * (§35). A quick action is a link to the canonical create form with this
 * project already chosen (§31), offered only to someone who may create.
 */
export async function ProjectMobileOverview({
  projectId,
  progress,
  summary,
  myWork,
  quickActions,
  threeDUrl,
}: {
  projectId: string;
  progress: number | null;
  summary: ProjectMobileSummary;
  myWork: ProjectWorkItem[];
  quickActions: ProjectQuickAction[];
  threeDUrl: string | null;
}) {
  const t = await getTranslations("projects");
  const approvals = myWork.find((item) => item.key === "approvals");

  const attention: Array<{ key: string; label: string; href: string }> = [];
  if (summary.overdueTasks) attention.push({ key: "overdue", label: t("mobile.overdueTasks", { count: summary.overdueTasks }), href: `/projects/${projectId}/tasks?due=overdue` });
  if (approvals && approvals.count > 0) {
    attention.push({ key: "approvals", label: approvals.partial ? t("mobile.approvalsPendingAtLeast", { count: approvals.count }) : t("mobile.approvalsPending", { count: approvals.count }), href: approvals.href });
  }

  const metrics: Array<{ key: string; label: string; value: string; href?: string }> = [];
  if (progress !== null) metrics.push({ key: "progress", label: t("mobile.progress"), value: `${progress}%`, href: `/projects/${projectId}/planning` });
  if (summary.units !== null) metrics.push({ key: "units", label: t("mobile.units"), value: summary.units.toLocaleString("en-US"), href: `/projects/${projectId}/units` });
  if (summary.openTasks !== null) metrics.push({ key: "openTasks", label: t("mobile.openTasks"), value: summary.openTasks.toLocaleString("en-US"), href: `/projects/${projectId}/tasks` });

  return (
    <div className="space-y-6 sm:hidden" data-testid="project-mobile-overview">
      {threeDUrl ? (
        <Link href={threeDUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-table font-semibold text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="project-mobile-3d">
          <Box aria-hidden="true" className="size-4" />
          {t("mobile.view3d")}
        </Link>
      ) : null}

      {quickActions.length ? (
        <section aria-labelledby="pm-actions">
          <h2 id="pm-actions" className="text-meta font-semibold uppercase tracking-[0.14em] text-fg-subtle">{t("mobile.quickActions")}</h2>
          <ul className="mt-2 grid grid-cols-2 gap-2" data-testid="project-quick-actions">
            {quickActions.map((action) => {
              const Icon = ACTION_ICONS[action.key];
              return (
                <li key={action.key}>
                  <Link href={action.href} className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-table font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Icon aria-hidden="true" className="size-4 text-fg-muted" />
                    {t(`mobile.${ACTION_LABELS[action.key]}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="pm-attention" className="nesto-card p-4">
        <h2 id="pm-attention" className="text-card font-semibold text-fg">{t("mobile.attentionTitle")}</h2>
        {attention.length ? (
          <ul className="mt-2 divide-y divide-line" data-testid="project-attention">
            {attention.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="flex min-h-11 items-center gap-3 py-2 text-table text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-warning-strong" />
                  <span className="min-w-0 flex-1">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-table text-fg-subtle">{t("mobile.attentionNone")}</p>
        )}
      </section>

      {metrics.length ? (
        <section aria-labelledby="pm-metrics">
          <h2 id="pm-metrics" className="text-meta font-semibold uppercase tracking-[0.14em] text-fg-subtle">{t("mobile.metricsTitle")}</h2>
          <dl className="mt-2 grid grid-cols-3 gap-2" data-testid="project-metrics">
            {metrics.map((metric) => (
              <div key={metric.key} className="rounded-xl border border-line bg-surface p-3">
                <dt className="truncate text-meta text-fg-subtle">{metric.label}</dt>
                <dd className="mt-1 text-card font-semibold tabular-nums text-fg">{metric.href ? <Link href={metric.href} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{metric.value}</Link> : metric.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
