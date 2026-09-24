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

export const metadata: Metadata = { title: "Receipts" };

/** Receipts: Material arriving into stock, whether from a Procurement delivery or straight off a lorry. */
export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.receipt.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "inventory");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="receipts"
      actions={
        can(context, "inventory.receipt.create") ? (
          <Button asChild size="sm">
            <Link href="/inventory/receipts/new">New receipt</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <DocumentListSection context={context} kind="receipts" searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
