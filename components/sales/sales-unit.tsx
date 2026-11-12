import { notFound, redirect } from "next/navigation";

import { UnitFinancePanel } from "@/components/finance/unit-finance/unit-finance-panel";
import { RecordHeader } from "@/components/modules/record-header";
import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";
import { UnitDocuments } from "@/components/project-structure/unit-page/unit-documents";
import { UnitFacts } from "@/components/project-structure/unit-page/unit-facts";
import { UnitMediaGallery } from "@/components/project-structure/unit-page/unit-media";
import { CommercialStatusBadge } from "@/components/sales/unit-sales/commercial-status";
import { SaleContract } from "@/components/sales/unit-sales/sale-contract";
import { UnitSalesPanel } from "@/components/sales/unit-sales/unit-sales-panel";
import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { floorName } from "@/lib/i18n/stock-names";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { financeCapabilities } from "@/lib/modules/finance/units/unit-finance.core";
import { getUnitFinance } from "@/lib/modules/finance/units/unit-finance.service";
import { getUnitDetail } from "@/lib/modules/project-structure/structure.service";
import { listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import type { UnitFilesDTO } from "@/lib/modules/project-structure/unit-publishing.types";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { saleStatusOf } from "@/lib/modules/sales/units/unit-sales.rules";
import { getUnitSales } from "@/lib/modules/sales/units/unit-sales.service";
import { SALES_UNITS } from "./sales-units";

export type SalesUnitTab = "sale" | "contract" | "payments" | "unit" | "files";
const TABS: readonly SalesUnitTab[] = ["sale", "contract", "payments", "unit", "files"];

/**
 * A unit's sales page (/sales/units/<unitId>; docs/unit-sales.md): the part of
 * a unit that comes after the architect's. What the architect made — the
 * data, the areas, the plans and photos — is read here and never changed; the
 * work page in the project (/projects/<id>/units/<id>) is where it is edited.
 *
 * Sections, as `?tab=` on one route (Vercel's route limit, next.config.ts):
 * - Sale: the price (a total or per m²), holds, the buyer's reservation and
 *   the sale — the unit's Sales panel, for readers of its sales;
 * - Contract: the buyer's signed contract, uploaded by whoever sells the unit;
 * - Payments: the buyer's payment schedule and payments, for readers of the
 *   unit's collection;
 * - Unit: what the architect made of it;
 * - Plans & photos: its documents and images, to read and download.
 * A section the reader may not open is absent; the first one open is the default.
 */
/** The architect's files, to read and download only: they are changed on the unit's work page in its project. */
function readOnly(files: UnitFilesDTO): UnitFilesDTO {
  return { ...files, capabilities: { canManageDocuments: false, canManageMedia: false, canManageContract: false, canUpload: false, canUploadVersion: false } };
}

export async function SalesUnitPage({ unitId, tab }: { unitId: string; tab: SalesUnitTab | null }) {
  const context = await requireModule("projects");
  const [t, locale] = await Promise.all([getTranslations("projects"), getLocale()]);
  const unit = await getUnitDetail(context, unitId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  });

  const filesOpen = canAccessModule(context, "documents") && can(context, "document.view");
  const sales = salesCapabilities(context).canView;
  const open: Record<SalesUnitTab, boolean> = {
    sale: sales,
    contract: sales && filesOpen,
    payments: financeCapabilities(context).canView,
    unit: true,
    files: filesOpen,
  };
  const visible = TABS.filter((key) => open[key]);
  if (tab !== null && !visible.includes(tab)) notFound();
  const active = tab ?? visible[0]!;
  const base = `${SALES_UNITS}/${unit.id}`;
  const href = (key: SalesUnitTab) => (key === visible[0] ? base : `${base}?tab=${key}`);
  const files = filesOpen && (active === "contract" || active === "unit" || active === "files") ? await listUnitFiles(context, unit.id) : null;

  return (
    <div className="space-y-5" data-testid="sales-unit">
      <RecordHeader
        breadcrumbs={[{ label: t("unitsOverview.title"), href: SALES_UNITS }, { label: unit.label }]}
        title={unit.label}
        subtitle={`${unit.project.name} · ${unit.building.name} · ${floorName(unit.floor.name, locale)}`}
        badges={<CommercialStatusBadge status={saleStatusOf(unit.commercialStatus, unit.askingPrice?.amount ?? null)} />}
      />
      <ContextTabsFrame
        label={t("salesUnit.sectionsLabel", { code: unit.label })}
        sections={visible.map((key) => ({ key, label: t(`salesUnit.tabs.${key}`), href: href(key), active: key === active }))}
      >
        {visible.map((key) => (
          <Link key={key} href={href(key)} aria-current={key === active ? "page" : undefined} className={contextTabClass(key === active)} data-testid={`sales-unit-tab-${key}`}>
            {t(`salesUnit.tabs.${key}`)}
          </Link>
        ))}
      </ContextTabsFrame>

      {active === "sale" ? <UnitSalesPanel sales={await getUnitSales(context, unit.id)} /> : null}
      {active === "contract" && files ? <SaleContract unitId={unit.id} unitCode={unit.label} files={files} /> : null}
      {active === "payments" ? <UnitFinancePanel finance={await getUnitFinance(context, unit.id)} /> : null}
      {active === "unit" ? <UnitFacts unit={unit} files={files} locale={locale} links={{ media: `${base}?tab=files`, documents: `${base}?tab=files` }} /> : null}
      {active === "files" && files ? (
        <div className="space-y-4">
          <UnitDocuments unitId={unit.id} unitCode={unit.label} files={readOnly(files)} />
          <UnitMediaGallery unitId={unit.id} unitCode={unit.label} files={readOnly(files)} />
        </div>
      ) : null}
    </div>
  );
}
