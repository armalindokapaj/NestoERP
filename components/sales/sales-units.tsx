import { redirect } from "next/navigation";

import { Layers3 } from "@/components/icons";
import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ListToolbar, type FilterConfig, type MoreFilterField } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { CommercialStatusBadge, moneyLabel } from "@/components/sales/unit-sales/commercial-status";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeaderFrame } from "@/components/ui/page-header";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { numberText } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import {
  BEDROOM_FILTERS,
  listUnitsOverview,
  UNIT_STATUS_VIEWS,
  UNITS_PAGE_SIZE,
  type UnitsMoreFilters,
  type UnitsOverview,
  type UnitStatusView,
  type UnitsOverviewRow,
} from "@/lib/modules/project-structure/units-overview.service";
import { listPageRedirect, paginationMeta } from "@/lib/modules/shared/list-query";

/**
 * Sales units (/sales/units; docs/unit-sales.md): the page the phone's Sales
 * units, the Sales tab's Units set and the logo's panel open. Every unit
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
/** The query keys of the More filters (`UnitsMoreFilters`). */
const MORE_PARAMS = ["priceMin", "priceMax", "areaMin", "areaMax", "floorMin", "floorMax", "building", "type"] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/** Whether `/sales/units/<key>` is a status view (For sale, Reserved, Sold) rather than a unit. */
export function isUnitStatusView(key: string): key is UnitStatusView {
  return Object.hasOwn(UNIT_STATUS_VIEWS, key);
}

/** The list with a status chosen in its filters, keeping the rest of the query: where a status view's old address goes. */
export function statusViewHref(view: UnitStatusView, search: Search): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = one(value);
    if (first && key !== "status" && key !== "page") params.set(key, first);
  }
  params.set("status", view);
  return `${BASE}?${params.toString()}`;
}

export async function SalesUnitsPage({ search }: { search: Search }) {
  const context = await requireModule("projects");
  const status = one(search.status);
  // An unknown status lists every unit, as no status does.
  const view = status && isUnitStatusView(status) ? status : null;
  const q = one(search.search);
  const project = one(search.project);
  const bedrooms = one(search.bedrooms);
  const page = Math.max(1, Number.parseInt(one(search.page) ?? "1", 10) || 1);
  const path = BASE;
  const more = Object.fromEntries(MORE_PARAMS.map((param) => [param, one(search[param])])) as UnitsMoreFilters;

  const units = await listUnitsOverview(context, { view, q, project, bedrooms, more, page }).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  const last = Math.max(1, Math.ceil(units.total / UNITS_PAGE_SIZE));
  if (units.total > 0 && page > last) redirect(listPageRedirect(path, search, last));

  return <SalesUnitsView units={units} view={view} search={search} />;
}

/**
 * The list as drawn, from what `listUnitsOverview` returned. On a phone each
 * unit is one compact line — its code and size, where it is, then its price
 * over its status — and everything else waits on the unit's own page. A
 * search and three filters narrow it — status (with its counts), project and
 * bedrooms — inline from md, in a sheet beside the search on a phone. From md
 * it is the table.
 */
export async function SalesUnitsView({ units, view, search }: { units: UnitsOverview; view: UnitStatusView | null; search: Search }) {
  const [t, locale] = await Promise.all([getTranslations("projects"), getLocale()]);
  const q = one(search.search);
  const path = BASE;
  const filtered = Boolean(q || one(search.project) || one(search.bedrooms) || MORE_PARAMS.some((param) => one(search[param])));
  const area = (row: UnitsOverviewRow) => (row.area === null ? null : t("unitsOverview.areaValue", { area: numberText(Number(row.area), { maximumFractionDigits: 2 }, locale) }));

  const columns: TableColumn<UnitsOverviewRow>[] = [
    {
      key: "unit",
      label: t("unitsOverview.unit"),
      primary: true,
      // On a phone the unit's size rides beside its code; the table has its own Area column.
      render: (row) => (
        <>
          <span className="font-medium tabular-nums">{row.label}</span>
          {area(row) ? <span className="ml-2 text-table font-normal tabular-nums text-fg-subtle md:hidden">{area(row)}</span> : null}
        </>
      ),
    },
    { key: "project", label: t("unitsOverview.project"), render: (row) => row.project },
    { key: "where", label: t("unitsOverview.where"), hideBelow: "lg", render: (row) => `${row.building} · ${row.floor}` },
    { key: "type", label: t("unitsOverview.type"), hideBelow: "md", render: (row) => row.unitType },
    { key: "area", label: t("unitsOverview.area"), align: "right", hideBelow: "md", render: (row) => area(row) ?? "—" },
    { key: "bedrooms", label: t("unitsOverview.bedrooms"), align: "right", hideBelow: "xl", render: (row) => row.bedrooms ?? "—" },
  ];
  if (units.canSeeSales) {
    columns.push(
      { key: "status", label: t("unitsOverview.status"), valueType: "status", render: (row) => (row.saleStatus ? <CommercialStatusBadge status={row.saleStatus} /> : "—") },
      { key: "price", label: t("unitsOverview.price"), align: "right", render: (row) => <span className="tabular-nums">{moneyLabel(row.askingPrice, row.currency, locale)}</span> },
      { key: "buyer", label: t("unitsOverview.buyer"), hideBelow: "lg", render: (row) => row.client ?? "—" },
    );
  }

  const counts = units.counts;
  const filters: FilterConfig[] = [
    // The status, with how many units each holds under the other filters; only for a reader who may see the sales.
    ...(counts
      ? [
          {
            param: "status",
            label: t("unitsOverview.status"),
            options: (Object.keys(UNIT_STATUS_VIEWS) as UnitStatusView[]).map((key) => ({ value: key, label: `${t(`unitsOverview.${VIEW_LABELS[key]}`)} · ${counts[key]}` })),
          },
        ]
      : []),
    ...(units.projects.length > 1 ? [{ param: "project", label: t("unitsOverview.project"), options: units.projects.map((entry) => ({ value: entry.id, label: entry.name })) }] : []),
    {
      param: "bedrooms",
      label: t("unitsOverview.bedrooms"),
      options: BEDROOM_FILTERS.map((value) => ({ value, label: value === "0" ? t("unitsOverview.studio") : value === "4+" ? t("unitsOverview.fourOrMore") : value })),
    },
  ];

  // Behind "More filters": what narrows a list once the few above have (UI-07). Price only for whom may see it.
  const moreFields: MoreFilterField[] = [
    ...(units.canSeeSales ? [{ kind: "range" as const, label: t("unitsOverview.price"), minParam: "priceMin", maxParam: "priceMax" }] : []),
    { kind: "range", label: t("unitsOverview.area"), minParam: "areaMin", maxParam: "areaMax", unit: "m²" },
    { kind: "range", label: t("unitsOverview.floor"), minParam: "floorMin", maxParam: "floorMax" },
    ...(units.buildings.length > 1
      ? [
          {
            kind: "select" as const,
            label: t("unitsOverview.building"),
            param: "building",
            options: units.buildings.map((entry) => ({ value: entry.id, label: units.projects.length > 1 ? `${entry.name} · ${entry.project}` : entry.name })),
          },
        ]
      : []),
    ...(units.types.length > 1 ? [{ kind: "select" as const, label: t("unitsOverview.type"), param: "type", options: units.types.map((entry) => ({ value: entry.id, label: entry.name })) }] : []),
  ];

  const empty = filtered
    ? { title: t("unitsOverview.noMatchTitle"), description: t("unitsOverview.noMatchBody"), action: { label: t("unitsOverview.all"), href: path } }
    : view
      ? { title: t("unitsOverview.viewEmptyTitle"), description: t("unitsOverview.viewEmptyBody") }
      : { title: t("unitsOverview.emptyTitle"), description: t("unitsOverview.emptyBody") };

  return (
    // Below lg the top bar names the page: the search and filters sit straight under it, everything tight.
    <div className="space-y-5 max-lg:-mt-2 max-lg:space-y-2.5" data-testid="units-overview">
      {/* Below lg the heading stays for a screen reader only: the top bar already shows it, in the same face. */}
      <PageHeaderFrame
        kind="module"
        title={t("unitsOverview.title")}
        subtitle={units.canSeeSales ? t("unitsOverview.introSales") : t("unitsOverview.intro")}
        className="max-lg:sr-only"
      />

      <ListToolbar
        searchPlaceholder={t("unitsOverview.search")}
        filters={filters}
        more={moreFields}
        applied={{ status: view ?? undefined, project: one(search.project), bedrooms: one(search.bedrooms) }}
      />

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
            mobile={{
              variant: "row",
              // Where it is; the building is in the unit's code.
              subtitle: (row) => `${row.project} · ${row.floor}`,
              // The price over its status, on the right; a reader without the sales sees neither.
              value: units.canSeeSales
                ? (row) => (
                    <span className="flex flex-col items-end gap-1">
                      <span className="tabular-nums">{moneyLabel(row.askingPrice, row.currency, locale)}</span>
                      {row.saleStatus ? <CommercialStatusBadge status={row.saleStatus} /> : null}
                    </span>
                  )
                : undefined,
              label: (row) => [row.label, row.project, row.floor].join(", "),
              facts: [],
            }}
          />
          <Pagination meta={paginationMeta(units.total, units.page, UNITS_PAGE_SIZE)} basePath={path} searchParams={search} />
        </>
      )}
    </div>
  );
}
