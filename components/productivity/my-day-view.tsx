import Link from "@/components/navigation/nav-link";
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, TriangleAlert } from "@/components/icons";

import { PriorityBadge, StatusBadge } from "@/components/modules/status-badge";
import { MyDayComplete } from "@/components/productivity/my-day-complete";
import { Button } from "@/components/ui/button";
import { LineCaption, LineFigures, LineHead, LineIcon, lineRow } from "@/components/ui/lined";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { Locale } from "@/lib/i18n/config";
import { dateText } from "@/lib/i18n/format";
import { approvalsEn } from "@/lib/i18n/modules/approvals/en";
import { approvalsWord } from "@/lib/i18n/modules/approvals/server-text";
import { approvalsSq } from "@/lib/i18n/modules/approvals/sq";
import { calendarServerText } from "@/lib/i18n/modules/calendar/server-text";
import { createTranslator } from "@/lib/i18n/translator";
import { getTranslations } from "@/lib/i18n/server";
import { businessDate, daysBetween, localTime } from "@/lib/core/time/zoned-time";
import type { MyDayDTO, MyDaySection } from "@/lib/modules/productivity/my-day.service";
import type { TaskSummaryDTO } from "@/lib/modules/tasks/task.types";
import { cn } from "@/lib/utils/cn";

/**
 * My Day (MOB-06 §7-§11, §70-§75): the phone-first answer to "what needs me
 * now". A server component over one aggregate — nothing here fetches, and a
 * section that could not be read says so instead of reading as "all clear".
 * Rows open the same canonical pages the desktop lists open.
 */
export async function MyDayView({ day, locale, canCreateTask, canComplete }: { day: MyDayDTO; locale: Locale; canCreateTask: boolean; canComplete: boolean }) {
  const t = await getTranslations("misc");
  const approvalsT = createTranslator<"approvals">(locale, locale === "sq" ? approvalsSq : approvalsEn);
  const m = (key: string, values?: Record<string, string | number>) => t(`myDay.${key}` as never, values as never) as string;

  const tasksOk = day.tasks.status === "ok" ? day.tasks.data : null;
  const empty =
    day.attention.length === 0 &&
    (tasksOk ? tasksOk.upcoming.length === 0 : true) &&
    (day.events.status === "ok" ? day.events.data.today.length === 0 : true) &&
    day.tasks.status !== "error" &&
    day.approvals.status !== "error" &&
    day.events.status !== "error";

  const heading = dateText(new Date(day.generatedAt), { weekday: "long", day: "numeric", month: "long", timeZone: day.timezone }, locale, "en");
  const needing = day.counters.tasksOverdue + day.counters.tasksDueToday + day.counters.approvalsWaiting;
  const headline = needing === 0 ? m("needYouNone") : needing === 1 ? m("needYouOne") : m("needYouMany", { count: needing });
  let number = 0;
  const next = () => String(++number).padStart(2, "0");

  return (
    // Full width of the phone, its lists ruled edge to edge; a centred column from md.
    <div className="-mx-(--nesto-gutter) -mt-(--nesto-space-page-y) w-auto max-w-3xl pt-4 md:mx-auto" data-testid="my-day">
      <LineHead
        eyebrow={<span data-testid="my-day-date">{heading}</span>}
        title={headline}
        action={
          canCreateTask ? (
            <Button asChild variant="secondary" className="shrink-0 max-lg:hidden">
              <Link href="/tasks/new">{m("newTask")}</Link>
            </Button>
          ) : null
        }
      />

      <div data-testid="my-day-counters">
        <LineFigures
          label={m("counters")}
          figures={[
            { label: m("counterDueToday"), value: day.counters.tasksDueToday, href: "/tasks/my-tasks?due=today" },
            { label: m("counterToApprove"), value: day.counters.approvalsWaiting, href: "/inbox" },
            { label: m("counterOverdue"), value: day.counters.tasksOverdue, href: "/tasks/my-tasks?due=overdue", tone: "danger" },
          ]}
        />
      </div>

      <section aria-labelledby="my-day-attention-title" className="mt-7" data-testid="my-day-attention">
        <LineCaption id="my-day-attention-title" number={next()} label={m("requiresAttention")} count={day.attention.length || null} />
        {day.attention.length > 0 ? (
          <ul>
            {day.attention.map((item) => (
              <li key={item.kind}>
                <Link href={item.href} className={lineRow}>
                  <LineIcon tone={item.kind === "approvals_waiting" ? "gold" : "plain"}>
                    {item.kind === "next_event" ? <CalendarDays /> : item.kind === "approvals_waiting" ? <ClipboardCheck /> : <TriangleAlert className={item.kind === "tasks_overdue" ? "text-danger-strong" : undefined} />}
                  </LineIcon>
                  <span className="min-w-0 flex-1 text-body font-medium text-fg">{attentionText(item, day, m)}</span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        ) : empty ? (
          <div className="border-b border-line px-4 py-6 text-center sm:px-6" data-testid="my-day-empty">
            <CheckCircle2 aria-hidden="true" className="mx-auto mb-2 size-6 text-success-strong" />
            <p className="text-body font-medium text-fg">{m("nothingTitle")}</p>
            <p className="mt-1 text-table text-fg-muted">{m("nothingBody")}</p>
          </div>
        ) : (
          <p className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{m("nothingTitle")}</p>
        )}
      </section>

      <SectionShell id="events" number={next()} title={m("today")} section={day.events} m={m} groupNote={day.group ? m("groupEventsNote") : null}>
        {(events) => (
          <>
            <EventList events={events.today} timezone={day.timezone} locale={locale} empty={m("noEventsToday")} m={m} />
            {events.tomorrow.length > 0 ? (
              <>
                <h3 className="px-4 pb-1 pt-4 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg-subtle sm:px-6">{m("tomorrow")}</h3>
                <EventList events={events.tomorrow} timezone={day.timezone} locale={locale} empty={m("noEventsTomorrow")} m={m} />
              </>
            ) : null}
            <MoreLink href="/calendar?view=agenda">{m("openCalendar")}</MoreLink>
          </>
        )}
      </SectionShell>

      <SectionShell id="tasks" number={next()} title={m("tasks")} section={day.tasks} m={m}>
        {(tasks) => {
          const all = tasks.overdue.length + tasks.dueToday.length + tasks.upcoming.length;
          return (
            <>
              {all === 0 ? <p className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{m("tasksNone")}</p> : null}
              <TaskGroup title={m("overdue")} tasks={tasks.overdue} day={day} m={m} canComplete={canComplete} />
              <TaskGroup title={m("dueToday")} tasks={tasks.dueToday} day={day} m={m} canComplete={canComplete} />
              <TaskGroup title={m("upcoming")} tasks={tasks.upcoming} day={day} m={m} canComplete={canComplete} />
              <MoreLink href="/tasks/my-tasks">{m("viewMyTasks")}</MoreLink>
            </>
          );
        }}
      </SectionShell>

      <SectionShell id="approvals" number={next()} title={m("approvals")} section={day.approvals} m={m}>
        {(approvals) => (
          <>
            {approvals.items.length === 0 && !approvals.partial ? <p className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{m("approvalsNone")}</p> : null}
            {approvals.partial ? (
              <p role="status" className="border-b border-line px-4 py-3 text-table text-warning-strong sm:px-6">
                {m("approvalsPartial")}
              </p>
            ) : null}
            {approvals.items.length > 0 ? (
              <ul>
                {approvals.items.map((item) => (
                  <li key={item.id}>
                    <Link href={day.group ? "/approvals" : `/approvals?approval=${encodeURIComponent(item.id)}`} className={lineRow}>
                      <LineIcon tone="gold">
                        <ClipboardCheck />
                      </LineIcon>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-fg">{item.title}</span>
                        <span className="block truncate text-table text-fg-muted">
                          {[approvalsWord(approvalsT, item.sourceLabel, locale), item.project?.name, item.company?.name].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {item.amount ? <span className="shrink-0 text-table tabular-nums text-fg-muted">{item.amount.value} {item.amount.currency}</span> : null}
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <MoreLink href="/inbox">{m("viewApprovals")}</MoreLink>
          </>
        )}
      </SectionShell>
    </div>
  );
}

/** "View all", under a list: mono capitals, 48px tall. */
function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-12 items-center gap-1.5 px-4 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg hover:text-accent-strong sm:px-6">
      {children}
      <ChevronRight aria-hidden="true" className="size-3.5" />
    </Link>
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

function SectionShell<D>({
  id,
  number,
  title,
  section,
  m,
  groupNote,
  children,
}: {
  id: string;
  number: string;
  title: string;
  section: MyDaySection<D>;
  m: (key: string, values?: Record<string, string | number>) => string;
  groupNote?: string | null;
  children: (data: D) => React.ReactNode;
}) {
  if (section.status === "unavailable" && !groupNote) return null;
  return (
    <section aria-labelledby={`my-day-${id}-title`} className="mt-7" data-testid={`my-day-${id}`}>
      <LineCaption id={`my-day-${id}-title`} number={number} label={title} />
      {section.status === "ok" ? (
        children(section.data)
      ) : section.status === "error" ? (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-table text-fg-muted sm:px-6" data-testid={`my-day-${id}-error`}>
          <span>{m("sectionError")}</span>
          <Link href="/my-day" className="inline-flex min-h-11 items-center font-medium text-accent-strong">
            {m("retry")}
          </Link>
        </div>
      ) : (
        <p className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{groupNote}</p>
      )}
    </section>
  );
}

function EventList({ events, timezone, locale, empty, m }: { events: MyDayDTOEvents; timezone: string; locale: Locale; empty: string; m: (key: string) => string }) {
  if (events.length === 0) return <p className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{empty}</p>;
  return (
    <ul>
      {events.map((event) => (
        <li key={event.id}>
          <Link href={event.href} className={lineRow}>
            <span className="w-14 shrink-0 font-mono text-meta font-medium tabular-nums text-fg-subtle">{event.allDay ? m("allDay") : localTime(new Date(event.startsAt), timezone)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-fg">{event.sourceType === "calendar_event" ? event.title : calendarServerText(event.title, locale)}</span>
              {event.subtitle || event.project ? <span className="block truncate text-meta text-fg-subtle">{[...new Set([event.project?.name, event.subtitle && event.sourceType !== "calendar_event" ? calendarServerText(event.subtitle, locale) : event.subtitle].filter(Boolean))].join(" · ")}</span> : null}
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
      <h3 className="px-4 pb-1 pt-4 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg-subtle sm:px-6">{title}</h3>
      <ul className="border-t border-line">
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
          const className = cn(lineRow, "border-b-0");
          return (
            <li key={task.id} className="flex items-center border-b border-line pr-3 sm:pr-5">
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
