import { Badge } from "@/components/ui/badge";
import {
  checklistResultLabels,
  inspectionResultLabels,
  releaseStatusLabels,
  severityLabels,
} from "@/lib/modules/qaqc/qaqc.status";
import type {
  ChecklistItemResult,
  MaterialReleaseStatus,
  QualityInspectionResult,
  QualitySeverity,
} from "@prisma/client";
import type { StatusTone } from "@/lib/utils/status";

/**
 * How QA/QC renders its verdicts (PRD #21 §65).
 *
 * The result badge is deliberately *not* the status badge. An inspection can be
 * "pending approval" and "fail" at the same time, and showing one field where
 * the reader expects two is how those two get confused.
 */

const RESULT_TONES: Record<QualityInspectionResult, StatusTone> = {
  NOT_SET: "default",
  PASS: "success",
  FAIL: "danger",
  CONDITIONAL: "warning",
};

export function ResultBadge({ result }: { result: QualityInspectionResult }) {
  if (result === "NOT_SET") return <span className="text-fg-subtle">—</span>;
  return <Badge tone={RESULT_TONES[result]}>{inspectionResultLabels[result]}</Badge>;
}

const CHECKLIST_TONES: Record<ChecklistItemResult, StatusTone> = {
  PASS: "success",
  FAIL: "danger",
  NA: "default",
};

export function ChecklistResultBadge({ result }: { result: ChecklistItemResult | null }) {
  if (!result) return <span className="text-fg-subtle">Not answered</span>;
  return <Badge tone={CHECKLIST_TONES[result]}>{checklistResultLabels[result]}</Badge>;
}

const SEVERITY_TONES: Record<QualitySeverity, StatusTone> = {
  LOW: "default",
  MEDIUM: "neutral",
  HIGH: "warning",
  CRITICAL: "danger",
};

export function SeverityBadge({ severity }: { severity: QualitySeverity }) {
  return <Badge tone={SEVERITY_TONES[severity]}>{severityLabels[severity]}</Badge>;
}

/**
 * Quality's own release vocabulary.
 *
 * "Released" means something different here than on an Inventory reservation,
 * where it means a hold was let go — so this badge carries its own tones rather
 * than borrowing the shared status map.
 */
const RELEASE_TONES: Record<MaterialReleaseStatus, StatusTone> = {
  RELEASED: "success",
  PARTIALLY_RELEASED: "info",
  HELD: "warning",
  REJECTED: "danger",
  REVOKED: "default",
};

export function ReleaseBadge({ status }: { status: MaterialReleaseStatus }) {
  return <Badge tone={RELEASE_TONES[status]}>{releaseStatusLabels[status]}</Badge>;
}

/** A pass rate, or an honest blank when nothing has been decided (§193). */
export function formatPassRate(rate: { percent: number; passed: number; total: number } | null) {
  if (!rate) return "—";
  return `${rate.percent}%`;
}
