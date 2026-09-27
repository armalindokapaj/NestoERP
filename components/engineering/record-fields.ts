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
import { engineeringEn } from "@/lib/i18n/modules/engineering/en";
import { engineeringLabel, type EngineeringLabelGroup } from "@/lib/i18n/modules/engineering/labels";
import { createTranslator, type Translate } from "@/lib/i18n/translator";
import type { FormField } from "./form-kit";

/**
 * The fields of every contractor and engineering form (PRD #46 §17, §20, §25,
 * §33, §41, §60, §83, §99, §119). Pure: one description drives the create and
 * the edit dialog, so both say the same thing the schema expects.
 */

const choose = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: labels[value] }));

/** English when the caller has no reader (tests, pure helpers). */
const english: Translate<"engineering"> = createTranslator("en", engineeringEn);

/** An engineering choice list in the reader's language, the config's English as the fallback. */
const chooseIn = <T extends string>(t: Translate<"engineering">, group: EngineeringLabelGroup, values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: engineeringLabel(t, group, value, labels[value]) }));
const options = (items: Option[] | undefined) => (items ?? []).map((item) => ({ value: item.id, label: item.label }));

export type ProjectOptions = { contractors: Option[]; workPackages: Array<Option & { contractorId?: string | null }>; members: Option[]; reviewers: Option[]; suppliers?: Option[] };

export function rfiFields(opts: ProjectOptions, mode: "create" | "edit", status = "DRAFT", t: Translate<"engineering"> = english): FormField[] {
  const locked = mode === "edit" && status !== "DRAFT";
  return [
    { name: "subject", label: t("fields.subject"), type: "text", required: true, wide: true, disabled: locked, hint: locked ? t("fields.subjectLocked") : undefined },
    { name: "question", label: t("fields.question"), type: "textarea", required: true, rows: 5, disabled: locked, placeholder: t("fields.questionPlaceholder") },
    { name: "priority", label: t("fields.priority"), type: "select", required: true, options: chooseIn(t, "priority", RFI_PRIORITIES, RFI_PRIORITY_LABELS) },
    { name: "discipline", label: t("fields.discipline"), type: "select", options: chooseIn(t, "discipline", DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "assignedToMemberId", label: t("fields.assignTo"), type: "select", options: options(opts.reviewers), emptyLabel: t("fields.nobodyYet") },
    { name: "dueAt", label: t("fields.responseDue"), type: "date", hint: mode === "create" ? t("fields.responseDueHint") : undefined },
    { name: "contractorId", label: t("fields.contractor"), type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: t("fields.workPackage"), type: "select", options: options(opts.workPackages) },
    { name: "raisedByText", label: t("fields.raisedByOutside"), type: "text", placeholder: t("fields.raisedByPlaceholder"), wide: true },
    ...(mode === "create"
      ? ([
          { name: "rfiNumber", label: t("fields.rfiNumber"), type: "text", placeholder: t("fields.nextNumber"), hint: t("fields.autoNumber") },
          { name: "open", label: t("fields.openNow"), type: "checkbox", hint: t("fields.openNowHint"), wide: true },
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
export function submittalFields(opts: ProjectOptions, mode: "create" | "edit", t: Translate<"engineering"> = english): FormField[] {
  const material = (values: Record<string, string | boolean>) => isMaterialSubmittal(String(values.submittalType ?? ""));
  const method = (values: Record<string, string | boolean>) => isMethodSubmittal(String(values.submittalType ?? ""));
  return [
    { name: "title", label: t("fields.title"), type: "text", required: true, wide: true },
    { name: "submittalType", label: t("fields.type"), type: "select", required: true, options: chooseIn(t, "submittalType", SUBMITTAL_TYPES, SUBMITTAL_TYPE_LABELS) },
    { name: "discipline", label: t("fields.discipline"), type: "select", options: chooseIn(t, "discipline", DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "contractorId", label: t("fields.contractor"), type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: t("fields.workPackage"), type: "select", options: options(opts.workPackages) },
    { name: "assignedReviewerMemberId", label: t("fields.reviewer"), type: "select", options: options(opts.reviewers), emptyLabel: t("fields.nobodyYet") },
    { name: "dueAt", label: t("fields.reviewDue"), type: "date" },
    { name: "specificationReference", label: t("fields.specificationReference"), type: "text", wide: true },
    { name: "manufacturer", label: t("fields.manufacturer"), type: "text", visible: material, whenHidden: "clear" },
    { name: "productName", label: t("fields.product"), type: "text", visible: material, whenHidden: "clear" },
    { name: "modelNumber", label: t("fields.model"), type: "text", visible: material, whenHidden: "clear" },
    ...(opts.suppliers?.length ? ([{ name: "supplierId", label: t("fields.supplier"), type: "select", options: options(opts.suppliers), visible: material, whenHidden: "clear", hint: t("fields.supplierHint") }] satisfies FormField[]) : []),
    { name: "activity", label: t("fields.activity"), type: "text", visible: method, whenHidden: "clear" },
    { name: "workArea", label: t("fields.workArea"), type: "text", visible: method, whenHidden: "clear" },
    { name: "description", label: t("fields.description"), type: "textarea", rows: 3 },
    ...(mode === "create" ? ([{ name: "submittalNumber", label: t("fields.submittalNumber"), type: "text", placeholder: t("fields.nextNumber"), hint: t("fields.autoNumber") }] satisfies FormField[]) : []),
  ];
}

export function documentFields(opts: ProjectOptions, drawing = false, t: Translate<"engineering"> = english): FormField[] {
  return [
    { name: "documentNumber", label: drawing ? t("fields.drawingNumber") : t("fields.documentNumber"), type: "text", required: true, placeholder: drawing ? "ARC-SD-023" : "STR-CALC-011" },
    { name: "documentType", label: t("fields.type"), type: "select", required: true, options: chooseIn(t, "documentType", DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS) },
    { name: "title", label: t("fields.title"), type: "text", required: true, wide: true },
    { name: "discipline", label: t("fields.discipline"), type: "select", required: true, options: chooseIn(t, "discipline", DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "authorText", label: t("fields.author"), type: "text", placeholder: t("fields.authorPlaceholder") },
    { name: "contractorId", label: t("fields.contractor"), type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: t("fields.workPackage"), type: "select", options: options(opts.workPackages) },
    { name: "responsibleMemberId", label: t("fields.responsible"), type: "select", options: options(opts.members) },
    { name: "reviewerMemberId", label: t("fields.reviewer"), type: "select", options: options(opts.reviewers), emptyLabel: t("fields.nobodyYet") },
    { name: "reviewDueAt", label: t("fields.reviewDue"), type: "date" },
  ];
}

export function transmittalHeaderFields(opts: Pick<ProjectOptions, "contractors" | "workPackages">, t: Translate<"engineering"> = english): FormField[] {
  return [
    { name: "direction", label: t("fields.direction"), type: "select", required: true, options: chooseIn(t, "direction", TRANSMITTAL_DIRECTIONS, TRANSMITTAL_DIRECTION_LABELS) },
    { name: "purpose", label: t("fields.purpose"), type: "select", required: true, options: chooseIn(t, "purpose", TRANSMITTAL_PURPOSES, TRANSMITTAL_PURPOSE_LABELS) },
    { name: "subject", label: t("fields.subject"), type: "text", wide: true },
    { name: "contractorId", label: t("fields.contractor"), type: "select", options: options(opts.contractors) },
    { name: "workPackageId", label: t("fields.workPackage"), type: "select", options: options(opts.workPackages) },
    { name: "senderText", label: t("fields.from"), type: "text" },
    { name: "recipientText", label: t("fields.to"), type: "text" },
    { name: "notes", label: t("fields.notes"), type: "textarea", rows: 2 },
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
