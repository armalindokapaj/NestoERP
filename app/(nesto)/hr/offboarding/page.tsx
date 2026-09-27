import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserRoundMinus } from "lucide-react";

import { ProgressTable } from "@/components/hr/progress-table";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listProgress } from "@/lib/modules/hr/employees/progress.service";

export const metadata: Metadata = { title: "Offboarding" };

/**
 * Employment readiness for people leaving (PRD #16 §122–§127).
 *
 * Ending employment opens offboarding; it does not remove company access. That
 * stays a Team action, taken by somebody who holds Team's permission — and
 * nothing is reassigned automatically (PRD #16 §126, §127).
 */
export default async function OffboardingPage() {
  const context = await requireModule("hr");

  if (!can(context, "hr.offboarding.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hr");
  const rows = await listProgress(context, "offboarding");

  return (
    <ModulePage experience={experience} activeSection="offboarding">
      <div className="space-y-4">
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          Ending employment does not remove company access. Deactivating a membership is a Team
          action, taken deliberately by somebody who holds that permission.
        </p>

        {rows.length === 0 ? (
          <EmptyState
            icon={<UserRoundMinus />}
            title="No employees currently offboarding."
            description="People whose employment is ending, or whose offboarding is still open, appear here."
          />
        ) : (
          <ProgressTable
            rows={rows}
            total={rows.total}
            kind="offboarding"
            dateLabel="Last day"
            canManage={can(context, "hr.offboarding.manage")}
          />
        )}
      </div>
    </ModulePage>
  );
}
