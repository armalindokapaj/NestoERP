import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { financeExperience } from "@/lib/modules/finance/finance.workspace";
import { InvoicesList } from "./invoices-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.invoices") };
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("finance");

  // The section's own permission, not just the module's: an Architect reaches
  // Finance but never its invoices (PRD #15 §15). In the Group workspace the
  // list asks each company for it and says so when none has it (§76).
  const group = inGroupWorkspace(context);
  if (!group && !can(context, "finance.invoice.view")) redirect("/access-denied");

  const t = await getTranslations("finance");
  const experience = await financeExperience(context);
  const params = await searchParams;
  const archived = params.archived === "1";

  return (
    <ModulePage
      experience={experience}
      activeSection="invoices"
      actions={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={archived ? "/finance/invoices" : "/finance/invoices?archived=1"}>
              {archived ? t("invoices.active") : t("list.archived")}
            </Link>
          </Button>
          {!group && can(context, "finance.invoice.create") ? (
            <Button asChild size="sm">
              <Link href="/finance/invoices/new">{t("overview.newInvoice")}</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      {/* Below the guard, so an unauthorised request is refused by the response
          itself rather than streamed a 200 (PRD #15 §218). */}
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <InvoicesList
          context={context}
          searchParams={params}
          archived={archived}
          basePath="/finance/invoices"
        />
      </Suspense>
    </ModulePage>
  );
}
