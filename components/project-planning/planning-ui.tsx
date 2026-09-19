import * as React from "react";

import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { shortVariance, varianceLabel } from "@/lib/modules/project-planning/planning.dates";
import { STATUS_LABELS, type MilestoneStatus, type PlanningPerson } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";

/**
 * Planning presentation pieces (PRD #44 §100, §122, §123, §145, §303). Status
 * is always a word as well as a tint; a critical milestone wears a small badge,
 * not a red row; delayed is derived and shown even when nobody set it.
 */

export const STATUS_TONE: Record<MilestoneStatus, "default" | "neutral" | "info" | "success" | "warning" | "danger"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  AT_RISK: "warning",
  DELAYED: "danger",
  COMPLETED: "success",
  ON_HOLD: "default",
  CANCELLED: "default",
};

/** The marker colour of a milestone on the timeline, as a CSS colour. */
export function markerColor(status: MilestoneStatus, delayed: boolean): string {
  if (delayed || status === "DELAYED") return "var(--color-danger)";
  if (status === "AT_RISK") return "var(--color-warning)";
  if (status === "COMPLETED") return "var(--color-success)";
  if (status === "IN_PROGRESS") return "var(--color-accent)";
  return "var(--color-fg-subtle)";
}

export function MilestoneStatusBadge({ status, delayed = false }: { status: MilestoneStatus; delayed?: boolean }) {
  // A milestone past its date reads as delayed even if its status was never changed (§44).
  const shown: MilestoneStatus = delayed && status !== "DELAYED" && status !== "COMPLETED" && status !== "CANCELLED" ? "DELAYED" : status;
  return (
    <Badge tone={STATUS_TONE[shown]} className={status === "CANCELLED" ? "line-through decoration-fg-subtle/60" : undefined} data-testid="milestone-status">
      {STATUS_LABELS[shown]}
    </Badge>
  );
}

export function CriticalBadge() {
  return (
    <Badge tone="neutral" className="border border-line-strong text-fg" title="Business-critical milestone">
      Critical
    </Badge>
  );
}

export function CommittedBadge() {
  return (
    <Badge tone="neutral" title="Externally committed date">
      Committed
    </Badge>
  );
}

export function Variance({ days, short = false, className }: { days: number | null; short?: boolean; className?: string }) {
  if (days === null) return <span className={cn("text-fg-subtle", className)}>—</span>;
  const tone = days > 0 ? "text-danger-strong" : days < 0 ? "text-success-strong" : "text-fg-muted";
  return (
    <span className={cn("tabular-nums", tone, className)} data-testid="milestone-variance" aria-label={varianceLabel(days)}>
      {short ? shortVariance(days) : varianceLabel(days)}
    </span>
  );
}

export function ProgressBar({ value, label, className }: { value: number | null; label: string; className?: string }) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-line", className)} role="progressbar" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${width}%` }} />
    </span>
  );
}

export function Diamond({ color, size = 12, hollow = false, className }: { color: string; size?: number; hollow?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block rotate-45 rounded-[2px]", className)}
      style={{ width: size, height: size, background: hollow ? "var(--color-surface)" : color, border: `1.5px solid ${color}` }}
    />
  );
}

export function Kpi({ label, value, hint, tone, testId, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warning" | "danger"; testId?: string; children?: React.ReactNode }) {
  return (
    <div className="nesto-card flex min-w-0 flex-col gap-1 px-4 py-3" data-testid={testId}>
      <p className="text-meta text-fg-muted">{label}</p>
      <p className={cn("text-section font-semibold tabular-nums", tone === "danger" ? "text-danger-strong" : tone === "warning" ? "text-warning-strong" : "text-fg")}>{value}</p>
      {hint ? <p className="text-meta text-fg-subtle">{hint}</p> : null}
      {children}
    </div>
  );
}

/** `plain` where the name sits inside a button, which a link cannot. */
export function OwnerName({ owner, plain = false }: { owner: PlanningPerson | null; plain?: boolean }) {
  if (!owner) return <span className="text-fg-subtle">Unassigned</span>;
  const name = plain ? owner.name : <PersonLink memberId={owner.memberId} name={owner.name} />;
  return owner.active ? <span>{name}</span> : <span className="text-fg-muted" title="This person is no longer an active member">{name} · Former member</span>;
}
