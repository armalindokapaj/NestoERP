import Link from "@/components/navigation/nav-link";
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, ListChecks, TriangleAlert } from "lucide-react";

import { PriorityBadge, StatusBadge } from "@/components/modules/status-badge";
import { MyDayComplete } from "@/components/productivity/my-day-complete";
import { Button } from "@/components/ui/button";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { Locale } from "@/lib/i18n/config";
import { getTranslations } from "@/lib/i18n/server";
import { businessDate, daysBetween, localTime } from "@/lib/core/time/zoned-time";
import type { MyDayDTO, MyDaySection } from "@/lib/modules/productivity/my-day.service";
import type { TaskSummaryDTO } from "@/lib/modules/tasks/task.types";
import { cn } from "@/lib/utils/cn";

type T = Awaited<ReturnType<typeof getTranslations<"misc">>>;

/**
 * My Day (MOB-06 §7-§11, §70-§75): the phone-first answer to "what needs me
 * now". A server component over one aggregate — nothing here fetches, and a
 * section that could not be read says so instead of reading as "all clear".
 * Rows open the same canonical pages the desktop lists open.
 */
export async function MyDayView({ day, locale, canCreateTask, canComplete }: { day: MyDayDTO; locale: Locale; canCreateTask: boolean; canComplete: boolean }) {
  const t = await getTranslations("misc");
  const m = (key: string, values?: Record<string, string | number>) => t(`myDay.${key}` as never, values as never) as string;

  const tasksOk = day.tasks.status === "ok" ? day.tasks.data : null;
  const empty =
    day.attention.length === 0 &&
    (tasksOk ? tasksOk.upcoming.length === 0 : true) &&
    (day.events.status === "ok" ? day.events.data.today.length === 0 : true) &&
    day.tasks.status !== "error" &&
    day.approvals.status !== "error" &&
    day.events.status !== "error";

  const heading = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: day.timezone }).format(new Date(day.generatedAt));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" data-testid="my-day">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta font-medium uppercase tracking-wider text-fg-subtle">{m("title")}</p>
          <h1 className="text-page font-semibold tracking-tight text-fg" data-testid="my-day-date">
            {heading}
          </h1>
        </div>
        {canCreateTask ? (
          <Button asChild size="sm" variant="secondary">
            <Link href="/tasks/new">{m("newTask")}</Link>
          </Button>
        ) : null}
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={m("counters")} data-testid="my-day-counters">
        <Counter label={m("counterOverdue")} value={day.counters.tasksOverdue} tone={day.counters.tasksOverdue > 0 ? "danger" : "neutral"} href="/tasks/my-tasks?due=overdue" />
        <Counter label={m("counterDueToday")} value={day.counters.tasksDueToday} href="/tasks/my-tasks?due=today" />
        <Counter label={m("counterApprovals")} value={day.counters.approvalsWaiting} href="/approvals" />
        <Counter label={m("counterMeetings")} value={day.counters.meetingsToday} href="/calendar?view=agenda" />
      </ul>

      <section aria-labelledby="my-day-attention" className="space-y-2" data-testid="my-day-attention">
        <h2 id="my-day-attention" className="text-label font-semibold uppercase tracking-wider text-fg-subtle">
          {m("requiresAttention")}
        </h2>
        {day.attention.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {day.attention.map((item) => (
              <li key={item.kind}>
                <Link href={item.href} className="flex min-h-12 items-center gap-3 px-4 py-3 text-body text-fg hover:bg-row-hover">
                  <TriangleAlert aria-hidden="true" className={cn("size-4 shrink-0", item.kind === "tasks_overdue" ? "text-danger-strong" : "text-fg-subtle")} />
                  <span className="min-w-0 flex-1">{attentionText(item, day, m)}</span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        ) : empty ? (
          <div className="rounded-lg border border-line bg-surface px-4 py-6 text-center" data-testid="my-day-empty">
            <CheckCircle2 aria-hidden="true" className="mx-auto mb-2 size-6 text-success-strong" />
            <p className="text-body font-medium text-fg">{m("nothingTitle")}</p>
            <p className="mt-1 text-table text-fg-muted">{m("nothingBody")}</p>
          </div>
        ) : null}
      </section>

      <SectionShell id="events" title={m("today")} icon={CalendarDays} section={day.events} m={m} groupNote={day.group ? m("groupEventsNote") : null}>
        {(events) => (
          <div className="space-y-4">
            <EventList events={events.today} timezone={day.timezone} empty={m("noEventsToday")} m={m} />
            {events.tomorrow.length > 0 ? (
              <div>
                <h3 className="mb-1 text-meta font-semibold uppercase tracking-wider text-fg-subtle">{m("tomorrow")}</h3>
                <EventList events={events.tomorrow} timezone={day.timezone} empty={m("noEventsTomorrow")} m={m} />
              </div>
            ) : null}
            <Link href="/calendar?view=agenda" className="inline-flex min-h-11 items-center text-table font-medium text-accent-strong">
              {m("openCalendar")}
            </Link>
          </div>
        )}
      </SectionShell>

      <SectionShell id="tasks" title={m("tasks")} icon={ListChecks} section={day.tasks} m={m}>
        {(tasks) => {
          const all = tasks.overdue.length + tasks.dueToday.length + tasks.upcoming.length;
          return (
            <div className="space-y-4">
              {all === 0 ? <p className="text-table text-fg-muted">{m("tasksNone")}</p> : null}
              <TaskGroup title={m("overdue")} tasks={tasks.overdue} day={day} m={m} canComplete={canComplete} />
              <TaskGroup title={m("dueToday")} tasks={tasks.dueToday} day={day} m={m} canComplete={canComplete} />
              <TaskGroup title={m("upcoming")} tasks={tasks.upcoming} day={day} m={m} canComplete={canComplete} />
              <Link href="/tasks/my-tasks" className="inline-flex min-h-11 items-center text-table font-medium text-accent-strong">
                {m("viewMyTasks")}
              </Link>
            </div>
          );
        }}
      </SectionShell>

      <SectionShell id="approvals" title={m("approvals")} icon={ClipboardCheck} section={day.approvals} m={m}>
        {(approvals) => (
          <div className="space-y-3">
            {approvals.items.length === 0 && !approvals.partial ? <p className="text-table text-fg-muted">{m("approvalsNone")}</p> : null}
            {approvals.partial ? (
              <p role="status" className="text-table text-warning-strong">
                {m("approvalsPartial")}
              </p>
            ) : null}
            {approvals.items.length > 0 ? (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                {approvals.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={day.group ? "/approvals" : `/approvals?approval=${encodeURIComponent(item.id)}`}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-row-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-fg">{item.title}</span>
                        <span className="block truncate text-meta text-fg-subtle">
                          {[item.sourceLabel, item.project?.name, item.company?.name].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {item.amount ? <span className="shrink-0 text-table text-fg-muted">{item.amount.value} {item.amount.currency}</span> : null}
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/approvals" className="inline-flex min-h-11 items-center text-table font-medium text-accent-strong">
              {m("viewApprovals")}
            </Link>
          </div>
        )}
      </SectionShell>
    </div>
  );
}

function attentionText(item: MyDayDTO["attention"][number], day: MyDayDTO, m: (key: string, values?: Record<string, string | number>) => string) {
  switch (item.kind) {
    case "tasks_overdue":
      return item.count === 1 ? m("tasksOverdueOne") : m("tasksOverdue", { count: item.count });
    case "tasks_due_today":
      return item.count === 1 ? m("tasksDueTodayOne") : m("tasksDueToday", { count: item.count });
    case "approvals_waiting":
      return item.count === 1 ? m("approvalsWaitingOne") : m("approvalsWaiting", { count: item.count });
    case "next_event":
      return m("nextEvent", { title: item.event?.title ?? "", time: item.event ? localTime(new Date(item.event.startsAt), day.timezone) : "" });
  }
}

function Counter({ label, value, href, tone = "neutral" }: { label: string; value: number; href: string; tone?: "neutral" | "danger" }) {
  return (
    <li>
      <Link href={href} className="block min-h-14 rounded-lg border border-line bg-surface px-3 py-2 hover:bg-row-hover">
        <span className={cn("block text-xl font-semibold tabular-nums", tone === "danger" ? "text-danger-strong" : "text-fg")}>{value}</span>
        <span className="block text-meta text-fg-muted">{label}</span>
      </Link>
    </li>
  );
}

function SectionShell<D>({
  id,
  title,
  icon: Icon,
  section,
  m,
  groupNote,
  children,
}: {
  id: string;
  title: string;
  icon: typeof ListChecks;
  section: MyDaySection<D>;
  m: (key: string, values?: Record<string, string | number>) => string;
  groupNote?: string | null;
  children: (data: D) => React.ReactNode;
}) {
  if (section.status === "unavailable" && !groupNote) return null;
  return (
    <section aria-labelledby={`my-day-${id}`} className="space-y-2" data-testid={`my-day-${id}`}>
      <h2 id={`my-day-${id}`} className="flex items-center gap-2 text-label font-semibold uppercase tracking-wider text-fg-subtle">
        <Icon aria-hidden="true" className="size-4" />
        {title}
      </h2>
      {section.status === "ok" ? (
        children(section.data)
      ) : section.status === "error" ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-table text-fg-muted" data-testid={`my-day-${id}-error`}>
          <span>{m("sectionError")}</span>
          <Link href="/my-day" className="inline-flex min-h-11 items-center font-medium text-accent-strong">
            {m("retry")}
          </Link>
        </div>
      ) : (
        <p className="text-table text-fg-muted">{groupNote}</p>
      )}
    </section>
  );
}

function EventList({ events, timezone, empty, m }: { events: MyDayDTOEvents; timezone: string; empty: string; m: (key: string) => string }) {
  if (events.length === 0) return <p className="text-table text-fg-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {events.map((event) => (
        <li key={event.id}>
          <Link href={event.href} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-row-hover">
            <span className="w-14 shrink-0 text-table tabular-nums text-fg-muted">{event.allDay ? m("allDay") : localTime(new Date(event.startsAt), timezone)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-fg">{event.title}</span>
              {event.subtitle || event.project ? <span className="block truncate text-meta text-fg-subtle">{[...new Set([event.project?.name, event.subtitle].filter(Boolean))].join(" · ")}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
type MyDayDTOEvents = NonNullable<Extract<MyDayDTO["events"], { status: "ok" }>["data"]>["today"];

function TaskGroup({ title, tasks, day, m, canComplete }: { canComplete: boolean; title: string; tasks: TaskSummaryDTO[]; day: MyDayDTO; m: (key: string, values?: Record<string, string | number>) => string }) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-meta font-semibold uppercase tracking-wider text-fg-subtle">{title}</h3>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {tasks.map((task) => {
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-fg">{task.title}</span>
                <span className="block truncate text-meta text-fg-subtle">{task.project?.name ?? ""}</span>
                <span className={cn("block text-meta", task.isOverdue ? "font-medium text-danger-strong" : "text-fg-muted")}>{dueLabel(task, day.date, m)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={task.status} />
                {task.priority === "HIGH" || task.priority === "CRITICAL" ? <PriorityBadge priority={task.priority} /> : null}
              </span>
            </>
          );
          const className = "flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-row-hover";
          return (
            <li key={task.id} className="flex items-center pr-3">
              <div className="min-w-0 flex-1">
              {task.company ? (
                <CompanyRecordLink companyId={task.company.id} companyName={task.company.name} href={`/tasks/${task.id}`} className={className}>
                  {body}
                </CompanyRecordLink>
              ) : (
                <Link href={`/tasks/${task.id}`} className={className}>
                  {body}
                </Link>
              )}
              {task.company ? <CompanyTag name={task.company.name} className="mx-4 mb-2" /> : null}
              </div>
              {canComplete && !task.company && task.status !== "COMPLETED" ? <MyDayComplete taskId={task.id} version={task.version} title={task.title} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function dueLabel(task: TaskSummaryDTO, today: string, m: (key: string, values?: Record<string, string | number>) => string): string {
  if (!task.dueDate) return "";
  const days = daysBetween(today, businessDate(new Date(task.dueDate)));
  if (days < 0) return days === -1 ? m("overdueDay") : m("overdueDays", { count: -days });
  if (days === 0) return m("dueTodayLabel");
  if (days === 1) return m("dueTomorrowLabel");
  return task.dueDate.slice(0, 10);
}
