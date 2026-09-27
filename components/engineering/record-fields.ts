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
import { contractorsEn } from "@/lib/i18n/modules/contractors/en";
import { contractorsLabel, type ContractorsLabelGroup } from "@/lib/i18n/modules/contractors/labels";
import { createTranslator, type Translate } from "@/lib/i18n/translator";
import type { FormField } from "./form-kit";

/**
 * The fields of every contractor and engineering form (PRD #46 §17, §20, §25,
 * §33, §41, §60, §83, §99, §119). Pure: one description drives the create and
 * the edit dialog, so both say the same thing the schema expects.
 */

/** English when the caller has no reader (tests, pure helpers). */
const english: Translate<"engineering"> = createTranslator("en", engineeringEn);

/** An engineering choice list in the reader's language, the config's English as the fallback. */
const chooseIn = <T extends string>(t: Translate<"engineering">, group: EngineeringLabelGroup, values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: engineeringLabel(t, group, value, labels[value]) }));
/** The contractor forms' English, and their choice lists in the reader's language. */
const englishContractors: Translate<"contractors"> = createTranslator("en", contractorsEn);
const chooseContractors = <T extends string>(t: Translate<"contractors">, group: ContractorsLabelGroup, values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: contractorsLabel(t, group, value, labels[value]) }));
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

export function contractorFields(suppliers: Option[], mode: "create" | "edit", t: Translate<"contractors"> = englishContractors): FormField[] {
  return [
    { name: "legalName", label: t("fields.legalName"), type: "text", required: true, wide: true },
    { name: "tradingName", label: t("fields.tradingName"), type: "text" },
    { name: "status", label: t("fields.status"), type: "select", required: true, options: chooseContractors(t, "contractorStatus", EDITABLE_CONTRACTOR_STATUSES, CONTRACTOR_STATUS_LABELS) },
    { name: "registrationNumber", label: t("fields.registrationNumber"), type: "text" },
    { name: "vatNumber", label: t("fields.vatNumber"), type: "text" },
    { name: "email", label: t("fields.email"), type: "email" },
    { name: "phone", label: t("fields.phone"), type: "tel" },
    { name: "website", label: t("fields.website"), type: "text" },
    { name: "countryCode", label: t("fields.countryCode"), type: "text", placeholder: "AL" },
    { name: "addressLine1", label: t("fields.address"), type: "text", wide: true },
    // The schema has always had these; without them every edit erased them (AUD-09 §4, FV-05).
    { name: "addressLine2", label: t("fields.addressLine2"), type: "text", wide: true },
    { name: "city", label: t("fields.city"), type: "text" },
    { name: "region", label: t("fields.region"), type: "text" },
    { name: "postalCode", label: t("fields.postalCode"), type: "text" },
    { name: "primaryContactName", label: t("fields.primaryContact"), type: "text" },
    { name: "primaryContactEmail", label: t("fields.contactEmail"), type: "email" },
    { name: "primaryContactPhone", label: t("fields.contactPhone"), type: "tel" },
    ...(suppliers.length ? ([{ name: "supplierId", label: t("fields.linkedSupplier"), type: "select", options: options(suppliers), hint: t("fields.linkedSupplierHint"), wide: true }] satisfies FormField[]) : []),
    ...(mode === "edit" ? ([{ name: "statusReason", label: t("fields.statusReason"), type: "text", wide: true }] satisfies FormField[]) : []),
    { name: "notes", label: t("fields.notes"), type: "textarea", rows: 3 },
  ];
}

export function contactFields(t: Translate<"contractors"> = englishContractors): FormField[] {
  return [
    { name: "name", label: t("fields.name"), type: "text", required: true },
    { name: "roleTitle", label: t("fields.jobTitle"), type: "text" },
    { name: "contactRole", label: t("fields.contactRole"), type: "select", options: chooseContractors(t, "contactRole", CONTACT_ROLES, CONTACT_ROLE_LABELS) },
    { name: "email", label: t("fields.email"), type: "email" },
    { name: "phone", label: t("fields.phone"), type: "tel" },
    { name: "active", label: t("fields.activeContact"), type: "checkbox" },
    { name: "notes", label: t("fields.notes"), type: "textarea", rows: 2 },
  ];
}

export function assignmentFields(opts: { contractors?: Array<Option & { assigned?: boolean; contacts: Option[] }>; members: Option[]; contracts: Option[] }, contractorId: string | null, mode: "create" | "edit", t: Translate<"contractors"> = englishContractors): FormField[] {
  const contacts = opts.contractors?.find((item) => item.id === contractorId)?.contacts ?? [];
  return [
    ...(mode === "create" ? ([{ name: "contractorId", label: t("fields.contractor"), type: "select", required: true, emptyLabel: t("fields.chooseContractor"), options: (opts.contractors ?? []).filter((item) => !item.assigned).map((item) => ({ value: item.id, label: item.label })), wide: true }] satisfies FormField[]) : []),
    { name: "status", label: t("fields.status"), type: "select", required: true, options: chooseContractors(t, "assignmentStatus", EDITABLE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS) },
    { name: "internalManagerMemberId", label: t("fields.internalManager"), type: "select", options: options(opts.members) },
    { name: "scopeSummary", label: t("fields.scope"), type: "textarea", rows: 2, placeholder: t("fields.scopePlaceholder") },
    { name: "primaryContractorContactId", label: t("fields.contractorContact"), type: "select", options: options(contacts), hint: mode === "create" ? t("fields.contractorContactHint") : undefined },
    ...(opts.contracts.length ? ([{ name: "contractId", label: t("fields.contract"), type: "select", options: options(opts.contracts), hint: t("fields.contractHint") }] satisfies FormField[]) : []),
    { name: "startDate", label: t("fields.start"), type: "date" },
    { name: "endDate", label: t("fields.end"), type: "date" },
  ];
}

export function workPackageFields(opts: { contractors: Option[]; contracts: Option[]; members: Option[]; canSetValue: boolean }, mode: "create" | "edit", t: Translate<"contractors"> = englishContractors): FormField[] {
  return [
    { name: "name", label: t("fields.name"), type: "text", required: true, wide: true },
    { name: "code", label: t("fields.code"), type: "text", placeholder: mode === "create" ? t("fields.nextCode") : undefined, hint: mode === "create" ? t("fields.codeHint") : undefined },
    { name: "status", label: t("fields.status"), type: "select", required: true, options: chooseContractors(t, "workPackageStatus", EDITABLE_WORK_PACKAGE_STATUSES, WORK_PACKAGE_STATUS_LABELS) },
    { name: "discipline", label: t("fields.discipline"), type: "select", options: chooseContractors(t, "discipline", DISCIPLINES, DISCIPLINE_LABELS) },
    { name: "contractorId", label: t("fields.contractor"), type: "select", options: options(opts.contractors) },
    { name: "responsibleMemberId", label: t("fields.responsible"), type: "select", options: options(opts.members) },
    ...(opts.contracts.length ? ([{ name: "contractId", label: t("fields.contract"), type: "select", options: options(opts.contracts) }] satisfies FormField[]) : []),
    { name: "plannedStartDate", label: t("fields.plannedStart"), type: "date" },
    { name: "plannedFinishDate", label: t("fields.plannedFinish"), type: "date" },
    { name: "forecastStartDate", label: t("fields.forecastStart"), type: "date" },
    { name: "forecastFinishDate", label: t("fields.forecastFinish"), type: "date" },
    { name: "actualStartDate", label: t("fields.actualStart"), type: "date" },
    ...(opts.canSetValue
      ? ([
          { name: "value", label: t("fields.value"), type: "text", placeholder: "0.00", hint: t("fields.valueHint") },
          { name: "currency", label: t("fields.currency"), type: "text", placeholder: "EUR" },
        ] satisfies FormField[])
      : []),
    { name: "description", label: t("fields.description"), type: "textarea", rows: 3 },
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
export function complianceFields(documents: Option[], opts: { waived?: boolean; evidence?: boolean } = {}, t: Translate<"contractors"> = englishContractors): FormField[] {
  const held = [...(opts.waived ? [{ value: KEEP_WAIVER, label: t("fields.keepWaiver") }] : []), { value: "VALID", label: t("fields.onFile") }, { value: "MISSING", label: t("fields.missing") }];
  return [
    { name: "type", label: t("fields.type"), type: "select", required: true, options: chooseContractors(t, "complianceType", COMPLIANCE_TYPES, COMPLIANCE_TYPE_LABELS) },
    { name: "title", label: t("fields.title"), type: "text", required: true },
    { name: "status", label: t("fields.held"), type: "select", required: true, options: held, hint: opts.waived ? t("fields.heldWaivedHint") : t("fields.heldHint") },
    { name: "referenceNumber", label: t("fields.reference"), type: "text" },
    { name: "issuer", label: t("fields.issuer"), type: "text" },
    { name: "issuedAt", label: t("fields.issued"), type: "date" },
    { name: "expiresAt", label: t("fields.expires"), type: "date" },
    // Present whenever the reader may see files, so an edit never silently drops the evidence it already has.
    ...(opts.evidence === false
      ? []
      : ([{ name: "documentId", label: t("fields.evidence"), type: "select", options: options(documents), emptyLabel: documents.length ? t("fields.noEvidence") : t("fields.uploadFirst"), hint: t("fields.evidenceHint"), wide: true }] satisfies FormField[])),
    { name: "notes", label: t("fields.notes"), type: "textarea", rows: 2 },
  ];
}
