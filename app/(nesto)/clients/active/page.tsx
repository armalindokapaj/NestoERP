import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { ClientsList } from "../clients-list";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.activeClients") };
}

export default async function ClientsSectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("clients");
  const experience = resolveModuleExperience(context, "clients");
  const params = await searchParams;
  const t = await getTranslations("clients");

  return (
    <ModulePage
      experience={experience}
      activeSection="active"
      actions={
        can(context, "client.create") ? (
          <Button asChild size="sm">
            <Link href="/clients/new">{t("common.newClient")}</Link>
          </Button>
        ) : null
      }
    >
      {/* Below the guard, so an unauthorised request is still refused by the
          response itself rather than streamed a 200 (PRD #12 §189). */}
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <ClientsList
          context={context}
          searchParams={params}
          variant="active"
          basePath="/clients/active"
        />
      </Suspense>
    </ModulePage>
  );
}
