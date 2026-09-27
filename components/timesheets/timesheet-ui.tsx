"use client";

import * as React from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { TIMESHEET_STATUS_LABELS, type TimesheetStatus, type TimesheetWarning } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";
import { TimesheetsLabel, useTimesheetsTranslations } from "./timesheets-text";

/**
 * Timesheet presentation pieces (PRD #42 §190-§200). Quiet by design: status
 * is a word with a tint, hours are tabular numbers, and nothing is red unless
 * something is actually wrong.
 */

const STATUS_TONE: Record<TimesheetStatus | "NOT_STARTED", "default" | "neutral" | "info" | "success" | "warning" | "danger"> = {
  NOT_STARTED: "default",
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  RETURNED: "warning",
  REJECTED: "danger",
  CANCELLED: "default",
};

export function TimesheetStatusBadge({ status, className }: { status: TimesheetStatus | "NOT_STARTED"; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className} data-testid="timesheet-status">
      <TimesheetsLabel group="status" value={status} fallback={status === "NOT_STARTED" ? "Not started" : TIMESHEET_STATUS_LABELS[status]} />
    </Badge>
  );
}

const WARNING_ICON = { INFO: Info, WARNING: TriangleAlert, CRITICAL: CircleAlert } as const;

export function TimesheetWarnings({ warnings, className }: { warnings: TimesheetWarning[]; className?: string }) {
  const t = useTimesheetsTranslations();
  if (warnings.length === 0) return null;
  return (
    <ul className={cn("space-y-1.5", className)} aria-label={t("common.thingsToCheck")}>
      {warnings.map((warning, index) => {
        const Icon = WARNING_ICON[warning.severity];
        return (
          <li key={`${warning.code}-${index}`} className="flex items-start gap-2 text-table text-fg-muted">
            <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", warning.severity === "INFO" ? "text-info-strong" : warning.severity === "WARNING" ? "text-warning-strong" : "text-danger-strong")} />
            <span>{warning.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A figure in the week summary: a label above a large tabular number. */
export function SummaryFigure({ label, value, tone, testId }: { label: string; value: React.ReactNode; tone?: "muted" | "warning"; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-section font-semibold tabular-nums", tone === "muted" ? "text-fg-muted" : tone === "warning" ? "text-warning-strong" : "text-fg")} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Hours as a grid cell shows them — "8", "7.5", or "7:20" when a decimal would
 * not be exact — blank for nothing. Whatever is shown reads back to the same
 * minutes.
 */
export function hoursValue(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes % 6 === 0) return String(minutes / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
