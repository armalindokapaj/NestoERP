import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { HseListSection } from "@/components/hse/hse-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "PPE checks" };

/** PPE checks: Whether the protective equipment was there and being worn. */
export default async function HsePpePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("hse");
  if (!can(context, "hse.ppe.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "hse");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="ppe"
      description="Whether the protective equipment was there and being worn."
      actions={
        <>
          {can(context, "hse.ppe.create") ? (
            <Button asChild size="sm">
              <Link href="/hse/ppe/new">New PPE check</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <HseListSection context={context} kind="ppe" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
