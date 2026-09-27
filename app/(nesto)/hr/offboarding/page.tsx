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
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.offboarding") };
}

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
  const t = await getTranslations("hr");

  return (
    <ModulePage experience={experience} activeSection="offboarding">
      <div className="space-y-4">
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("progress.offboardingNote")}
        </p>

        {rows.length === 0 ? (
          <EmptyState
            icon={<UserRoundMinus />}
            title={t("progress.offboardingEmptyTitle")}
            description={t("progress.offboardingEmptyDescription")}
          />
        ) : (
          <ProgressTable
            rows={rows}
            total={rows.total}
            kind="offboarding"
            dateLabel={t("progress.lastDay")}
            canManage={can(context, "hr.offboarding.manage")}
          />
        )}
      </div>
    </ModulePage>
  );
}
