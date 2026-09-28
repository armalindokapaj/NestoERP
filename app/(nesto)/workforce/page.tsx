import type { Metadata } from "next";
import { HardHat } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkerTable } from "@/components/workforce/workforce-tables";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { hrLabel } from "@/components/hr/hr-labels";
import { ACCOUNT_STATUSES } from "@/lib/modules/hr/hr.person";
import { WORKER_CATEGORIES } from "@/lib/modules/hr/hr.schema";
import { accountStatusLabels, employmentStatusLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";
import { listWorkers, workerFilterOptions } from "@/lib/modules/workforce/workforce.directory";
import { parseWorkerQuery, WORKER_SORT_KEYS } from "@/lib/modules/workforce/workforce.schema";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("workforce"))("meta.workforce") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The workforce directory (E-04 §18, §19, §136, §137): everybody the company
 * employs — office and site, with a NESTO account or without — by trade, crew,
 * project and site. Filters offer only what the reader can already see.
 */
export default async function WorkforcePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await requireModule("workforce");
  if (!can(context, "workforce.view")) redirect("/access-denied");
  const params = await searchParams;
  const query = parseWorkerQuery(params);
  const [result, options, t, th] = await Promise.all([listWorkers(context, query), workerFilterOptions(context), getTranslations("workforce"), getTranslations("hr")]);

  const filters: FilterConfig[] = [
    { param: "workerCategory", label: t("workers.category"), options: WORKER_CATEGORIES.map((value) => ({ value, label: hrLabel(th, "workerCategory", value, workerCategoryLabels[value]) })) },
    ...(options.trades.length ? [{ param: "tradeId", label: t("workers.trade"), options: options.trades.map((trade) => ({ value: trade.id, label: trade.name })) }] : []),
    ...(options.crews.length ? [{ param: "crewId", label: t("workers.crew"), options: options.crews.map((crew) => ({ value: crew.id, label: crew.name })) }] : []),
    ...(options.projects.length ? [{ param: "projectId", label: t("workers.project"), options: options.projects.map((project) => ({ value: project.id, label: project.name })) }] : []),
    { param: "accountStatus", label: t("workers.account"), options: ACCOUNT_STATUSES.map((value) => ({ value, label: hrLabel(th, "accountStatus", value, accountStatusLabels[value]) })) },
    { param: "status", label: t("workers.status"), options: Object.entries(employmentStatusLabels).map(([value, label]) => ({ value, label: hrLabel(th, "employmentStatus", value, label) })) },
  ];
  const filtered = Boolean(query.search || query.workerCategory || query.tradeId || query.crewId || query.projectId || query.siteId || query.accountStatus || query.status);

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/workforce", params, result.pagination.page));
  const buildHref = (page: number) => pageHref("/workforce", params, page);

  return (
    <ModulePage experience={resolveModuleExperience(context, "workforce")} activeSection="workers">
      <div className="space-y-4">
        <ListToolbar
          // English: "Search name, employee number or job title…" (AUD-05 §5).
          searchPlaceholder={t("workers.searchPlaceholder")}
          filters={filters}
          sortOptions={[
            { value: "name-asc", label: t("workers.sortNameAsc") },
            { value: "name-desc", label: t("workers.sortNameDesc") },
            { value: "number-asc", label: t("workers.sortCode") },
            { value: "trade-asc", label: t("workers.sortTrade") },
          ]}
        />
        {result.data.length === 0 ? (
          filtered ? (
            <EmptyState icon={<HardHat />} title={t("workers.noMatchTitle")} description={t("workers.noMatchDescription")} action={{ label: t("workers.clearFilters"), href: "/workforce" }} />
          ) : (
            <EmptyState icon={<HardHat />} title={t("workers.emptyTitle")} description={t("workers.emptyDescription")} />
          )
        ) : (
          <>
            <WorkerTable workers={result.data} sort={{ value: query.sort, keys: WORKER_SORT_KEYS }} />
            <Pagination meta={result.pagination} buildHref={buildHref} />
          </>
        )}
      </div>
    </ModulePage>
  );
}
