import { Badge } from "@/components/ui/badge";
import { DAILY_LOG_STATUS_LABELS, type DailyLogStatus } from "@/lib/modules/daily-logs/daily-log.types";

/**
 * Daily log presentation pieces (PRD #43 §145, §196-§200, §219-§221): quiet
 * status words with a tint, and the badges a record carries for life — late,
 * corrected, void.
 */

const TONE: Record<DailyLogStatus, "default" | "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  REVIEWED: "success",
  LOCKED: "success",
  CORRECTION_REQUIRED: "warning",
  VOID: "default",
};

export function DailyLogStatusBadge({ status }: { status: DailyLogStatus }) {
  return (
    <Badge tone={TONE[status]} className={status === "VOID" ? "line-through decoration-fg-subtle/60" : undefined} data-testid="daily-log-status">
      {DAILY_LOG_STATUS_LABELS[status]}
    </Badge>
  );
}

export function LateEntryBadge() {
  return (
    <Badge tone="warning" title="Started after its work date">
      Late entry
    </Badge>
  );
}

export function CorrectedBadge() {
  return <Badge tone="info">Corrected</Badge>;
}

export function Stat({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <p className="text-meta text-fg-muted">{label}</p>
      <p className="text-section font-semibold tabular-nums text-fg" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}
