import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ContractExportLink } from "@/components/contracts/export-link";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { ContractList } from "../contract-list";
import { contractSectionSearch } from "@/lib/modules/contracts/contract.query";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.activeContracts") };
}

/** Contracts in force (PRD #18 §89). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("contracts");
  if (!can(context, "legal.contract.view")) redirect("/access-denied");

  const t = await getTranslations("contracts");
  const experience = resolveModuleExperience(context, "contracts");
  const params = await searchParams;
  // The export carries this section's own view, not just the filters (AUD-08 §3, DT-02).
  const search = contractSectionSearch(params, "active");

  return (
    <ModulePage
      experience={experience}
      activeSection="active"
      actions={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {can(context, "legal.export") ? <ContractExportLink search={search} /> : null}
          {can(context, "legal.contract.create") ? (
            <Button asChild size="sm">
              <Link href="/contracts/new">{t("common.newContract")}</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <ContractList
          context={context}
          searchParams={params}
          view="active"
          basePath="/contracts/active"
          emptyTitle={t("views.active.title")}
          emptyDescription={t("views.active.description")}
        />
      </Suspense>
    </ModulePage>
  );
}
