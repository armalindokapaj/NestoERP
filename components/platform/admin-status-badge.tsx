"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { adminText } from "@/components/platform/admin-i18n";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { Translate } from "@/lib/i18n/translator";

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
  DELETED: { label: "Deleted", tone: "danger" },
  IMPLEMENTING: { label: "Implementing", tone: "warning" },
  READY_FOR_VALIDATION: { label: "Ready for validation", tone: "info" },
  PENDING: { label: "Pending", tone: "warning" },
  // Ownership, not lifecycle: a project with no company yet (Standalone Project PRD §9).
  UNASSIGNED: { label: "Unassigned", tone: "info" },
  FINISHED: { label: "Finished", tone: "default" },
  Public: { label: "Public", tone: "success" },
  Required: { label: "Required", tone: "neutral" },
  Enabled: { label: "Enabled", tone: "success" },
  Disabled: { label: "Disabled", tone: "default" },
  Trial: { label: "Trial", tone: "info" },
  Scheduled: { label: "Scheduled", tone: "warning" },
  Expired: { label: "Expired", tone: "default" },
  RETIRED: { label: "Retired", tone: "default" },
  "Company users": { label: "Company users", tone: "info" },
  Private: { label: "Private", tone: "neutral" },
  Offline: { label: "Offline", tone: "default" },
  "Not configured": { label: "Not configured", tone: "default" },
  Deleted: { label: "Deleted", tone: "default" },
};

/** The English word for a state; pass the admin translator for the reader's language. */
export function adminStatusLabel(status: string, t?: Translate<"admin">): string {
  const english = STATES[status]?.label ?? status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return t ? adminText(t, `status.${status}`, english) : english;
}

export function AdminStatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("admin");
  return <Badge tone={STATES[status]?.tone ?? "default"} className={className}>{adminStatusLabel(status, t)}</Badge>;
}
