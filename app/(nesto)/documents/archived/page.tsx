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
import { DocumentsList } from "../documents-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents");
  return { title: t("meta.archivedDocuments") };
}

export default async function DocumentsSectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("documents");
  const experience = resolveModuleExperience(context, "documents");
  const params = await searchParams;
  const t = await getTranslations("documents");

  return (
    <ModulePage
      experience={experience}
      activeSection="archived"
      actions={
        can(context, "document.create") ? (
          <Button asChild size="sm">
            <Link href="/documents/new">{t("overview.addDocument")}</Link>
          </Button>
        ) : null
      }
    >
      {/* Below the guard, so an unauthorised request is refused by the
          response itself rather than streamed a 200 (PRD #13 §182). */}
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <DocumentsList
          context={context}
          searchParams={params}
          variant="archived"
          basePath="/documents/archived"
        />
      </Suspense>
    </ModulePage>
  );
}
