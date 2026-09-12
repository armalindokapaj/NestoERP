import type { ChecklistGap } from "@/lib/modules/hse/hse.status";

/**
 * What a checklist gap reads as on the page (PRD #22 §51, §341).
 *
 * The item is named, not just the rule. "Answer 'Edge protection in place'" is
 * something an inspector can act on; "the checklist is incomplete" is not.
 */
export function checklistGapLabel(gap: ChecklistGap): string {
  switch (gap.kind) {
    case "UNANSWERED":
      return `Answer “${gap.label}”.`;
    case "MISSING_VALUE":
      return `Record a value for “${gap.label}”.`;
    case "MISSING_NOTE":
      return `“${gap.label}” failed and needs a note explaining why.`;
  }
}
