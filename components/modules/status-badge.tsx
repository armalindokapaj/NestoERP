import { Badge } from "@/components/ui/badge";
import { PRIORITY_TONES, statusLabel, statusTone } from "@/lib/utils/status";

/**
 * The single status badge (PRD #7 §92).
 *
 * Colour reinforces meaning but never carries it alone — the status text is
 * always present, which is also the accessibility requirement (PRD #7 §156).
 * The vocabulary itself lives in lib/utils/status.ts, so server-side services
 * can read the same labels without pulling in a React component.
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-fg-subtle">—</span>;
  return <Badge tone={PRIORITY_TONES[priority] ?? "default"}>{statusLabel(priority)}</Badge>;
}

export { statusLabel, statusTone } from "@/lib/utils/status";
