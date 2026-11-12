import { redirect } from "next/navigation";

import { Layers3 } from "@/components/icons";
import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { TabPendingDot } from "@/components/modules/tab-pending-dot";
import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";
import { CommercialStatusBadge, moneyLabel } from "@/components/sales/unit-sales/commercial-status";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeaderFrame } from "@/components/ui/page-header";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { numberText } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { listUnitsOverview, UNIT_STATUS_VIEWS, UNITS_PAGE_SIZE, type UnitStatusView, type UnitsOverviewRow } from "@/lib/modules/project-structure/units-overview.service";
import { listPageRedirect, paginationMeta } from "@/lib/modules/shared/list-query";

/**
 * Sales units (/sales/units; docs/unit-sales.md): the page the phone's Sales
 * units, the top bar's Units and the Sales tab's Units set open. Every unit
 * this person may see, by project, building and floor; for a reader who may
 * see the units' sales, its status, price and buyer, and the views All, For
 * sale, Reserved and Sold as tabs. A row opens the unit's sales page
 * (`SalesUnitPage`), never the unit's work page in its project.
 *
 * What it lists and shows is decided by `listUnitsOverview`, through the
 * projects' own door; this page only draws it.
 */

export const SALES_UNITS = "/sales/units";
const BASE = SALES_UNITS;
const VIEW_LABELS = { "for-sale": "forSale", reserved: "reserved", sold: "sold" } as const satisfies Record<UnitStatusView, string>;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/** Whether `/sales/units/<key>` is a status view (For sale, Reserved, Sold) rather than a unit. */
export function isUnitStatusView(key: string): key is UnitStatusView {
  return Object.hasOwn(UNIT_STATUS_VIEWS, key);
}

export async function SalesUnitsPage({ view, search }: { view: UnitStatusView | null; search: Search }) {
  const context = await requireModule("projects");
  const [t, locale] = await Promise.all([getTranslations("projects"), getLocale()]);
  const q = one(search.search);
  const page = Math.max(1, Number.parseInt(one(search.page) ?? "1", 10) || 1);
  const path = view ? `${BASE}/${view}` : BASE;

  const units = await listUnitsOverview(context, { view, q, page }).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  const last = Math.max(1, Math.ceil(units.total / UNITS_PAGE_SIZE));
  if (units.total > 0 && page > last) redirect(listPageRedirect(path, search, last));

  const views = units.counts
    ? [
        { key: "all", label: t("unitsOverview.all"), href: BASE, active: view === null, count: units.counts.all },
        ...(Object.keys(UNIT_STATUS_VIEWS) as UnitStatusView[]).map((key) => ({
          key,
          label: t(`unitsOverview.${VIEW_LABELS[key]}`),
          href: `${BASE}/${key}`,
          active: view === key,
          count: units.counts![key],
        })),
      ]
    : null;

  const columns: TableColumn<UnitsOverviewRow>[] = [
    { key: "unit", label: t("unitsOverview.unit"), primary: true, render: (row) => <span className="font-medium tabular-nums">{row.label}</span> },
    { key: "project", label: t("unitsOverview.project"), render: (row) => row.project },
    { key: "where", label: t("unitsOverview.where"), hideBelow: "lg", render: (row) => `${row.building} · ${row.floor}` },
    { key: "type", label: t("unitsOverview.type"), hideBelow: "md", render: (row) => row.unitType },
    {
      key: "area",
      label: t("unitsOverview.area"),
      align: "right",
      hideBelow: "md",
      render: (row) => (row.area === null ? "—" : t("unitsOverview.areaValue", { area: numberText(Number(row.area), { maximumFractionDigits: 2 }, locale) })),
    },
    { key: "bedrooms", label: t("unitsOverview.bedrooms"), align: "right", hideBelow: "xl", render: (row) => row.bedrooms ?? "—" },
  ];
  if (units.canSeeSales) {
    columns.push(
      { key: "status", label: t("unitsOverview.status"), valueType: "status", render: (row) => (row.saleStatus ? <CommercialStatusBadge status={row.saleStatus} /> : "—") },
      { key: "price", label: t("unitsOverview.price"), align: "right", render: (row) => <span className="tabular-nums">{moneyLabel(row.askingPrice, row.currency, locale)}</span> },
      { key: "buyer", label: t("unitsOverview.buyer"), hideBelow: "lg", render: (row) => row.client ?? "—" },
    );
  }

  const empty = q
    ? { title: t("unitsOverview.noMatchTitle"), description: t("unitsOverview.noMatchBody"), action: { label: t("unitsOverview.all"), href: path } }
    : view
      ? { title: t("unitsOverview.viewEmptyTitle"), description: t("unitsOverview.viewEmptyBody") }
      : { title: t("unitsOverview.emptyTitle"), description: t("unitsOverview.emptyBody") };

  return (
    <div className="space-y-5" data-testid="units-overview">
      <PageHeaderFrame kind="module" title={t("unitsOverview.title")} subtitle={units.canSeeSales ? t("unitsOverview.introSales") : t("unitsOverview.intro")} />

      {views ? (
        <ContextTabsFrame label={t("unitsOverview.views")} sections={views}>
          {views.map((tab) => (
            <Link key={tab.key} href={tab.href} navSource="tab" aria-current={tab.active ? "page" : undefined} className={contextTabClass(tab.active)} data-testid={`units-view-${tab.key}`}>
              {tab.label}
              <span className="ml-1.5 text-meta tabular-nums text-fg-subtle">{tab.count}</span>
              <TabPendingDot href={tab.href} />
            </Link>
          ))}
        </ContextTabsFrame>
      ) : null}

      <ListToolbar searchPlaceholder={t("unitsOverview.search")} />

      {units.rows.length === 0 ? (
        <EmptyState icon={<Layers3 />} {...empty} />
      ) : (
        <>
          <DataTable
            caption={t("unitsOverview.caption")}
            columns={columns}
            records={units.rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `${BASE}/${row.id}`}
          />
          <Pagination meta={paginationMeta(units.total, units.page, UNITS_PAGE_SIZE)} basePath={path} searchParams={search} />
        </>
      )}
    </div>
  );
}
