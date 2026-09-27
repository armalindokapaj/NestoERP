import { z } from "zod";

import {
  bool,
  countryCode,
  currency,
  dateRange,
  expectedVersion,
  idSchema,
  keepAll,
  name,
  optionalAmount,
  optionalDate,
  optionalEmail,
  optionalId,
  optionalRecordNumber,
  optionalText,
  page,
  reason,
} from "@/lib/modules/engineering/engineering.fields";
import { DISCIPLINES } from "@/lib/modules/engineering/engineering.types";
import {
  COMPLIANCE_STATUSES,
  COMPLIANCE_TYPES,
  CONTACT_ROLES,
  CONTRACTOR_STATUSES,
  EDITABLE_ASSIGNMENT_STATUSES,
  EDITABLE_CONTRACTOR_STATUSES,
  EDITABLE_WORK_PACKAGE_STATUSES,
  WORK_PACKAGE_STATUSES,
} from "./contractor.types";

/**
 * Contractor, contact, assignment, work package and compliance validation
 * (PRD #46 §17, §20, §25, §33, §41, §222).
 */

/* Contractors -------------------------------------------------------------- */

const contractorFields = {
  legalName: name("Give the contractor's legal name."),
  tradingName: optionalText(200),
  registrationNumber: optionalText(60),
  vatNumber: optionalText(60),
  email: optionalEmail,
  phone: optionalText(40),
  website: optionalText(200),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  countryCode,
  status: z.enum(EDITABLE_CONTRACTOR_STATUSES as [string, ...string[]]).default("PROSPECTIVE"),
  supplierId: optionalId,
  primaryContactName: optionalText(200),
  primaryContactEmail: optionalEmail,
  primaryContactPhone: optionalText(40),
  notes: optionalText(),
};

export const createContractorSchema = z.object({
  ...contractorFields,
  /** A duplicate is a warning, never a merge: the writer confirms they meant it (§16). */
  confirmDuplicate: bool,
});
export type CreateContractorInput = z.infer<typeof createContractorSchema>;

/**
 * An edit names what it changes (AUD-09 §4, FV-05): every field but the legal
 * name may be absent and is then kept. The supplier link is offered only to
 * readers of Procurement's suppliers, so their colleagues' edits used to
 * unlink it; the address line 2 and region were never in the dialog at all.
 */
const { legalName: contractorLegalName, ...contractorOptional } = contractorFields;
export const updateContractorSchema = z.object({ legalName: contractorLegalName, ...keepAll(contractorOptional), statusReason: optionalText(2_000), expectedVersion });
export type UpdateContractorInput = z.infer<typeof updateContractorSchema>;

export const archiveContractorSchema = z.object({ status: z.enum(["OFFBOARDED", "ARCHIVED"]), reason: optionalText(2_000), expectedVersion });
export const reactivateContractorSchema = z.object({ status: z.enum(["ACTIVE", "PROSPECTIVE"]), reason, expectedVersion });

export const contractorListSchema = z.object({
  q: optionalText(100),
  status: z.enum(CONTRACTOR_STATUSES).optional(),
  compliance: z.enum(["alerts"]).optional(),
  projectId: optionalId,
  includeArchived: bool,
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ContractorListQuery = z.infer<typeof contractorListSchema>;

export const duplicateCheckSchema = z.object({
  legalName: optionalText(200),
  registrationNumber: optionalText(60),
  vatNumber: optionalText(60),
  email: optionalEmail,
  supplierId: optionalId,
  excludeId: optionalId,
});

/* Contacts ----------------------------------------------------------------- */

const contactFields = {
  name: name("Give the contact's name."),
  roleTitle: optionalText(120),
  contactRole: z.enum(CONTACT_ROLES).optional().nullable().transform((value) => value ?? null),
  email: optionalEmail,
  phone: optionalText(40),
  active: z.boolean().default(true),
  notes: optionalText(2_000),
};
export const contactSchema = z.object(contactFields);
export type ContactInput = z.infer<typeof contactSchema>;
/** An edit of a contact: an absent `active` no longer reactivates a retired contact (AUD-09 §4, FV-05). */
const { name: contactName, ...contactOptional } = contactFields;
export const updateContactSchema = z.object({ name: contactName, ...keepAll(contactOptional) });
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/* Project assignments ------------------------------------------------------ */

const assignmentFields = {
  status: z.enum(EDITABLE_ASSIGNMENT_STATUSES as [string, ...string[]]).default("PLANNED"),
  scopeSummary: optionalText(2_000),
  contractId: optionalId,
  internalManagerMemberId: optionalId,
  primaryContractorContactId: optionalId,
  startDate: optionalDate,
  endDate: optionalDate,
};
const assignmentRange = dateRange<{ startDate: string | null; endDate: string | null }>([["startDate", "endDate"]]);

export const createAssignmentSchema = z.object({ contractorId: idSchema, ...assignmentFields }).superRefine(assignmentRange);
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
/**
 * An edit names what it changes (AUD-09 §4, FV-05): the contract is offered
 * only to readers of Legal's agreements, so an absent one is kept, as is
 * anything else not sent. The start/end order against what is stored is the
 * service's check.
 */
export const updateAssignmentSchema = z
  .object({ ...keepAll(assignmentFields), expectedVersion })
  .superRefine((value, ctx) => assignmentRange({ startDate: value.startDate ?? null, endDate: value.endDate ?? null }, ctx));
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export const terminateAssignmentSchema = z.object({ reason, endDate: optionalDate, expectedVersion });

/* Work packages ------------------------------------------------------------ */

type WorkPackageDates = Record<"plannedStartDate" | "plannedFinishDate" | "forecastStartDate" | "forecastFinishDate" | "actualStartDate" | "actualFinishDate", string | null>;
const workPackageRanges = dateRange<WorkPackageDates>([
  ["plannedStartDate", "plannedFinishDate"],
  ["forecastStartDate", "forecastFinishDate"],
  ["actualStartDate", "actualFinishDate"],
]);

const workPackageFields = {
  name: name(),
  description: optionalText(),
  discipline: z.enum(DISCIPLINES).optional().nullable().transform((value) => value ?? null),
  status: z.enum(EDITABLE_WORK_PACKAGE_STATUSES as [string, ...string[]]).default("PLANNED"),
  contractorId: optionalId,
  contractId: optionalId,
  responsibleMemberId: optionalId,
  plannedStartDate: optionalDate,
  plannedFinishDate: optionalDate,
  forecastStartDate: optionalDate,
  forecastFinishDate: optionalDate,
  actualStartDate: optionalDate,
  actualFinishDate: optionalDate,
  value: optionalAmount,
  currency,
};

export const createWorkPackageSchema = z.object({ code: optionalRecordNumber, ...workPackageFields }).superRefine(workPackageRanges);
export type CreateWorkPackageInput = z.infer<typeof createWorkPackageSchema>;
export const updateWorkPackageSchema = z.object({ code: optionalRecordNumber, ...workPackageFields, expectedVersion }).superRefine(workPackageRanges);
export type UpdateWorkPackageInput = z.infer<typeof updateWorkPackageSchema>;
export const completeWorkPackageSchema = z.object({ actualFinishDate: optionalDate, expectedVersion });
export const archiveWorkPackageSchema = z.object({ expectedVersion });

export const workPackageListSchema = z.object({
  q: optionalText(100),
  status: z.enum(WORK_PACKAGE_STATUSES).optional(),
  contractorId: optionalId,
  projectId: optionalId,
  discipline: z.enum(DISCIPLINES).optional(),
  includeArchived: bool,
  page,
});
export type WorkPackageListQuery = z.infer<typeof workPackageListSchema>;

/* Compliance --------------------------------------------------------------- */

const complianceFields = {
  type: z.enum(COMPLIANCE_TYPES),
  title: name("Give the requirement a title."),
  /** VALID or MISSING; EXPIRING and EXPIRED follow from the expiry date (§48). */
  status: z.enum(["VALID", "MISSING"]).default("VALID"),
  documentId: optionalId,
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  issuer: optionalText(200),
  referenceNumber: optionalText(100),
  notes: optionalText(2_000),
};
const complianceRange = dateRange<{ issuedAt: string | null; expiresAt: string | null }>([["issuedAt", "expiresAt"]]);

export const createComplianceSchema = z.object(complianceFields).superRefine(complianceRange);
export type ComplianceInput = z.infer<typeof createComplianceSchema>;
/**
 * An edit names what it changes (AUD-09 §4, FV-05). Absent evidence is kept —
 * a reader who cannot open files is never shown it — and an absent status
 * keeps a waiver rather than resetting it to "on file".
 */
export const updateComplianceSchema = z
  .object({ type: complianceFields.type, title: complianceFields.title, ...keepAll({ status: complianceFields.status, documentId: complianceFields.documentId, issuedAt: complianceFields.issuedAt, expiresAt: complianceFields.expiresAt, issuer: complianceFields.issuer, referenceNumber: complianceFields.referenceNumber, notes: complianceFields.notes }) })
  .superRefine((value, ctx) => complianceRange({ issuedAt: value.issuedAt ?? null, expiresAt: value.expiresAt ?? null }, ctx));
export type UpdateComplianceInput = z.infer<typeof updateComplianceSchema>;
export const waiveComplianceSchema = z.object({ reason });

export const complianceListSchema = z.object({
  status: z.enum(COMPLIANCE_STATUSES).optional(),
  type: z.enum(COMPLIANCE_TYPES).optional(),
  alerts: bool,
  q: optionalText(100),
  page,
});
export type ComplianceListQuery = z.infer<typeof complianceListSchema>;
