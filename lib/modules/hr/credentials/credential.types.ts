import type { CredentialVerificationStatus } from "@prisma/client";

/**
 * HR's credential worklists (E-02 §153, §154): what waits to be checked, what
 * runs out within 30 days, what has run out. Documents and qualifications
 * side by side, each linking to where it is acted on. No Prisma client import.
 */

export type CredentialWorklistView = "verify" | "expiring" | "expired";

export const CREDENTIAL_WORKLIST_VIEWS: ReadonlyArray<{ key: CredentialWorklistView; label: string }> = [
  { key: "verify", label: "To verify" },
  { key: "expiring", label: "Expiring in 30 days" },
  { key: "expired", label: "Expired" },
];

export type CredentialWorkItemDTO = {
  id: string;
  kind: "employee_document" | "person_qualification";
  /** "Document" or "Qualification", with what it is: its category or type. */
  kindLabel: string;
  title: string;
  personName: string;
  issuer: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  verificationStatus: CredentialVerificationStatus;
  /** When it was put on file, for the order things wait in. */
  createdAt: string;
  /** Where it is opened and acted on. */
  href: string;
};

export type CredentialWorklistDTO = {
  view: CredentialWorklistView;
  /** The views this reader has: "To verify" only for somebody who verifies. */
  views: CredentialWorklistView[];
  counts: Record<CredentialWorklistView, number>;
  items: CredentialWorkItemDTO[];
  /** More waiting than one page shows. */
  truncated: boolean;
};
