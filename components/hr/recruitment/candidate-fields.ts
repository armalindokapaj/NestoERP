import type { FormField } from "@/components/engineering/form-kit";
import type { RecruitmentOptionsDTO } from "@/lib/modules/hr/recruitment/candidate.options";

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

export function candidateFields(choices: RecruitmentOptionsDTO, companyId: string): FormField[] {
  const inCompany = (item: { companyId: string }) => item.companyId === companyId;
  return [
    { name: "firstName", label: "First name", type: "text", required: true },
    { name: "lastName", label: "Last name", type: "text", required: true },
    { name: "workEmail", label: "Work email", type: "email", hint: "The approved address. It is contact data, not the login." },
    { name: "workPhone", label: "Work phone", type: "text" },
    { name: "personalEmail", label: "Personal email", type: "email" },
    { name: "personalPhone", label: "Personal phone", type: "text" },
    { name: "city", label: "City", type: "text" },
    { name: "country", label: "Country", type: "text" },
    { name: "targetCompanyId", label: "Company", type: "select", required: true, options: options(choices.companies) },
    { name: "targetDepartmentId", label: "Department", type: "select", options: options(choices.departments.filter(inCompany)), emptyLabel: "Not decided yet", hint: "Departments of the chosen company. One of another company is cleared when you save." },
    { name: "targetRoleKey", label: "Role", type: "select", options: options(choices.roles), emptyLabel: "Not decided yet" },
    { name: "targetJobTitle", label: "Job title", type: "text" },
    { name: "hiringManagerUserId", label: "Hiring manager", type: "select", options: options(choices.managers.filter(inCompany)), emptyLabel: "Nobody yet", hint: "People of the chosen company." },
    { name: "interviewStage", label: "Interview stage", type: "text", placeholder: "Second interview" },
    { name: "notes", label: "Notes", type: "textarea", wide: true, rows: 3, hint: "Only people who manage candidates read these." },
  ];
}
