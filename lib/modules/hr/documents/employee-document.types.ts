import type { CredentialVerificationStatus, EmployeeDocumentCategory, EmployeeDocumentVisibility, QualificationType } from "@prisma/client";

/**
 * Employee documents as HR files them (E-02 §16-§26, §33, §230; ADR 0007).
 *
 * Every rule a category carries is written here once — its group on the
 * Documents tab, who may read it, who may add it, whether it is checked and
 * whether it runs out — so the service, the access clause, the forms and the
 * docs cannot disagree. The keys are the schema's enum: access never turns on
 * free text (§26). No Prisma client import: pages and forms read this too.
 */

export type { CredentialVerificationStatus, EmployeeDocumentCategory, EmployeeDocumentVisibility };

/**
 * Who beyond the employee may read a category, before visibility narrows it:
 *
 *   PROFESSIONAL  HR's employee file (`hr.document.view`) — diplomas, licences, a CV
 *   EMPLOYMENT    HR-private (`hr.document.private.view`) — contracts, letters (§38, §39)
 *   IDENTITY      HR-private as well, never shown to the group (§42)
 *   COMPENSATION  pay evidence, read as pay is (`hr.compensation.view`) (§40, §41)
 */
export type DocumentClass = "PROFESSIONAL" | "EMPLOYMENT" | "IDENTITY" | "COMPENSATION";

/** The Documents tab's sections (§17, §94). */
export type DocumentGroup = "EMPLOYMENT" | "COMPENSATION" | "EDUCATION" | "CERTIFICATES" | "LICENCES" | "TRAINING" | "OTHER";

export const DOCUMENT_GROUPS: ReadonlyArray<{ key: DocumentGroup; label: string }> = [
  { key: "EMPLOYMENT", label: "Employment" },
  { key: "COMPENSATION", label: "Compensation" },
  { key: "EDUCATION", label: "Education" },
  { key: "CERTIFICATES", label: "Certificates & skills" },
  { key: "LICENCES", label: "Licences" },
  { key: "TRAINING", label: "Training" },
  { key: "OTHER", label: "Other" },
];

export type CategoryRule = {
  label: string;
  group: DocumentGroup;
  class: DocumentClass;
  /** What a new one is filed as unless somebody chooses otherwise (§38, §40, §42-§46). */
  defaultVisibility: EmployeeDocumentVisibility;
  /** What it may be filed as. A salary document is never a group summary; an identity paper never leaves HR and its holder (§42). */
  visibilities: readonly EmployeeDocumentVisibility[];
  /** Whether the employee may add one themselves (§47, §48). */
  selfUpload: boolean;
  /** Whether it is checked by a verifier (§72). HR's own records — a contract, a pay letter — are HR's word, not evidence to check. */
  verifiable: boolean;
  /** Whether it usually runs out, so the form asks for the date up front (§81, §82). Any document may carry one (§80). */
  expiryExpected: boolean;
  /** The qualification it is evidence for, when it is one (§2, §59). */
  qualificationType: QualificationType | null;
};

const EMPLOYMENT_VISIBILITIES = ["EMPLOYEE_AND_HR", "HR_ONLY", "RESTRICTED_MANAGEMENT"] as const;
const COMPENSATION_VISIBILITIES = ["EMPLOYEE_HR_FINANCE", "EMPLOYEE_AND_HR", "HR_ONLY"] as const;
const PROFESSIONAL_VISIBILITIES = ["EMPLOYEE_AND_HR", "GROUP_SUMMARY", "HR_ONLY", "PRIVATE_EMPLOYEE"] as const;

function employment(label: string): CategoryRule {
  return { label, group: "EMPLOYMENT", class: "EMPLOYMENT", defaultVisibility: "EMPLOYEE_AND_HR", visibilities: EMPLOYMENT_VISIBILITIES, selfUpload: false, verifiable: false, expiryExpected: false, qualificationType: null };
}

function compensation(label: string): CategoryRule {
  // Employee, HR, and Finance where Finance has been given access explicitly (§40).
  return { label, group: "COMPENSATION", class: "COMPENSATION", defaultVisibility: "EMPLOYEE_HR_FINANCE", visibilities: COMPENSATION_VISIBILITIES, selfUpload: false, verifiable: false, expiryExpected: false, qualificationType: null };
}

function professional(label: string, group: DocumentGroup, qualificationType: QualificationType | null, options: Partial<Pick<CategoryRule, "expiryExpected" | "defaultVisibility" | "visibilities">> = {}): CategoryRule {
  return {
    label,
    group,
    class: "PROFESSIONAL",
    defaultVisibility: options.defaultVisibility ?? "EMPLOYEE_AND_HR",
    visibilities: options.visibilities ?? PROFESSIONAL_VISIBILITIES,
    selfUpload: true,
    verifiable: true,
    expiryExpected: options.expiryExpected ?? false,
    qualificationType,
  };
}

export const CATEGORY_RULES: Record<EmployeeDocumentCategory, CategoryRule> = {
  EMPLOYMENT_CONTRACT: employment("Working contract"),
  CONTRACT_AMENDMENT: employment("Contract amendment"),
  EMPLOYMENT_LETTER: employment("Employment letter"),
  POSITION_CHANGE: employment("Position change"),
  OTHER_HR: employment("Other HR document"),
  SALARY_CHANGE_DOCUMENT: compensation("Salary change document"),
  SALARY_HISTORY_DOCUMENT: compensation("Salary history supporting document"),
  COMPENSATION_STATEMENT: compensation("Compensation statement"),
  DIPLOMA: professional("Diploma", "EDUCATION", "DIPLOMA"),
  DEGREE: professional("Degree", "EDUCATION", "DEGREE"),
  TRANSCRIPT: professional("Transcript", "EDUCATION", null),
  PROFESSIONAL_CERTIFICATE: professional("Professional certificate", "CERTIFICATES", "PROFESSIONAL_CERTIFICATE", { expiryExpected: true }),
  SKILLS_CERTIFICATE: professional("Skills certificate", "CERTIFICATES", "SKILLS_CERTIFICATE"),
  LANGUAGE_CERTIFICATE: professional("Language certificate", "CERTIFICATES", "LANGUAGE_CERTIFICATE"),
  PROFESSIONAL_LICENSE: professional("Professional licence", "LICENCES", "PROFESSIONAL_LICENSE", { expiryExpected: true }),
  // The summary may be shown if the company allows; the file stays restricted (§45).
  DRIVING_LICENSE: professional("Driving licence", "LICENCES", "DRIVING_LICENSE", { expiryExpected: true }),
  EQUIPMENT_LICENSE: professional("Equipment licence", "LICENCES", "EQUIPMENT_LICENSE", { expiryExpected: true }),
  // Restricted by default; reminders still go out (§44). HR must be able to see it.
  WORK_PERMIT: professional("Work permit", "LICENCES", "WORK_PERMIT", { expiryExpected: true, visibilities: ["EMPLOYEE_AND_HR", "HR_ONLY"] }),
  // A verified safety certificate is what a site needs to know about (§46).
  SAFETY_CERTIFICATE: professional("Safety certificate", "TRAINING", "SAFETY_CERTIFICATE", { expiryExpected: true, defaultVisibility: "GROUP_SUMMARY" }),
  TRAINING_CERTIFICATE: professional("Training certificate", "TRAINING", "TRAINING_CERTIFICATE", { expiryExpected: true }),
  CV: professional("CV", "OTHER", null),
  OTHER_PROFESSIONAL: professional("Other professional document", "OTHER", "OTHER"),
  // Never group-visible, and HR-private: an identity paper is not professional evidence (§42).
  IDENTITY_DOCUMENT: { label: "Identity document", group: "OTHER", class: "IDENTITY", defaultVisibility: "HR_ONLY", visibilities: ["HR_ONLY", "EMPLOYEE_AND_HR"], selfUpload: false, verifiable: true, expiryExpected: true, qualificationType: null },
};

export const EMPLOYEE_DOCUMENT_CATEGORIES = Object.keys(CATEGORY_RULES) as EmployeeDocumentCategory[];

export function categoriesOfClass(...classes: DocumentClass[]): EmployeeDocumentCategory[] {
  return EMPLOYEE_DOCUMENT_CATEGORIES.filter((category) => classes.includes(CATEGORY_RULES[category].class));
}

/** The category a qualification's supporting file is filed as (§2, §59). */
export function categoryForQualification(type: QualificationType): EmployeeDocumentCategory {
  const match = EMPLOYEE_DOCUMENT_CATEGORIES.find((category) => CATEGORY_RULES[category].qualificationType === type);
  return match ?? (type === "SKILL" ? "SKILLS_CERTIFICATE" : "OTHER_PROFESSIONAL");
}

export const VISIBILITY_LABELS: Record<EmployeeDocumentVisibility, string> = {
  PRIVATE_EMPLOYEE: "Only the employee",
  EMPLOYEE_AND_HR: "Employee and HR",
  HR_ONLY: "HR only",
  EMPLOYEE_HR_FINANCE: "Employee, HR and authorised Finance",
  RESTRICTED_MANAGEMENT: "HR and authorised management",
  GROUP_SUMMARY: "Employee and HR; verified summary to colleagues",
};

export const VERIFICATION_LABELS: Record<CredentialVerificationStatus, string> = {
  UNVERIFIED: "Unverified",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  SUPERSEDED: "Superseded",
};

/* Expiry (§80-§85) ---------------------------------------------------------- */

/** Within this many days an expiry date is "expiring" on a card, in a count and in the HR queue (§95, §154). */
export const EXPIRING_SOON_DAYS = 30;
/** When the expiry reminders go out, days before the date; and once more when it has passed (§85). */
export const EXPIRY_WINDOWS = [90, 60, 30, 7] as const;

export type ExpiryState = "NONE" | "VALID" | "EXPIRING" | "EXPIRED";

/** Where a date stands against today (both `YYYY-MM-DD`): expired the day after it, expiring within 30 days. */
export function expiryStateOf(expiryDate: string | null, today: string): { state: ExpiryState; days: number | null } {
  if (!expiryDate) return { state: "NONE", days: null };
  const days = Math.round((Date.parse(`${expiryDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000);
  if (days < 0) return { state: "EXPIRED", days };
  return { state: days <= EXPIRING_SOON_DAYS ? "EXPIRING" : "VALID", days };
}

/** The reminder window a date falls in today: the smallest of 90/60/30/7 it is within, "EXPIRED" once past, null otherwise. */
export function expiryWindowOf(expiryDate: string, today: string): (typeof EXPIRY_WINDOWS)[number] | "EXPIRED" | null {
  const { state, days } = expiryStateOf(expiryDate, today);
  if (state === "EXPIRED") return "EXPIRED";
  if (days === null) return null;
  const within = EXPIRY_WINDOWS.filter((window) => days <= window);
  return within.length ? within[within.length - 1]! : null;
}

/* Shapes --------------------------------------------------------------------- */

export type PersonRef = { name: string; personId: string | null };

export type EmployeeDocumentFileDTO = {
  documentId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  versionNumber: number | null;
  /** Upload and scan state: only AVAILABLE can be opened (§197). */
  storageStatus: string;
  archived: boolean;
  href: string;
};

export type EmployeeDocumentActions = {
  canEdit: boolean;
  canVerify: boolean;
  canReject: boolean;
  canResubmit: boolean;
  canRenew: boolean;
  canSupersede: boolean;
  canArchive: boolean;
  canReplaceFile: boolean;
};

export type EmployeeDocumentDTO = {
  id: string;
  employeeId: string;
  category: EmployeeDocumentCategory;
  categoryLabel: string;
  group: DocumentGroup;
  title: string;
  visibility: EmployeeDocumentVisibility;
  verificationStatus: CredentialVerificationStatus;
  /** Whether verification applies to this category at all. */
  verifiable: boolean;
  issuer: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isCurrent: boolean;
  archived: boolean;
  archiveReason: string | null;
  expiry: ExpiryState;
  daysToExpiry: number | null;
  supersededBy: { id: string; title: string } | null;
  supersedes: { id: string; title: string } | null;
  amends: { id: string; title: string } | null;
  verifiedBy: string | null;
  verifiedByMemberId: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  /** A file was uploaded after the decision; that file has not been checked. */
  newFileSinceVerification: boolean;
  file: EmployeeDocumentFileDTO;
  createdBy: string | null;
  createdByMemberId: string | null;
  createdAt: string;
  /** What a change must name, so a stale page is told rather than overwriting (§192). */
  version: number;
  actions: EmployeeDocumentActions;
};

/**
 * What a colleague may see of a verified document marked for the group (§34,
 * §103): what it is and that it was checked. No number, no note, no file.
 */
export type EmployeeDocumentSummaryDTO = {
  id: string;
  category: EmployeeDocumentCategory;
  categoryLabel: string;
  group: DocumentGroup;
  title: string;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
};

/** A file uploaded on the employment and not yet filed as anything (§54): HR-private until it is. */
export type UnfiledDocumentDTO = EmployeeDocumentFileDTO & { name: string; uploadedAt: string };

export type DocumentGroupCountDTO = { group: DocumentGroup; label: string; count: number; expiring: number; unverified: number };

export type EmployeeDocumentsDTO = {
  employeeId: string;
  personId: string;
  name: string;
  isSelf: boolean;
  documents: EmployeeDocumentDTO[];
  summaries: EmployeeDocumentSummaryDTO[];
  unfiled: UnfiledDocumentDTO[];
  /** Counts over what this reader was given, never over what they were not (§95, §98). */
  groups: DocumentGroupCountDTO[];
  capabilities: {
    /** Categories this reader may add a document in, with the visibilities they may choose. */
    addable: Array<{ category: EmployeeDocumentCategory; visibilities: EmployeeDocumentVisibility[] }>;
    /** Whether the employment still takes files: an ended one keeps its history but takes no more. */
    open: boolean;
  };
};
