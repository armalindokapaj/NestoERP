import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { SkeletonTable } from "@/components/ui/loading-state";
import { TasksList } from "../tasks-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("meta.archived") };
}

export default async function TasksSectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("tasks");
  const experience = resolveModuleExperience(context, "tasks");
  const params = await searchParams;
  const t = await getTranslations("tasks");

  return (
    <ModulePage
      experience={experience}
      activeSection="archived"
      actions={
        can(context, "task.create") ? (
          <Button asChild size="sm">
            <Link href="/tasks/new">{t("common.newTask")}</Link>
          </Button>
        ) : null
      }
    >
      {/*
        * A Suspense boundary *inside* the page, below `requireModule`, so the
        * guard has already run and refused an unauthorised request before any
        * markup streams. A route-level loading.tsx would open the boundary
        * above the guard and turn a refusal into a 200 (PRD #11 §151).
        */}
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <TasksList
          context={context}
          searchParams={params}
          variant="archived"
          basePath="/tasks/archived"
        />
      </Suspense>
    </ModulePage>
  );
}
