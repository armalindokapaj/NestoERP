import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { QaqcListSection } from "@/components/qaqc/qaqc-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.materials") };
}

/**
 * Material inspections.
 *
 * The same canonical inspections as /qaqc/inspections, narrowed to one type —
 * not a second table. The filter is fixed in the URL so the section is a real
 * place rather than a saved search somebody has to remember.
 */
export default async function QaqcMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.inspection.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="materials"
      description={t("descriptions.materials")}
      actions={
        can(context, "qaqc.inspection.create") ? (
          <Button asChild size="sm">
            <Link href="/qaqc/inspections/new">{t("common.newInspection")}</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <QaqcListSection
          context={context}
          kind="inspections"
          searchParams={params}
          basePath="/qaqc/materials"
          fixed={{ type: "MATERIAL" }}
        />
      </Suspense>
    </ModulePage>
  );
}
