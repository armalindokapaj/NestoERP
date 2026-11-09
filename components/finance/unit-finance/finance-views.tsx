import Link from "@/components/navigation/nav-link";
import { RegisterSections } from "@/components/navigation/section-registry";

import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

/**
 * The two views under the project's Finance tab — its budget and cost, and its units' collection — shown when the reader has both.
 * Below `lg` the row is not drawn: the views are a level of the top bar's section pill, under the project's sections.
 */
export async function FinanceViews({ projectId, active, both }: { projectId: string; active: "overview" | "units"; both: boolean }) {
  if (!both) return null;
  const t = await getTranslations("finance");
  const views = [
    { key: "overview", label: t("unit.viewOverview"), href: `/projects/${projectId}/finance` },
    { key: "units", label: t("unit.viewUnits"), href: `/projects/${projectId}/finance/units` },
  ] as const;
  return (
    <>
      <RegisterSections label={t("unit.views")} items={views.map((view) => ({ key: view.key, label: view.label, href: view.href, active: view.key === active }))} />
      <nav aria-label={t("unit.views")} className="flex gap-1 max-lg:hidden">
        {views.map((view) => (
          <Link key={view.key} href={view.href} aria-current={view.key === active ? "page" : undefined} className={cn("inline-flex h-8 items-center rounded-md px-3 text-table font-medium touch:h-11", view.key === active ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
            {view.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
