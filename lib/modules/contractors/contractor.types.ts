import type { Discipline, PersonRef, RecordRef } from "@/lib/modules/engineering/engineering.types";

/**
 * Contractor vocabulary and DTOs (PRD #46 §11-§49, §160-§164).
 *
 * Client-safe. A contractor is an external organisation, its contacts are
 * contact records, and nothing here describes a login (§3, §22).
 */

export const CONTRACTOR_STATUSES = ["PROSPECTIVE", "ACTIVE", "SUSPENDED", "EXPIRED", "OFFBOARDED", "ARCHIVED"] as const;
export type ContractorStatus = (typeof CONTRACTOR_STATUSES)[number];
export const CONTRACTOR_STATUS_LABELS: Record<ContractorStatus, string> = {
  PROSPECTIVE: "Prospective",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
  OFFBOARDED: "Offboarded",
  ARCHIVED: "Archived",
};
/** Statuses set by editing; OFFBOARDED and ARCHIVED leave through their own commands (§18, §19). */
export const EDITABLE_CONTRACTOR_STATUSES: ContractorStatus[] = ["PROSPECTIVE", "ACTIVE", "SUSPENDED", "EXPIRED"];
/** A contractor in these takes no new project assignments or work (§31). */
export const INACTIVE_CONTRACTOR_STATUSES: ContractorStatus[] = ["SUSPENDED", "OFFBOARDED", "ARCHIVED"];

export const CONTACT_ROLES = ["PROJECT_MANAGER", "ENGINEER", "SITE_ENGINEER", "DOCUMENT_CONTROLLER", "COMMERCIAL", "LEGAL", "HSE", "QAQC", "FINANCE", "MANAGEMENT", "OTHER"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  PROJECT_MANAGER: "Project manager",
  ENGINEER: "Engineer",
  SITE_ENGINEER: "Site engineer",
  DOCUMENT_CONTROLLER: "Document controller",
  COMMERCIAL: "Commercial",
  LEGAL: "Legal",
  HSE: "HSE",
  QAQC: "QA/QC",
  FINANCE: "Finance",
  MANAGEMENT: "Management",
  OTHER: "Other",
};

export const ASSIGNMENT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "SUSPENDED", "TERMINATED"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
};
/** Set by editing; TERMINATED only through termination, with a reason (§31). */
export const EDITABLE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "SUSPENDED"];
/** A contractor on the project in one of these takes no new work packages or engineering records (§31). */
export const CLOSED_ASSIGNMENT_STATUSES: AssignmentStatus[] = ["TERMINATED", "COMPLETED"];

export const WORK_PACKAGE_STATUSES = ["PLANNED", "ACTIVE", "AT_RISK", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export type WorkPackageStatus = (typeof WORK_PACKAGE_STATUSES)[number];
export const WORK_PACKAGE_STATUS_LABELS: Record<WorkPackageStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  AT_RISK: "At risk",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
/** Completion is its own command (§40). */
export const EDITABLE_WORK_PACKAGE_STATUSES: WorkPackageStatus[] = ["PLANNED", "ACTIVE", "AT_RISK", "ON_HOLD", "CANCELLED"];
export const OPEN_WORK_PACKAGE_STATUSES: WorkPackageStatus[] = ["PLANNED", "ACTIVE", "AT_RISK", "ON_HOLD"];

export const COMPLIANCE_TYPES = ["INSURANCE", "LICENSE", "CERTIFICATION", "PERFORMANCE_GUARANTEE", "ADVANCE_PAYMENT_GUARANTEE", "BOND", "TAX_DOCUMENT", "HSE_CERTIFICATION", "QA_CERTIFICATION", "OTHER"] as const;
export type ComplianceType = (typeof COMPLIANCE_TYPES)[number];
export const COMPLIANCE_TYPE_LABELS: Record<ComplianceType, string> = {
  INSURANCE: "Insurance",
  LICENSE: "Licence",
  CERTIFICATION: "Certification",
  PERFORMANCE_GUARANTEE: "Performance guarantee",
  ADVANCE_PAYMENT_GUARANTEE: "Advance payment guarantee",
  BOND: "Bond",
  TAX_DOCUMENT: "Tax document",
  HSE_CERTIFICATION: "HSE certification",
  QA_CERTIFICATION: "QA certification",
  OTHER: "Other",
};
/** Guarantees, bonds and insurance are the legal side of compliance (§52). */
export const LEGAL_COMPLIANCE_TYPES: ComplianceType[] = ["INSURANCE", "PERFORMANCE_GUARANTEE", "ADVANCE_PAYMENT_GUARANTEE", "BOND"];

export const COMPLIANCE_STATUSES = ["VALID", "EXPIRING", "EXPIRED", "MISSING", "WAIVED", "ARCHIVED"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];
export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  VALID: "Valid",
  EXPIRING: "Expiring",
  EXPIRED: "Expired",
  MISSING: "Missing",
  WAIVED: "Waived",
  ARCHIVED: "Archived",
};
/** Statuses that count as an alert on a header or register (§164). */
export const COMPLIANCE_ALERT_STATUSES: ComplianceStatus[] = ["EXPIRING", "EXPIRED", "MISSING"];

export type DuplicateWarning = { id: string; legalName: string; status: ContractorStatus; reasons: string[] };

export type ContractorListItemDTO = {
  id: string;
  legalName: string;
  tradingName: string | null;
  status: ContractorStatus;
  countryCode: string | null;
  city: string | null;
  supplier: RecordRef | null;
  primaryContactName: string | null;
  activeProjects: number;
  workPackages: number;
  openRfis: number;
  openSubmittals: number;
  complianceAlerts: number;
  href: string;
};

export type ContractorCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canOffboard: boolean;
  canReactivate: boolean;
  canManageContacts: boolean;
  canAssign: boolean;
  canManageCompliance: boolean;
  canWaiveCompliance: boolean;
  canViewCompliance: boolean;
  canViewContacts: boolean;
  canViewWorkPackages: boolean;
  canViewEngineering: boolean;
  canViewContracts: boolean;
  canViewDocuments: boolean;
  canUploadDocuments: boolean;
  canViewActivity: boolean;
};

export type ContractorDetailDTO = ContractorListItemDTO & {
  registrationNumber: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  region: string | null;
  postalCode: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  notes: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  version: number;
  capabilities: ContractorCapabilities;
};

export type ContactDTO = {
  id: string;
  name: string;
  roleTitle: string | null;
  contactRole: ContactRole | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  notes: string | null;
};

export type AssignmentDTO = {
  id: string;
  project: RecordRef & { code: string | null; archived: boolean };
  contractor: RecordRef & { status: ContractorStatus };
  status: AssignmentStatus;
  scopeSummary: string | null;
  /** Only when the reader can open the contract in Legal (§53, §54). */
  contract: RecordRef | null;
  internalManager: PersonRef | null;
  primaryContact: { id: string; name: string } | null;
  startDate: string | null;
  endDate: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  workPackages: number;
  openRfis: number;
  openSubmittals: number;
  complianceAlerts: number;
  version: number;
  canManage: boolean;
};

export type WorkPackageRowDTO = {
  id: string;
  project: RecordRef;
  code: string;
  name: string;
  discipline: Discipline | null;
  status: WorkPackageStatus;
  contractor: RecordRef | null;
  responsible: PersonRef | null;
  plannedStartDate: string | null;
  plannedFinishDate: string | null;
  forecastFinishDate: string | null;
  actualFinishDate: string | null;
  counts: { openTasks: number; openRfis: number; submittals: number };
  href: string;
};

export type WorkPackageDetailDTO = WorkPackageRowDTO & {
  description: string | null;
  assignmentId: string | null;
  contract: RecordRef | null;
  forecastStartDate: string | null;
  actualStartDate: string | null;
  /** Context only, and only for readers with Finance or Legal access (§36, §157). */
  value: { amount: string; currency: string | null } | null;
  completedAt: string | null;
  completedBy: PersonRef | null;
  archivedAt: string | null;
  counts: WorkPackageRowDTO["counts"] & { documents: number; engineeringDocuments: number; qaqc: number; hse: number; transmittals: number };
  version: number;
  capabilities: { canEdit: boolean; canComplete: boolean; canArchive: boolean; canLink: boolean; canCreateTask: boolean; canViewFiles: boolean; canUploadFiles: boolean };
};

export type ComplianceItemDTO = {
  id: string;
  contractor: RecordRef;
  type: ComplianceType;
  title: string;
  status: ComplianceStatus;
  document: { id: string; name: string; href: string } | null;
  issuedAt: string | null;
  expiresAt: string | null;
  /** Negative once expired. */
  daysToExpiry: number | null;
  issuer: string | null;
  referenceNumber: string | null;
  notes: string | null;
  waivedReason: string | null;
  waivedAt: string | null;
  waivedBy: PersonRef | null;
  archived: boolean;
  canManage: boolean;
  canWaive: boolean;
};
