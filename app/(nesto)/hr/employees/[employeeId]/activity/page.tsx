import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import { listEmployeeActivity } from "@/lib/modules/hr/hr.activity";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";
import { getTranslations } from "@/lib/i18n/server";
import { listPageRedirect } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.employeeActivity") };
}

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
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/hr/employees/${employeeId}/activity`, query, activity.pagination.page));

  const t = await getTranslations("hr");
  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await employeeBreadcrumbs(employee, t("tabs.activity"))}
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
          title={t("activity.emptyTitle")}
          description={t("activity.emptyDescription")}
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  <span className="font-medium">{entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : t("activity.someone")}</span>{" "}
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
