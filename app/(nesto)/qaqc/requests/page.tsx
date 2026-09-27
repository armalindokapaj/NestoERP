import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { QaqcExportLink } from "@/components/qaqc/export-link";
import { QaqcListSection } from "@/components/qaqc/qaqc-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.requests") };
}

/** Inspection requests: Somebody asking for an inspection. Quality picks it up and carries it out. */
export default async function QaqcRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.request.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();

  return (
    <ModulePage
      experience={experience}
      activeSection="requests"
      description={t("descriptions.requests")}
      actions={
        <>
          {can(context, "qaqc.export") ? (
            <QaqcExportLink type="requests" search={query} />
          ) : null}
          {can(context, "qaqc.request.create") ? (
            <Button asChild size="sm">
              <Link href="/qaqc/requests/new">{t("common.requestInspection")}</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <QaqcListSection context={context} kind="requests" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
