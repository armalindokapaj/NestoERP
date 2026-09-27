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
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.onboarding") };
}

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
  const t = await getTranslations("hr");

  return (
    <ModulePage experience={experience} activeSection="onboarding">
      {rows.length === 0 ? (
        <EmptyState
          icon={<UserRoundPlus />}
          title={t("progress.onboardingEmptyTitle")}
          description={t("progress.onboardingEmptyDescription")}
        />
      ) : (
        <ProgressTable
          rows={rows}
          total={rows.total}
          kind="onboarding"
          dateLabel={t("progress.starts")}
          canManage={can(context, "hr.onboarding.manage")}
        />
      )}
    </ModulePage>
  );
}
