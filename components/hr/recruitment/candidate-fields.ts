import type { FormField } from "@/components/engineering/form-kit";
import type { RecruitmentOptionsDTO } from "@/lib/modules/hr/recruitment/candidate.options";
import type { Translate } from "@/lib/i18n/translator";

const options = (items: Array<{ id: string; label: string }>) => items.map((item) => ({ value: item.id, label: item.label }));

/**
 * The candidate form (E-06 §22, §23): the person first, then where they are
 * being recruited to. A department and a hiring manager belong to the chosen
 * company, so their lists follow it.
 */
/**
 * A department or hiring manager of another company than the one chosen is
 * incompatible with it: cleared — the field's hint says so — rather than sent
 * and refused, or silently shown as "Not decided yet" while still sent
 * (AUD-09 §5, FV-08).
 */
export function withinCompany(payload: Record<string, unknown>, choices: RecruitmentOptionsDTO): Record<string, unknown> {
  const companyId = String(payload.targetCompanyId ?? "");
  // Incompatible only when it is known to belong elsewhere; a value the lists do not hold (a retired department) is the server's to judge.
  const fits = (items: Array<{ id: string; companyId: string }>, id: unknown) => typeof id !== "string" || !id || !items.some((item) => item.id === id && item.companyId !== companyId);
  return {
    ...payload,
    ...(fits(choices.departments, payload.targetDepartmentId) ? {} : { targetDepartmentId: null }),
    ...(fits(choices.managers, payload.hiringManagerUserId) ? {} : { hiringManagerUserId: null }),
  };
}

export function candidateFields(t: Translate<"hr">, choices: RecruitmentOptionsDTO, companyId: string): FormField[] {
  const inCompany = (item: { companyId: string }) => item.companyId === companyId;
  return [
    { name: "firstName", label: t("employmentForm.firstName"), type: "text", required: true },
    { name: "lastName", label: t("employmentForm.lastName"), type: "text", required: true },
    { name: "workEmail", label: t("employee.workEmail"), type: "email", hint: t("candidateFields.workEmailHint") },
    { name: "workPhone", label: t("recruitment.workPhone"), type: "text" },
    { name: "personalEmail", label: t("recruitment.personalEmail"), type: "email" },
    { name: "personalPhone", label: t("recruitment.personalPhone"), type: "text" },
    { name: "city", label: t("recruitment.city"), type: "text" },
    { name: "country", label: t("candidateFields.country"), type: "text" },
    { name: "targetCompanyId", label: t("recruitment.company"), type: "select", required: true, options: options(choices.companies) },
    { name: "targetDepartmentId", label: t("columns.department"), type: "select", options: options(choices.departments.filter(inCompany)), emptyLabel: t("candidateFields.notDecided"), hint: t("candidateFields.departmentHint") },
    { name: "targetRoleKey", label: t("employee.role"), type: "select", options: options(choices.roles), emptyLabel: t("candidateFields.notDecided") },
    { name: "targetJobTitle", label: t("fields.jobTitle"), type: "text" },
    { name: "hiringManagerUserId", label: t("recruitment.hiringManager"), type: "select", options: options(choices.managers.filter(inCompany)), emptyLabel: t("candidateFields.nobodyYet"), hint: t("candidateFields.managerHint") },
    { name: "interviewStage", label: t("recruitment.interviewStage"), type: "text", placeholder: t("candidateFields.stagePlaceholder") },
    { name: "notes", label: t("attendance.notes"), type: "textarea", wide: true, rows: 3, hint: t("candidateFields.notesHint") },
  ];
}
