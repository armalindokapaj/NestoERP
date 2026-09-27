import { CONTACT_ROLES, CONTACT_ROLE_LABELS, COMPLIANCE_TYPES, COMPLIANCE_TYPE_LABELS, EDITABLE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS, EDITABLE_CONTRACTOR_STATUSES, CONTRACTOR_STATUS_LABELS, EDITABLE_WORK_PACKAGE_STATUSES, WORK_PACKAGE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import {
  DISCIPLINES,
  DISCIPLINE_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  RFI_PRIORITIES,
  RFI_PRIORITY_LABELS,
  SUBMITTAL_TYPES,
  SUBMITTAL_TYPE_LABELS,
  TRANSMITTAL_DIRECTIONS,
  TRANSMITTAL_DIRECTION_LABELS,
  TRANSMITTAL_PURPOSES,
  TRANSMITTAL_PURPOSE_LABELS,
  isMaterialSubmittal,
  isMethodSubmittal,
  type Option,
} from "@/lib/modules/engineering/engineering.types";
import type { FormField } from "./form-kit";

/**
 * The fields of every contractor and engineering form (PRD #46 §17, §20, §25,
 * §33, §41, §60, §83, §99, §119). Pure: one description drives the create and
 * the edit dialog, so both say the same thing the schema expects.
 */

const choose = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: labels[value] }));
const options = (items: Option[] | undefined) => (items ?? []).map((item) => ({ value: item.id, label: item.label }));

export type ProjectOptions = { contractors: Option[]; workPackages: Array<Option & { contractorId?: string | null }>; members: Option[]; reviewers: Option[]; suppliers?: Option[] };

export function rfiFields(opts: ProjectOptions, mode: "create" | "edit", status = "DRAFT"): FormField[] {
  const locked = mode === "edit" && status !== "DRAFT";
  return [
    { name: "subject", label: "Subject", type: "text", required: true, wide: true, disabled: locked, hint: locked ? "Fixed once the RFI is open." : undefined },
    { name: "question", label: "Question", type: "textarea", required: true, rows: 5, disabled: locked, placeholder: "What needs answering, with the drawing, grid and level it refers to." },
    { name: "priority", label: "Priority", type: "select", required: true, options: choose(RFI_PRIORITIES, RFI_PRIORITY_LABELS) },
    { name: "discipline", label: "Discipline", type: "select", options: choose(DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "assignedToMemberId", label: "Assign to", type: "select", options: options(opts.reviewers), emptyLabel: "Nobody yet" },
    { name: "dueAt", label: "Response due", type: "date", hint: mode === "create" ? "Left blank, it follows the company's default when opened." : undefined },
    { name: "contractorId", label: "Contractor", type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: "Work package", type: "select", options: options(opts.workPackages) },
    { name: "raisedByText", label: "Raised by (outside the company)", type: "text", placeholder: "e.g. Arben Hoxha, Apex Structural", wide: true },
    ...(mode === "create"
      ? ([
          { name: "rfiNumber", label: "RFI number", type: "text", placeholder: "Next number", hint: "Leave blank to number it automatically." },
          { name: "open", label: "Open it now", type: "checkbox", hint: "Opening sends it to the assignee. A draft can be opened later.", wide: true },
        ] satisfies FormField[])
      : []),
  ];
}

/**
 * The type-dependent submittal fields follow the server's rule (AUD-09 §5,
 * FV-10): hidden for a type they do not describe, and cleared by the server
 * for one — the "clear" policy. The supplier is offered only to readers of
 * Procurement's suppliers; for anybody else it is not sent, and kept.
 */
export function submittalFields(opts: ProjectOptions, mode: "create" | "edit"): FormField[] {
  const material = (values: Record<string, string | boolean>) => isMaterialSubmittal(String(values.submittalType ?? ""));
  const method = (values: Record<string, string | boolean>) => isMethodSubmittal(String(values.submittalType ?? ""));
  return [
    { name: "title", label: "Title", type: "text", required: true, wide: true },
    { name: "submittalType", label: "Type", type: "select", required: true, options: choose(SUBMITTAL_TYPES, SUBMITTAL_TYPE_LABELS) },
    { name: "discipline", label: "Discipline", type: "select", options: choose(DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "contractorId", label: "Contractor", type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: "Work package", type: "select", options: options(opts.workPackages) },
    { name: "assignedReviewerMemberId", label: "Reviewer", type: "select", options: options(opts.reviewers), emptyLabel: "Nobody yet" },
    { name: "dueAt", label: "Review due", type: "date" },
    { name: "specificationReference", label: "Specification reference", type: "text", wide: true },
    { name: "manufacturer", label: "Manufacturer", type: "text", visible: material, whenHidden: "clear" },
    { name: "productName", label: "Product", type: "text", visible: material, whenHidden: "clear" },
    { name: "modelNumber", label: "Model", type: "text", visible: material, whenHidden: "clear" },
    ...(opts.suppliers?.length ? ([{ name: "supplierId", label: "Supplier", type: "select", options: options(opts.suppliers), visible: material, whenHidden: "clear", hint: "Procurement's supplier record; approving a submittal buys nothing." }] satisfies FormField[]) : []),
    { name: "activity", label: "Activity", type: "text", visible: method, whenHidden: "clear" },
    { name: "workArea", label: "Work area", type: "text", visible: method, whenHidden: "clear" },
    { name: "description", label: "Description", type: "textarea", rows: 3 },
    ...(mode === "create" ? ([{ name: "submittalNumber", label: "Submittal number", type: "text", placeholder: "Next number", hint: "Leave blank to number it automatically." }] satisfies FormField[]) : []),
  ];
}

export function documentFields(opts: ProjectOptions, drawing = false): FormField[] {
  return [
    { name: "documentNumber", label: drawing ? "Drawing number" : "Document number", type: "text", required: true, placeholder: drawing ? "ARC-SD-023" : "STR-CALC-011" },
    { name: "documentType", label: "Type", type: "select", required: true, options: choose(DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS) },
    { name: "title", label: "Title", type: "text", required: true, wide: true },
    { name: "discipline", label: "Discipline", type: "select", required: true, options: choose(DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "authorText", label: "Author", type: "text", placeholder: "Design office or consultant" },
    { name: "contractorId", label: "Contractor", type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: "Work package", type: "select", options: options(opts.workPackages) },
    { name: "responsibleMemberId", label: "Responsible", type: "select", options: options(opts.members) },
    { name: "reviewerMemberId", label: "Reviewer", type: "select", options: options(opts.reviewers), emptyLabel: "Nobody yet" },
    { name: "reviewDueAt", label: "Review due", type: "date" },
  ];
}

export function transmittalHeaderFields(opts: Pick<ProjectOptions, "contractors" | "workPackages">): FormField[] {
  return [
    { name: "direction", label: "Direction", type: "select", required: true, options: choose(TRANSMITTAL_DIRECTIONS, TRANSMITTAL_DIRECTION_LABELS) },
    { name: "purpose", label: "Purpose", type: "select", required: true, options: choose(TRANSMITTAL_PURPOSES, TRANSMITTAL_PURPOSE_LABELS) },
    { name: "subject", label: "Subject", type: "text", wide: true },
    { name: "contractorId", label: "Contractor", type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: "Work package", type: "select", options: options(opts.workPackages) },
    { name: "senderText", label: "From", type: "text" },
    { name: "recipientText", label: "To", type: "text" },
    { name: "notes", label: "Notes", type: "textarea", rows: 2 },
  ];
}

export function contractorFields(suppliers: Option[], mode: "create" | "edit"): FormField[] {
  return [
    { name: "legalName", label: "Legal name", type: "text", required: true, wide: true },
    { name: "tradingName", label: "Trading name", type: "text" },
    { name: "status", label: "Status", type: "select", required: true, options: choose(EDITABLE_CONTRACTOR_STATUSES, CONTRACTOR_STATUS_LABELS) },
    { name: "registrationNumber", label: "Registration number", type: "text" },
    { name: "vatNumber", label: "VAT number", type: "text" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "website", label: "Website", type: "text" },
    { name: "countryCode", label: "Country code", type: "text", placeholder: "AL" },
    { name: "addressLine1", label: "Address", type: "text", wide: true },
    // The schema has always had these; without them every edit erased them (AUD-09 §4, FV-05).
    { name: "addressLine2", label: "Address line 2", type: "text", wide: true },
    { name: "city", label: "City", type: "text" },
    { name: "region", label: "Region", type: "text" },
    { name: "postalCode", label: "Postal code", type: "text" },
    { name: "primaryContactName", label: "Primary contact", type: "text" },
    { name: "primaryContactEmail", label: "Contact email", type: "email" },
    { name: "primaryContactPhone", label: "Contact phone", type: "tel" },
    ...(suppliers.length ? ([{ name: "supplierId", label: "Linked supplier", type: "select", options: options(suppliers), hint: "When the contractor also sells through Procurement. Bank and tax details stay on the supplier.", wide: true }] satisfies FormField[]) : []),
    ...(mode === "edit" ? ([{ name: "statusReason", label: "Reason for a status change", type: "text", wide: true }] satisfies FormField[]) : []),
    { name: "notes", label: "Notes", type: "textarea", rows: 3 },
  ];
}

export const contactFields: FormField[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "roleTitle", label: "Job title", type: "text" },
  { name: "contactRole", label: "Role on our work", type: "select", options: choose(CONTACT_ROLES, CONTACT_ROLE_LABELS) },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "active", label: "Active contact", type: "checkbox" },
  { name: "notes", label: "Notes", type: "textarea", rows: 2 },
];

export function assignmentFields(opts: { contractors?: Array<Option & { assigned?: boolean; contacts: Option[] }>; members: Option[]; contracts: Option[] }, contractorId: string | null, mode: "create" | "edit"): FormField[] {
  const contacts = opts.contractors?.find((item) => item.id === contractorId)?.contacts ?? [];
  return [
    ...(mode === "create" ? ([{ name: "contractorId", label: "Contractor", type: "select", required: true, emptyLabel: "Choose a contractor", options: (opts.contractors ?? []).filter((item) => !item.assigned).map((item) => ({ value: item.id, label: item.label })), wide: true }] satisfies FormField[]) : []),
    { name: "status", label: "Status", type: "select", required: true, options: choose(EDITABLE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS) },
    { name: "internalManagerMemberId", label: "Internal manager", type: "select", options: options(opts.members) },
    { name: "scopeSummary", label: "Scope", type: "textarea", rows: 2, placeholder: "Structural concrete works" },
    { name: "primaryContractorContactId", label: "Contractor's contact", type: "select", options: options(contacts), hint: mode === "create" ? "Contacts of the chosen contractor. Changing the contractor clears one chosen before." : undefined },
    ...(opts.contracts.length ? ([{ name: "contractId", label: "Contract", type: "select", options: options(opts.contracts), hint: "The agreement in Legal." }] satisfies FormField[]) : []),
    { name: "startDate", label: "Start", type: "date" },
    { name: "endDate", label: "End", type: "date" },
  ];
}

export function workPackageFields(opts: { contractors: Option[]; contracts: Option[]; members: Option[]; canSetValue: boolean }, mode: "create" | "edit"): FormField[] {
  return [
    { name: "name", label: "Name", type: "text", required: true, wide: true },
    { name: "code", label: "Code", type: "text", placeholder: mode === "create" ? "Next code" : undefined, hint: mode === "create" ? "Leave blank for WP-001, WP-002…" : undefined },
    { name: "status", label: "Status", type: "select", required: true, options: choose(EDITABLE_WORK_PACKAGE_STATUSES, WORK_PACKAGE_STATUS_LABELS) },
    { name: "discipline", label: "Discipline", type: "select", options: choose(DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "contractorId", label: "Contractor", type: "select", options: options(opts.contractors) },
    { name: "responsibleMemberId", label: "Responsible", type: "select", options: options(opts.members) },
    ...(opts.contracts.length ? ([{ name: "contractId", label: "Contract", type: "select", options: options(opts.contracts) }] satisfies FormField[]) : []),
    { name: "plannedStartDate", label: "Planned start", type: "date" },
    { name: "plannedFinishDate", label: "Planned finish", type: "date" },
    { name: "forecastStartDate", label: "Forecast start", type: "date" },
    { name: "forecastFinishDate", label: "Forecast finish", type: "date" },
    { name: "actualStartDate", label: "Actual start", type: "date" },
    ...(opts.canSetValue
      ? ([
          { name: "value", label: "Value", type: "text", placeholder: "0.00", hint: "Context only — the contract and Finance stay authoritative." },
          { name: "currency", label: "Currency", type: "text", placeholder: "EUR" },
        ] satisfies FormField[])
      : []),
    { name: "description", label: "Description", type: "textarea", rows: 3 },
  ];
}

/** The "Held" choice that keeps a waiver: the dialog leaves `status` out, and the server keeps it (AUD-09 §5, FV-10). */
export const KEEP_WAIVER = "WAIVED";

/**
 * `waived`: the item is waived today, so "keep the waiver" is a choice and the
 * default. `evidence`: the reader may open files; without that the evidence
 * field is not offered and not sent, so the server keeps what is attached
 * rather than being told "none" by somebody who could not see it (AUD-09 §5,
 * FV-10).
 */
export function complianceFields(documents: Option[], opts: { waived?: boolean; evidence?: boolean } = {}): FormField[] {
  const held = [...(opts.waived ? [{ value: KEEP_WAIVER, label: "Waived — keep the waiver" }] : []), { value: "VALID", label: "On file" }, { value: "MISSING", label: "Missing" }];
  return [
    { name: "type", label: "Type", type: "select", required: true, options: choose(COMPLIANCE_TYPES, COMPLIANCE_TYPE_LABELS) },
    { name: "title", label: "Title", type: "text", required: true },
    { name: "status", label: "Held", type: "select", required: true, options: held, hint: opts.waived ? "Choosing On file or Missing withdraws the waiver." : "Expiring and expired follow from the expiry date." },
    { name: "referenceNumber", label: "Reference", type: "text" },
    { name: "issuer", label: "Issuer", type: "text" },
    { name: "issuedAt", label: "Issued", type: "date" },
    { name: "expiresAt", label: "Expires", type: "date" },
    // Present whenever the reader may see files, so an edit never silently drops the evidence it already has.
    ...(opts.evidence === false
      ? []
      : ([{ name: "documentId", label: "Evidence", type: "select", options: options(documents), emptyLabel: documents.length ? "No evidence yet" : "Upload a file first", hint: "A document filed on the contractor or this item.", wide: true }] satisfies FormField[])),
    { name: "notes", label: "Notes", type: "textarea", rows: 2 },
  ];
}
