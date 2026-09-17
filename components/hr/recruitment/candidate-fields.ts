import type { FormField } from "@/components/engineering/form-kit";
import type { RecruitmentOptionsDTO } from "@/lib/modules/hr/recruitment/candidate.options";

const options = (items: Array<{ id: string; label: string }>) => items.map((item) => ({ value: item.id, label: item.label }));

/**
 * The candidate form (E-06 §22, §23): the person first, then where they are
 * being recruited to. A department and a hiring manager belong to the chosen
 * company, so their lists follow it.
 */
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
    { name: "targetDepartmentId", label: "Department", type: "select", options: options(choices.departments.filter(inCompany)), emptyLabel: "Not decided yet" },
    { name: "targetRoleKey", label: "Role", type: "select", options: options(choices.roles), emptyLabel: "Not decided yet" },
    { name: "targetJobTitle", label: "Job title", type: "text" },
    { name: "hiringManagerUserId", label: "Hiring manager", type: "select", options: options(choices.managers.filter(inCompany)), emptyLabel: "Nobody yet" },
    { name: "interviewStage", label: "Interview stage", type: "text", placeholder: "Second interview" },
    { name: "notes", label: "Notes", type: "textarea", wide: true, rows: 3, hint: "Only people who manage candidates read these." },
  ];
}
