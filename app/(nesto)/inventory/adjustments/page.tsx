import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { DocumentListSection } from "@/components/inventory/document-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.adjustments") };
}

/** Adjustments: Corrections to what the company believes it holds, without anything physically moving. */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.adjustment.view")) redirect("/access-denied");

  const t = await getTranslations("inventory");
  const experience = resolveModuleExperience(context, "inventory");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="adjustments"
      actions={
        can(context, "inventory.adjustment.create") ? (
          <Button asChild size="sm">
            <Link href="/inventory/adjustments/new">{t("meta.newAdjustment")}</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <DocumentListSection context={context} kind="adjustments" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
