import { EmploymentChanges } from "@/components/hr/employment-changes";
import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { employmentChangeOptions } from "@/lib/modules/hr/employment/employment.options";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";

type Params = { params: Promise<{ employeeId: string }> };

/** The record's frame: header and tabs stay mounted while the tab content swaps beneath them. */
export default async function EmployeeTabsLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId);
  const caps = employee.employment;
  const changes = Object.values(caps).some(Boolean) || employee.capabilities.canEditEmployment;
  const t = await getTranslations("hr");
  const options = changes ? await employmentChangeOptions(context, employeeId) : { departments: [], managers: [], documents: [], companies: [] };

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await employeeBreadcrumbs(employee)}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
        badges={<Badge tone="neutral">{hrLabel(t, "employmentType", employee.employmentType)}</Badge>}
        meta={[
          { label: t("columns.department"), value: orDash(employee.department?.name) },
          {
            label: t("columns.manager"),
            value: employee.manager ? (
              <PersonLink memberId={employee.manager.memberId} name={employee.manager.fullName} />
            ) : (
              "—"
            ),
          },
          {
            label: t("columns.started"),
            value: employee.startDate ? formatDate(employee.startDate) : "—",
          },
        ]}
        actions={<EmploymentChanges employee={employee} options={options} today={todayDay()} />}
      />

      <EmployeeTabs
        employeeId={employee.id}
        show={employeeTabVisibility(employee)}
      />

      {children}
    </div>
  );
}
