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
import { LeaveList } from "./leave-list";

export const metadata: Metadata = { title: "Leave" };

/**
 * Leave requests (PRD #16 §73).
 *
 * The same route serves both readers: with `hr.leave.view` it is the company's
 * leave within scope, and with self-service alone it is the reader's own — the
 * service decides which, not this page (PRD #16 §16).
 */
export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hr");

  if (!can(context, "hr.leave.view") && !can(context, "hr.self.leave")) {
    redirect("/access-denied");
  }

  const experience = resolveModuleExperience(context, "hr");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="leave"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "hr.export") ? <HrExportLink type="leave" /> : null}
          {can(context, "hr.leave.create") || can(context, "hr.self.leave") ? (
            <Button asChild size="sm">
              <Link href="/hr/leave/new">Request leave</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <LeaveList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
