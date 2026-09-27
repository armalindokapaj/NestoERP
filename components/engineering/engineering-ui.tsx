import * as React from "react";
import Link from "@/components/navigation/nav-link";

import { Badge } from "@/components/ui/badge";
import { StatusText } from "@/components/i18n/common-text";
import { PersonLink } from "@/components/people/person-link";
import { EngineeringLabel, EngineeringText } from "./engineering-text";
import { localDate, localTime } from "@/lib/modules/calendar/calendar.time";
import { dateLabel } from "@/lib/modules/project-planning/planning.dates";
import { REVIEW_DECISION_LABELS, type PersonRef, type RecordRef, type ReviewDecision } from "@/lib/modules/engineering/engineering.types";
import { statusLabel, statusTone } from "@/lib/utils/status";
import { cn } from "@/lib/utils/cn";

/**
 * Engineering presentation (PRD #46 §162-§172, §314). Technical, precise and
 * calm: status is always a word as well as a tint, a superseded revision is
 * struck through rather than coloured, overdue is the one thing allowed to be
 * red, and numbers line up.
 */

export function ReviewBadge({ status, label, className, testId = "record-status" }: { status: string; label?: React.ReactNode; className?: string; testId?: string }) {
  return (
    <Badge tone={status === "EXPIRED" ? "danger" : statusTone(status)} className={cn(status === "SUPERSEDED" || status === "VOID" ? "line-through decoration-fg-subtle/60" : null, className)} data-testid={testId}>
      {label ?? <StatusText status={status} />}
    </Badge>
  );
}

export function DecisionBadge({ decision }: { decision: ReviewDecision | null }) {
  if (!decision) return null;
  return (
    <Badge tone={decision === "APPROVED" || decision === "APPROVED_WITH_COMMENTS" ? "success" : decision === "REJECTED" ? "danger" : "warning"} data-testid="revision-decision">
      <EngineeringLabel group="decision" value={decision} fallback={REVIEW_DECISION_LABELS[decision]} />
    </Badge>
  );
}

export function PriorityMark({ priority }: { priority: string }) {
  if (priority === "NORMAL" || priority === "LOW") return <span className="text-table text-fg-muted"><EngineeringLabel group="priority" value={priority} fallback={statusLabel(priority)} /></span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-table font-medium", priority === "CRITICAL" ? "text-danger-strong" : "text-warning-strong")}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", priority === "CRITICAL" ? "bg-danger" : "bg-warning")} />
      <EngineeringLabel group="priority" value={priority} fallback={statusLabel(priority)} />
    </span>
  );
}

export function Due({ date, overdue, emptyLabel = "—" }: { date: string | null; overdue?: boolean; emptyLabel?: React.ReactNode }) {
  if (!date) return <span className="text-fg-subtle">{emptyLabel}</span>;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", overdue ? "font-medium text-danger-strong" : "text-fg")} data-overdue={overdue ? "true" : undefined}>
      {dateLabel(date)}
      {overdue ? <span className="sr-only"><EngineeringText k="ui.overdueSr" /></span> : null}
    </span>
  );
}

export function Ref({ value, fallback = "—" }: { value: RecordRef | null | undefined; fallback?: React.ReactNode }) {
  if (!value) return <span className="text-fg-subtle">{fallback}</span>;
  return (
    <Link href={value.href} className="text-fg underline-offset-4 hover:underline">
      {value.label}
    </Link>
  );
}

/** A member on an engineering record; `PersonRef.id` is the membership id. */
export function Person({ value, fallback = <EngineeringText k="ui.unassigned" /> }: { value: PersonRef | null | undefined; fallback?: React.ReactNode }) {
  return value ? <PersonLink memberId={value.id} name={value.name} /> : <span className="text-fg-subtle">{fallback}</span>;
}

export function Metric({ label, value, tone = "default", href, testId }: { label: React.ReactNode; value: number | string; tone?: "default" | "warning" | "danger" | "success"; href?: string; testId?: string }) {
  const body = (
    <>
      <span className="nesto-eyebrow block text-fg-subtle">{label}</span>
      <span className={cn("mt-1 block text-[1.625rem] font-semibold leading-none tabular-nums tracking-tight", tone === "danger" && Number(value) > 0 ? "text-danger-strong" : tone === "warning" && Number(value) > 0 ? "text-warning-strong" : tone === "success" && Number(value) > 0 ? "text-success-strong" : "text-fg")}>{value}</span>
    </>
  );
  const className = "block min-w-0 rounded-lg border border-line bg-surface px-4 py-3 transition-colors";
  return href ? (
    <Link href={href} className={cn(className, "hover:border-line-strong hover:bg-hover")} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

export function MetricStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4", className)}>{children}</div>;
}

export function Panel({ title, description, actions, children, className, testId }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("nesto-card min-w-0 p-5", className)} data-testid={testId} aria-labelledby={testId ? `${testId}-title` : undefined}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={testId ? `${testId}-title` : undefined} className="text-card font-semibold text-fg">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-table text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-table text-fg-muted">{children}</p>;
}

/** Label/value rows, dense but readable (§166). */
export function Facts({ items, columns = 2 }: { items: Array<{ label: string; value: React.ReactNode } | null | false>; columns?: 2 | 3 | 4 }) {
  const rows = items.filter((item): item is { label: string; value: React.ReactNode } => Boolean(item));
  return (
    <dl className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3", columns === 4 && "lg:grid-cols-4")}>
      {rows.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="nesto-eyebrow text-fg-subtle">{item.label}</dt>
          <dd className="mt-1 break-words text-body text-fg">{item.value ?? <span className="text-fg-subtle">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A timestamp in the company's zone, with fixed month names so server and browser agree. */
export function formatDateTime(value: string | null, zone: string): string {
  if (!value) return "—";
  const instant = new Date(value);
  return `${dateLabel(localDate(instant, zone))}, ${localTime(instant, zone)}`;
}

export function formatDay(value: string | null, zone: string): string {
  return value ? dateLabel(localDate(new Date(value), zone)) : "—";
}

export { dateLabel };
