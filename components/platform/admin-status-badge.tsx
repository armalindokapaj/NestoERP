import { Badge, type BadgeProps } from "@/components/ui/badge";

/**
 * One word per state across Platform Admin (Dashboard PRD §56): the same
 * status reads the same on the Dashboard, the directories and detail pages.
 * Red only for a state that stops work.
 */
const STATES: Record<string, { label: string; tone: BadgeProps["tone"] }> = {
  ACTIVE: { label: "Active", tone: "success" },
  ENABLED: { label: "Enabled", tone: "success" },
  DISABLED: { label: "Disabled", tone: "default" },
  INVITED: { label: "Invited", tone: "info" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  INACTIVE: { label: "Inactive", tone: "default" },
  ARCHIVED: { label: "Archived", tone: "default" },
  IMPLEMENTING: { label: "Implementing", tone: "warning" },
  READY_FOR_VALIDATION: { label: "Ready for validation", tone: "info" },
  PENDING: { label: "Pending", tone: "warning" },
  FINISHED: { label: "Finished", tone: "default" },
  Public: { label: "Public", tone: "success" },
  "Company only": { label: "Company only", tone: "info" },
  Offline: { label: "Offline", tone: "default" },
  "Not configured": { label: "Not configured", tone: "default" },
  Deleted: { label: "Deleted", tone: "default" },
};

export function adminStatusLabel(status: string): string {
  return STATES[status]?.label ?? status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function AdminStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge tone={STATES[status]?.tone ?? "default"} className={className}>{adminStatusLabel(status)}</Badge>;
}
