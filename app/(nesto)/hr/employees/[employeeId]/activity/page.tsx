import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { listEmployeeActivity } from "@/lib/modules/hr/hr.activity";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";

type Params = {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Employee activity" };

/**
 * One employee's HR history (PRD #16 §136–§138).
 *
 * Read one employee at a time, never as a module-wide feed — a company list of
 * "whose pay changed" is the leak the compensation permission exists to prevent
 * (PRD #16 §137). Amounts never appear in these entries (PRD #16 §270).
 */
export default async function EmployeeActivityTabPage({ params, searchParams }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/activity");

  if (!employee.capabilities.canViewActivity) notFound();

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await listEmployeeActivity(context, employeeId, { page, limit: 25 });

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Activity")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
      />

      <EmployeeTabs
        employeeId={employee.id}
        active="activity"
        show={employeeTabVisibility(employee)}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No HR activity recorded yet."
          description="Employment changes, leave decisions and pay records are listed here. Role and access changes belong to Team."
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  <span className="font-medium">{entry.actor ?? "Someone"}</span>{" "}
                  {entry.message ?? entry.action}
                </p>
                <p className="mt-0.5 text-meta text-fg-subtle">{formatDateTime(entry.createdAt)}</p>
              </li>
            ))}
          </ol>
          <Pagination
            meta={activity.pagination}
            buildHref={(next) =>
              next > 1
                ? `/hr/employees/${employeeId}/activity?page=${next}`
                : `/hr/employees/${employeeId}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
