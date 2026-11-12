import { Suspense } from "react";
import { AlarmClock, CalendarClock, ChevronRight, ListChecks, UserCheck } from "@/components/icons";

import Link from "@/components/navigation/nav-link";
import type { UserContext } from "@/lib/context/types";
import { getTranslations } from "@/lib/i18n/server";
import type { TaskOverviewStats } from "@/lib/modules/tasks/task.types";
import { taskOverviewForWorkspace } from "@/lib/modules/tasks/task.workspace";
import { cn } from "@/lib/utils/cn";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";

type Counted = "mine" | "dueToday" | "overdue";

/**
 * Tasks, at the top of Home on phones and tablets (below `lg`, where the
 * bottom bar no longer has a Tasks cell; from `lg` the sidebar has Tasks and
 * this is not drawn). My tasks, Due today and Overdue, each with its count,
 * and All tasks — the views the bar's Tasks menu used to open.
 *
 * Offered on exactly the rule the Tasks navigation item has: the person's
 * navigation for this workspace holds it (module switch and permission, and in
 * the Group workspace a company where both hold). The counts are the Tasks
 * module's own overview counters — the figures its overview page links to these
 * same views — read through its authorised service, in the person's task scope
 * (`taskOverviewForWorkspace`). They stream in on their own, so a slow count
 * holds back nothing; one that fails shows a dash, never a wrong number.
 */
export async function HomeTasks({ context }: { context: UserContext }) {
  const navigation = await resolveWorkspaceNavigation(context);
  const item = navigation.menu.flatMap((group) => group.items).find((candidate) => candidate.key === "tasks");
  if (!item) return null;

  const t = await getTranslations("shell");
  // One read for the three counts; a refusal or a failure is "unavailable", not an error page.
  const stats = taskOverviewForWorkspace(context).catch(() => null);
  const rows: Array<{ key: string; href: string; icon: typeof UserCheck; label: string; count: Counted; urgent?: boolean }> = [
    { key: "mine", href: `${item.href}/my-tasks`, icon: UserCheck, label: t("homeTasks.mine"), count: "mine" },
    { key: "today", href: `${item.href}/all?due=today`, icon: CalendarClock, label: t("homeTasks.today"), count: "dueToday" },
    { key: "overdue", href: `${item.href}/overdue`, icon: AlarmClock, label: t("homeTasks.overdue"), count: "overdue", urgent: true },
  ];
  const row =
    "flex min-h-12 items-center gap-3 px-3 text-body font-medium transition-colors hover:bg-hover active:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <section aria-labelledby="home-tasks-title" data-testid="home-tasks" className="lg:hidden">
      <h2 id="home-tasks-title" className="nesto-eyebrow mb-1.5 px-1 text-accent-strong">
        {t("homeTasks.title")}
      </h2>
      <ul className="overflow-hidden border border-line bg-surface">
        {rows.map((entry) => (
          <li key={entry.key} className="border-b border-line">
            <Link href={entry.href} navSource="dashboard" className={cn(row, "text-fg")} data-testid={`home-tasks-${entry.key}`}>
              <entry.icon aria-hidden="true" className="size-[18px] shrink-0 text-accent-strong" />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <Suspense fallback={<CountPending />}>
                <TaskCount stats={stats} count={entry.count} urgent={entry.urgent} unavailable={t("homeTasks.countUnavailable")} />
              </Suspense>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
            </Link>
          </li>
        ))}
        <li>
          <Link href={item.href} navSource="dashboard" className={cn(row, "text-accent-strong")} data-testid="home-tasks-all">
            <ListChecks aria-hidden="true" className="size-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("homeTasks.all")}</span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        </li>
      </ul>
    </section>
  );
}

const countClass = "grid h-6 min-w-7 shrink-0 place-items-center px-2 text-meta font-semibold tabular-nums";

async function TaskCount({ stats, count, urgent = false, unavailable }: { stats: Promise<TaskOverviewStats | null>; count: Counted; urgent?: boolean; unavailable: string }) {
  const value = await stats;
  if (!value) {
    return (
      <span className={cn(countClass, "bg-surface-muted text-fg-subtle")} data-count-state="unavailable">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{unavailable}</span>
      </span>
    );
  }
  const number = value[count];
  return (
    <span
      className={cn(countClass, urgent && number > 0 ? "bg-danger-soft text-danger-strong" : number > 0 ? "bg-accent-soft text-accent-strong" : "bg-surface-muted text-fg-muted")}
      data-testid="home-tasks-count"
      data-count-state="ready"
    >
      {number}
    </span>
  );
}

function CountPending() {
  return <span aria-hidden="true" className={cn(countClass, "w-7 animate-pulse bg-surface-muted")} data-count-state="pending" />;
}
