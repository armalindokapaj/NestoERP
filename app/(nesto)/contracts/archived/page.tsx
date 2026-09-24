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

export const metadata: Metadata = { title: "Archived" };

/** Archived contracts, read-only until restored (PRD #18 §93, §499). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("contracts");
  if (!can(context, "legal.contract.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "contracts");
  const params = await searchParams;
  const search = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as [string, string]] : [],
    ),
  ).toString();

  return (
    <ModulePage
      experience={experience}
      activeSection="all"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "legal.export") ? <ContractExportLink search={search} /> : null}
          {can(context, "legal.contract.create") ? (
            <Button asChild size="sm">
              <Link href="/contracts/new">New contract</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <ContractList
          context={context}
          searchParams={params}
          view="archived"
          basePath="/contracts/archived"
          emptyTitle="Nothing is archived."
          emptyDescription="Finished contracts that were put away appear here. Restoring one returns the status it held."
        />
      </Suspense>
    </ModulePage>
  );
}
