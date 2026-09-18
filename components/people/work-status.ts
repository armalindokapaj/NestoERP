import type { WorkStatus } from "@/lib/modules/people/people.types";

/** A colleague's status in words (E-01 §22): a state, never its reason. */
export const WORK_STATUS: Record<WorkStatus, { label: string; tone: "success" | "info" | "warning" | "default" }> = {
  ACTIVE: { label: "Active", tone: "success" },
  ON_LEAVE: { label: "On leave", tone: "info" },
  SUSPENDED: { label: "Suspended", tone: "warning" },
  INACTIVE: { label: "No longer here", tone: "default" },
};
