"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";

import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { shortVariance } from "@/lib/modules/project-planning/planning.dates";
import { type MilestoneStatus, type PlanningPerson } from "@/lib/modules/project-planning/planning.types";
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
  const t = useTranslations("projects");
  // A milestone past its date reads as delayed even if its status was never changed (§44).
  const shown: MilestoneStatus = delayed && status !== "DELAYED" && status !== "COMPLETED" && status !== "CANCELLED" ? "DELAYED" : status;
  return (
    <Badge tone={STATUS_TONE[shown]} className={status === "CANCELLED" ? "line-through decoration-fg-subtle/60" : undefined} data-testid="milestone-status">
      {t(`milestoneStatus.${shown}`)}
    </Badge>
  );
}

export function CriticalBadge() {
  const t = useTranslations("projects");
  return (
    <Badge tone="neutral" className="border border-line-strong text-fg" title={t("planningUi.criticalTitle")}>
      {t("planningUi.critical")}
    </Badge>
  );
}

export function CommittedBadge() {
  const t = useTranslations("projects");
  return (
    <Badge tone="neutral" title={t("planningUi.committedTitle")}>
      {t("planningUi.committed")}
    </Badge>
  );
}

/** "+3 days", "On baseline", "No baseline" in the reader's language. */
export function useVarianceLabel(): (days: number | null) => string {
  const t = useTranslations("projects");
  return React.useCallback(
    (days: number | null) => {
      if (days === null) return t("planningUi.noBaseline");
      if (days === 0) return t("planningUi.onBaseline");
      return t("planningUi.days", { count: Math.abs(days), sign: days > 0 ? "+" : "-" });
    },
    [t],
  );
}

export function Variance({ days, short = false, className }: { days: number | null; short?: boolean; className?: string }) {
  const variance = useVarianceLabel();
  if (days === null) return <span className={cn("text-fg-subtle", className)}>—</span>;
  const tone = days > 0 ? "text-danger-strong" : days < 0 ? "text-success-strong" : "text-fg-muted";
  return (
    // aria-label on a bare span is not read; the short form is shown and the full one spoken (AUD-11 §5).
    <span className={cn("tabular-nums", tone, className)} data-testid="milestone-variance">
      {short ? (
        <>
          <span aria-hidden="true">{shortVariance(days)}</span>
          <span className="sr-only">{variance(days)}</span>
        </>
      ) : (
        variance(days)
      )}
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
  const t = useTranslations("projects");
  if (!owner) return <span className="text-fg-subtle">{t("planningUi.unassigned")}</span>;
  const name = plain ? owner.name : <PersonLink memberId={owner.memberId} name={owner.name} />;
  return owner.active ? <span>{name}</span> : <span className="text-fg-muted" title={t("planningUi.formerTitle")}>{name} · {t("planningUi.formerMember")}</span>;
}
