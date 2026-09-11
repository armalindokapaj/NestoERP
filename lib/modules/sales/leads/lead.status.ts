import type { LeadStatus } from "@prisma/client";

/**
 * Lead lifecycle (PRD #17 §34, §229).
 *
 * ARCHIVED is unreachable through this table: archiving is its own action with
 * its own guard, and restore reads `preArchiveStatus` rather than picking a
 * status to land on (PRD #17 §57, §58).
 */
const TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "DISQUALIFIED"],
  CONTACTED: ["QUALIFIED", "DISQUALIFIED"],
  QUALIFIED: ["DISQUALIFIED", "CONVERTED"],
  DISQUALIFIED: [],
  CONVERTED: [],
  ARCHIVED: [],
};

export function canTransitionLeadStatus(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/**
 * A converted lead is history (PRD #17 §46, §234).
 *
 * It records what the company knew before the opportunity existed. Editing it
 * afterwards would rewrite the story of where the deal came from.
 */
export const EDITABLE_LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "DISQUALIFIED",
];

export function isLeadEditable(status: LeadStatus): boolean {
  return EDITABLE_LEAD_STATUSES.includes(status);
}

/** Only a qualified lead converts (PRD #17 §51). */
export function isLeadConvertible(status: LeadStatus): boolean {
  return status === "QUALIFIED";
}

/**
 * Archiving is not a way of closing out live commercial work (PRD #17 §57).
 *
 * A qualified lead is somebody the company decided to pursue; parking it out of
 * sight needs an explicit disqualification first, so the reason survives.
 */
export const ARCHIVABLE_LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "DISQUALIFIED"];

export function isLeadArchivable(status: LeadStatus): boolean {
  return ARCHIVABLE_LEAD_STATUSES.includes(status);
}

export const leadStatusLabels: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  DISQUALIFIED: "Disqualified",
  CONVERTED: "Converted",
  ARCHIVED: "Archived",
};

export const leadSourceLabels = {
  WEBSITE: "Website",
  REFERRAL: "Referral",
  OUTBOUND: "Outbound",
  EVENT: "Event",
  PARTNER: "Partner",
  SOCIAL: "Social",
  DIRECT: "Direct",
  OTHER: "Other",
} as const;

/**
 * Why a lead went nowhere (PRD #17 §421).
 *
 * Offered as a list in the UI and stored as text, so a company can say what
 * actually happened without the product needing a migration for it.
 */
export const DISQUALIFY_REASONS = [
  "Not a fit",
  "No budget",
  "No response",
  "Duplicate",
  "Invalid contact",
  "Other",
] as const;
