import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { PriorityBadge } from "@/components/modules/status-badge";
import { Button } from "@/components/ui/button";
import { ListSectionSkeleton, StatCardsSkeleton } from "@/components/modules/section-skeletons";
import { SectionBoundary } from "@/components/modules/page-section";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { testSectionDelay } from "@/lib/workspace/shell-slots";
import {
  priorityTasksForWorkspace,
  taskExperience,
  taskOverviewForWorkspace,
} from "@/lib/modules/tasks/task.workspace";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("meta.tasks") };
}

/**
 * Tasks module overview (PRD #11 §7, §8).
 *
 * This is the module's own dashboard, not the personal one at /dashboard: it
 * describes the work in view, scoped to what this user may see. Every counter
 * is a link, because a number nobody can drill into is decoration
 * (PRD #11 §92, §141).
 *
 * In the Group workspace the counters and the priority list are the sum and the
 * union of every company the person may open Tasks in, each priority task
 * naming its company; a task opens through its company (Workspace Context §32).
 *
 * The guard, tabs and New task render first; the counters and Your week share
 * one overview read, Priority work has its own, and each arrives in its own
 * section with its own empty state (NAV-03 STREAM-02, STREAM-04).
 */
export default async function TasksOverviewPage() {
  const context = await requireModule("tasks");
  const t = await getTranslations("tasks");
  const experience = taskExperience(context);
  const group = inGroupWorkspace(context);
  const canCreate = !group && can(context, "task.create");

  // One overview promise for the counters and Your week; Priority work on its own (NAV-03 S05).
  const stats = taskOverviewForWorkspace(context);
  const priority = priorityTasksForWorkspace(context, 6);
  for (const promise of [stats, priority]) promise.catch(() => undefined);

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        canCreate ? (
          <Button asChild size="sm">
            <Link href="/tasks/new">{t("common.newTask")}</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <SectionBoundary className="nesto-card">
          <Suspense fallback={<StatCardsSkeleton count={4} />}>
            <TaskStats stats={stats} />
          </Suspense>
        </SectionBoundary>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionBoundary className="nesto-card">
            <Suspense fallback={<ListSectionSkeleton title={t("overview.priorityWork")} rows={6} />}>
              <PriorityWork priority={priority} />
            </Suspense>
          </SectionBoundary>
          <SectionBoundary className="nesto-card">
            <Suspense fallback={<ListSectionSkeleton title={t("overview.yourWeek")} rows={3} />}>
              <YourWeek stats={stats} />
            </Suspense>
          </SectionBoundary>
        </div>
      </div>
    </ModulePage>
  );
}

type Overview = ReturnType<typeof taskOverviewForWorkspace>;

async function TaskStats({ stats }: { stats: Overview }) {
  // Test builds only: the delay-isolation evidence holds this optional section (S01).
  await testSectionDelay("tasks-stats");
  const value = await stats;
  const t = await getTranslations("tasks");
  const cards = [
    { key: "open", label: t("overview.open"), value: value.open, href: "/tasks/all" },
    { key: "today", label: t("overview.dueToday"), value: value.dueToday, href: "/tasks/all?due=today" },
    { key: "overdue", label: t("overview.overdue"), value: value.overdue, href: "/tasks/overdue" },
    { key: "blocked", label: t("overview.blocked"), value: value.blocked, href: "/tasks/all?status=BLOCKED" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-section="stats">
      {cards.map((card) => (
        <Link key={card.key} href={card.href} className="nesto-card p-4 transition-colors hover:border-line-strong">
          <p className="text-table text-fg-muted">{card.label}</p>
          <p className="mt-2 text-page font-semibold tabular-nums text-fg">{card.value}</p>
        </Link>
      ))}
    </div>
  );
}

/** The primary section: high and critical work in view (NAV-03 STREAM-02). */
async function PriorityWork({ priority: pending }: { priority: ReturnType<typeof priorityTasksForWorkspace> }) {
  const priority = await pending;
  const t = await getTranslations("tasks");
  return (
    <section className="nesto-card p-5" data-section="primary">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{t("overview.priorityWork")}</h2>
        <Link href="/tasks/all?priority=HIGH,CRITICAL" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong">
          {t("overview.allTasks")}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      {priority.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{t("overview.noPriority")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {priority.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                {task.company ? (
                  <CompanyRecordLink companyId={task.company.id} companyName={task.company.name} href={`/tasks/${task.id}`} className="block truncate text-table font-medium text-fg transition-colors hover:text-accent">
                    {task.title}
                  </CompanyRecordLink>
                ) : (
                  <Link href={`/tasks/${task.id}`} className="block truncate text-table font-medium text-fg transition-colors hover:text-accent">
                    {task.title}
                  </Link>
                )}
                {task.company ? (
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <CompanyTag name={task.company.name} className="shrink-0" />
                    <p className="truncate text-meta text-fg-subtle">{task.project ? task.project.name : t("common.personalTask")}</p>
                  </div>
                ) : (
                  <p className="truncate text-meta text-fg-subtle">{task.project ? task.project.name : t("common.personalTask")}</p>
                )}
              </div>
              <PriorityBadge priority={task.priority} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function YourWeek({ stats }: { stats: Overview }) {
  const value = await stats;
  const t = await getTranslations("tasks");
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{t("overview.yourWeek")}</h2>
      <dl className="mt-4 divide-y divide-line">
        <Row label={t("overview.assignedOpen")} value={value.mine} href="/tasks/my-tasks" />
        <Row label={t("overview.completedThisWeek")} value={value.completedThisWeek} href="/tasks/completed" />
        <Row label={t("overview.overdueInView")} value={value.overdue} href="/tasks/overdue" />
      </dl>
    </section>
  );
}

function Row({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
      <dt className="min-w-0">
        <Link href={href} className="text-table text-fg transition-colors hover:text-accent">
          {label}
        </Link>
      </dt>
      <dd className="shrink-0 text-table font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  );
}
