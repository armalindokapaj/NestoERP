import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HrExportLink } from "@/components/hr/export-link";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { AttendanceList } from "./attendance-list";

export const metadata: Metadata = { title: "Attendance" };

/** Attendance days (PRD #16 §97). */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hr");

  if (!can(context, "hr.attendance.view") && !can(context, "hr.self.attendance")) {
    redirect("/access-denied");
  }

  const experience = resolveModuleExperience(context, "hr");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="attendance"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "hr.export") ? <HrExportLink type="attendance" /> : null}
          {can(context, "hr.attendance.create") || can(context, "hr.self.attendance") ? (
            <Button asChild size="sm">
              <Link href="/hr/attendance/new">Record a day</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <AttendanceList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
