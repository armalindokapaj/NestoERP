import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { workspaceExperience } from "@/lib/modules/documents/document.workspace";
import { DocumentsList } from "../documents-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents");
  return { title: t("meta.recentDocuments") };
}

export default async function DocumentsSectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("documents");
  const experience = workspaceExperience(context, resolveModuleExperience(context, "documents"));
  const params = await searchParams;
  const t = await getTranslations("documents");

  return (
    <ModulePage
      experience={experience}
      activeSection="recent"
      actions={
        // Creating a document belongs to one company, so the Group workspace
        // offers no upload (Workspace Context §35).
        !inGroupWorkspace(context) && can(context, "document.create") ? (
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
          variant="recent"
          basePath="/documents/recent"
        />
      </Suspense>
    </ModulePage>
  );
}
