import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { HseListSection } from "@/components/hse/hse-list";
import { HseExportLink } from "@/components/hse/export-link";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("pages.environment.title") };
}

/** Environment: Spills, dust, noise and waste — recorded, assigned and closed out. */
export default async function HseEnvironmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.environment.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hse");
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();

  return (
    <ModulePage
      experience={experience}
      activeSection="environment"
      description={t("pages.environment.description")}
      actions={
        <>
          {can(context, "hse.export") ? (
            <HseExportLink kind="environment" search={query} />
          ) : null}
          {can(context, "hse.environment.create") ? (
            <Button asChild size="sm">
              <Link href="/hse/environment/new">{t("list.create.environment")}</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <HseListSection context={context} kind="environment" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
