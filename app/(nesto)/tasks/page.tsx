import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, SquareCheckBig } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { PriorityBadge } from "@/components/modules/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import * as tasks from "@/lib/modules/tasks/task.service";

export const metadata: Metadata = { title: "Tasks" };

/**
 * Tasks module overview (PRD #11 §7, §8).
 *
 * This is the module's own dashboard, not the personal one at /dashboard: it
 * describes the work in view, scoped to what this user may see. Every counter
 * is a link, because a number nobody can drill into is decoration
 * (PRD #11 §92, §141).
 */
export default async function TasksOverviewPage() {
  const context = await requireModule("tasks");
  const experience = resolveModuleExperience(context, "tasks");

  const [stats, priority] = await Promise.all([
    tasks.getTaskOverview(context),
    tasks.listPriorityTasks(context, 6),
  ]);

  const cards = [
    { label: "Open", value: stats.open, href: "/tasks/all" },
    { label: "Due today", value: stats.dueToday, href: "/tasks/all?due=today" },
    { label: "Overdue", value: stats.overdue, href: "/tasks/overdue" },
    { label: "Blocked", value: stats.blocked, href: "/tasks/all?status=BLOCKED" },
  ];

  const hasAnything = stats.open > 0 || stats.completedThisWeek > 0 || priority.length > 0;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "task.create") ? (
          <Button asChild size="sm">
            <Link href="/tasks/new">New task</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="nesto-card p-4 transition-colors hover:border-line-strong"
            >
              <p className="text-table text-fg-muted">{card.label}</p>
              <p className="mt-2 text-page font-semibold tabular-nums text-fg">{card.value}</p>
            </Link>
          ))}
        </div>

        {!hasAnything ? (
          <EmptyState
            icon={<SquareCheckBig />}
            title="No tasks yet."
            description="Tasks you can see will appear here."
            action={
              can(context, "task.create") ? { label: "New task", href: "/tasks/new" } : undefined
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Priority work</h2>
                <Link
                  href="/tasks/all?priority=HIGH,CRITICAL"
                  className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
                >
                  All tasks
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              {priority.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">
                  Nothing high or critical is open right now.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {priority.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/tasks/${task.id}`}
                          className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                        >
                          {task.title}
                        </Link>
                        <p className="truncate text-meta text-fg-subtle">
                          {task.project ? task.project.name : "Personal task"}
                        </p>
                      </div>
                      <PriorityBadge priority={task.priority} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Your week</h2>
              <dl className="mt-4 divide-y divide-line">
                <Row label="Assigned to you and open" value={stats.mine} href="/tasks/my-tasks" />
                <Row
                  label="Completed this week"
                  value={stats.completedThisWeek}
                  href="/tasks/completed"
                />
                <Row label="Overdue in your view" value={stats.overdue} href="/tasks/overdue" />
              </dl>
            </section>
          </div>
        )}
      </div>
    </ModulePage>
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
