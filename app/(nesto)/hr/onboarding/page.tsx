import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserRoundPlus } from "lucide-react";

import { ProgressTable } from "@/components/hr/progress-table";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { listProgress } from "@/lib/modules/hr/employees/progress.service";

export const metadata: Metadata = { title: "Onboarding" };

/**
 * Employment readiness for people joining (PRD #16 §116–§121).
 *
 * A status, not a checklist. Onboarding tasks are canonical Task records with
 * HR context, so there is no second task engine here (PRD #16 §118, §119).
 */
export default async function OnboardingPage() {
  const context = await requireModule("hr");

  if (!can(context, "hr.onboarding.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hr");
  const rows = await listProgress(context, "onboarding");

  return (
    <ModulePage experience={experience} activeSection="onboarding">
      {rows.length === 0 ? (
        <EmptyState
          icon={<UserRoundPlus />}
          title="No employees currently onboarding."
          description="People who are joining, or whose onboarding is still open, appear here."
        />
      ) : (
        <ProgressTable
          rows={rows}
          kind="onboarding"
          dateLabel="Starts"
          canManage={can(context, "hr.onboarding.manage")}
        />
      )}
    </ModulePage>
  );
}
