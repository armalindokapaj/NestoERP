import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { DocumentListSection } from "@/components/inventory/document-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = { title: "Issues" };

/** Issues: Material leaving stock for a project or for general use. */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.issue.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "inventory");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="issues"
      actions={
        can(context, "inventory.issue.create") ? (
          <Button asChild size="sm">
            <Link href="/inventory/issues/new">New issue</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <DocumentListSection context={context} kind="issues" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
