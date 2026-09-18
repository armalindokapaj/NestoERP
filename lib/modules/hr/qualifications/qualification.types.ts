import type { CredentialVerificationStatus, QualificationType, QualificationVisibility, SkillProficiency } from "@prisma/client";

import type { ExpiryState } from "@/lib/modules/hr/documents/employee-document.types";

/**
 * A person's skills and qualifications (E-02 §14, §15, §32, §100-§103; ADR 0007).
 *
 * Held by the person, across the group's companies. Two shapes, kept apart on
 * purpose (§122, §124): the summary a colleague may see of a verified
 * qualification the person shares with the group, and the full record, for the
 * person and for HR. No Prisma client import.
 */

export type { QualificationType, QualificationVisibility, SkillProficiency };

/** The Skills & qualifications tab's sections (§100). */
export type QualificationSection = "SKILLS" | "EDUCATION" | "CERTIFICATES" | "LICENCES" | "TRAINING" | "OTHER";

export const QUALIFICATION_SECTIONS: ReadonlyArray<{ key: QualificationSection; label: string }> = [
  { key: "SKILLS", label: "Skills" },
  { key: "EDUCATION", label: "Education" },
  { key: "CERTIFICATES", label: "Certificates" },
  { key: "LICENCES", label: "Licences" },
  { key: "TRAINING", label: "Training" },
  { key: "OTHER", label: "Other" },
];

export type QualificationTypeRule = {
  label: string;
  section: QualificationSection;
  /** Usually runs out, so the form asks for the date (§81). */
  expiryExpected: boolean;
  /** A skill has a level, not an issuer (§14). */
  hasProficiency: boolean;
};

export const QUALIFICATION_TYPE_RULES: Record<QualificationType, QualificationTypeRule> = {
  SKILL: { label: "Skill", section: "SKILLS", expiryExpected: false, hasProficiency: true },
  DIPLOMA: { label: "Diploma", section: "EDUCATION", expiryExpected: false, hasProficiency: false },
  DEGREE: { label: "Degree", section: "EDUCATION", expiryExpected: false, hasProficiency: false },
  PROFESSIONAL_CERTIFICATE: { label: "Professional certificate", section: "CERTIFICATES", expiryExpected: true, hasProficiency: false },
  SKILLS_CERTIFICATE: { label: "Skills certificate", section: "CERTIFICATES", expiryExpected: false, hasProficiency: false },
  LANGUAGE_CERTIFICATE: { label: "Language certificate", section: "CERTIFICATES", expiryExpected: false, hasProficiency: true },
  PROFESSIONAL_LICENSE: { label: "Professional licence", section: "LICENCES", expiryExpected: true, hasProficiency: false },
  DRIVING_LICENSE: { label: "Driving licence", section: "LICENCES", expiryExpected: true, hasProficiency: false },
  EQUIPMENT_LICENSE: { label: "Equipment licence", section: "LICENCES", expiryExpected: true, hasProficiency: false },
  WORK_PERMIT: { label: "Work permit", section: "LICENCES", expiryExpected: true, hasProficiency: false },
  SAFETY_CERTIFICATE: { label: "Safety certificate", section: "TRAINING", expiryExpected: true, hasProficiency: false },
  TRAINING_CERTIFICATE: { label: "Training certificate", section: "TRAINING", expiryExpected: true, hasProficiency: false },
  OTHER: { label: "Other qualification", section: "OTHER", expiryExpected: false, hasProficiency: false },
};

export const QUALIFICATION_TYPES = Object.keys(QUALIFICATION_TYPE_RULES) as QualificationType[];

export const PROFICIENCY_LABELS: Record<SkillProficiency, string> = {
  BASIC: "Basic",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
  EXPERT: "Expert",
};

export const QUALIFICATION_VISIBILITY_LABELS: Record<QualificationVisibility, string> = {
  PRIVATE: "Only me",
  EMPLOYEE_AND_HR: "Me and HR",
  HR_ONLY: "HR only",
  GROUP_SUMMARY: "Everyone in the group, once verified",
  RESTRICTED: "HR with access to private records",
};

/** What the person may choose for their own; HR-only and restricted are HR's to set (§32). */
export const SELF_VISIBILITIES: readonly QualificationVisibility[] = ["EMPLOYEE_AND_HR", "GROUP_SUMMARY", "PRIVATE"];
export const HR_VISIBILITIES: readonly QualificationVisibility[] = ["EMPLOYEE_AND_HR", "GROUP_SUMMARY", "HR_ONLY", "RESTRICTED"];

export type QualificationFileDTO = {
  documentId: string;
  fileName: string;
  /** Opened only in the company that holds it, by somebody the file's own rules admit (§35, §104). */
  openable: boolean;
  companyName: string;
  href: string | null;
};

export type QualificationActions = {
  canEdit: boolean;
  canVerify: boolean;
  canReject: boolean;
  canResubmit: boolean;
  canRenew: boolean;
  canArchive: boolean;
};

export type QualificationDTO = {
  id: string;
  personId: string;
  type: QualificationType;
  typeLabel: string;
  section: QualificationSection;
  title: string;
  issuer: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  proficiency: SkillProficiency | null;
  verificationStatus: CredentialVerificationStatus;
  visibility: QualificationVisibility;
  isCurrent: boolean;
  archived: boolean;
  archiveReason: string | null;
  expiry: ExpiryState;
  daysToExpiry: number | null;
  supersededBy: { id: string; title: string } | null;
  supersedes: { id: string; title: string } | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  newFileSinceVerification: boolean;
  recordedIn: { id: string; name: string };
  file: QualificationFileDTO | null;
  createdAt: string;
  /** What a change must name, so a stale page is told rather than overwriting (§192). */
  version: number;
  actions: QualificationActions;
};

/** A colleague's view (§36, §37, §103): verified, shared with the group, current. No number, no note, no file. */
export type QualificationSummaryDTO = {
  id: string;
  type: QualificationType;
  typeLabel: string;
  section: QualificationSection;
  title: string;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  proficiency: SkillProficiency | null;
};

export type PersonQualificationsDTO = {
  personId: string;
  isSelf: boolean;
  /** The full records this reader may see — their own, or as HR. Null when they see summaries only. */
  records: QualificationDTO[] | null;
  summaries: QualificationSummaryDTO[];
  capabilities: {
    canAdd: boolean;
    /** Visibilities this reader may choose when adding. */
    visibilities: QualificationVisibility[];
    /** Where a supporting file would be filed: the person's employment in this company, if they have one. */
    fileEmploymentId: string | null;
  };
};
