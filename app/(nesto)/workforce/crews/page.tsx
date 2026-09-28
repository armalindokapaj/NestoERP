import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { UsersRound } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { CrewFormButton } from "@/components/workforce/workforce-actions";
import { CrewTable } from "@/components/workforce/workforce-tables";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { listCrews } from "@/lib/modules/workforce/crew.service";
import { tradeChoices } from "@/lib/modules/workforce/trade.service";
import { projectChoices, siteChoices, workerChoices } from "@/lib/modules/workforce/workforce.directory";
import { seesWholeCompany } from "@/lib/modules/workforce/workforce.permissions";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("workforce"))("meta.crews") };
}

/**
 * Crews (E-04 §28-§32): the company's, or those on the reader's projects. A
 * crew's supervisor is its foreman, who may have no NESTO account at all.
 */
export default async function CrewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("workforce");
  const archived = (await searchParams).status === "ARCHIVED";
  const crews = await listCrews(context, { status: archived ? "ARCHIVED" : "ACTIVE" });
  const canCreate = can(context, "workforce.crew.manage");
  const t = await getTranslations("workforce");
  const projects = canCreate ? await projectChoices(context) : [];
  const [sites, trades, supervisors] = canCreate ? await Promise.all([siteChoices(context, projects.map((project) => project.id)), tradeChoices(context.companyId), workerChoices(context)]) : [[], [], []];
  const chip = (active: boolean) => cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "workforce")}
      activeSection="crews"
      actions={canCreate ? <CrewFormButton projects={projects} sites={sites} trades={trades} supervisors={supervisors} projectRequired={!seesWholeCompany(context)} /> : null}
    >
      <div className="space-y-4">
        <nav aria-label={t("crews.status")} className="flex gap-2">
          <Link href="/workforce/crews" className={chip(!archived)} aria-current={!archived ? "page" : undefined}>
            {t("crews.inUse")}
          </Link>
          <Link href="/workforce/crews?status=ARCHIVED" className={chip(archived)} aria-current={archived ? "page" : undefined}>
            {t("crews.archived")}
          </Link>
        </nav>
        {crews.length === 0 ? (
          <EmptyState icon={<UsersRound />} title={archived ? t("crews.noArchived") : t("crews.noCrews")} description={archived ? t("crews.archivedDescription") : t("crews.emptyDescription")} />
        ) : (
          <CrewTable crews={crews} />
        )}
      </div>
    </ModulePage>
  );
}
