"use client";

import * as React from "react";
import { BadgeCheck, ChevronDown, ChevronUp, ExternalLink, PauseCircle, PlayCircle, Unlock, X } from "@/components/icons";

import { reveal } from "@/components/forms/form-contract";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { COMMITTED, failureOutcome, INVALID, useValuesEditor } from "@/components/project-planning/use-values-editor";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { CommercialStatusBadge, moneyLabel, perSqmLabel } from "@/components/sales/unit-sales/commercial-status";
import { SaleStatusDialogs, type SaleStatusDialog } from "@/components/sales/unit-sales/sale-status-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { parseOptionalDecimal } from "@/lib/forms/decimal";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { AREA_LABELS, COUNT_FIELDS, type AreaField, type UnitDetailDTO, type UnitTypeOption } from "@/lib/modules/project-structure/structure.types";
import { focusTarget, neighbours, stepFromKey, type PanelField } from "@/lib/modules/project-structure/unit-panel.rules";
import { saleStatusOf, saleStatusOffers } from "@/lib/modules/sales/units/unit-sales.rules";
import type { UnitSalesDTO } from "@/lib/modules/sales/units/unit-sales.types";
import { cn } from "@/lib/utils/cn";
import { areaRule, areaText, countText, fieldErrors, failureMessage, FormError, structureApi, Warnings } from "../structure-ui";
import { shownAreas, TechnicalFields, technicalBody, technicalFromUnit, technicalProblems, warningsFor, type TechnicalValues } from "../unit-dialog";
import { UnitPriceFields, useUnitPrice, type PriceSaveResult } from "../unit-price-fields";
import type { UnitPanelNav } from "./use-unit-panel";

/**
 * The unit side panel (2026-11-09): a row of the Units or the Sales list — a
 * click, or Enter on its code — opens the unit over the right of the list, a
 * full-height sheet on a phone. The list stays where it was; the open unit is
 * in the address, so the panel can be linked and Back closes it. The code
 * stays a real link: a modified or middle click opens the full page.
 *
 * It holds what is set up and sold most: the details (type, orientation,
 * counts, the typed areas with net and gross worked out as they are typed —
 * the Edit unit dialog's own fields and rules), the price (per m² of the sale
 * area or a total, with "Also put it on sale"), and the sale-status changes the
 * person may make, through the Sales section's own dialogs. One Save sends the
 * unit and then its price, as the unit dialog does, each checked against the
 * version the panel read; a price refused leaves the unit saved and says why.
 * Previous and next step through the list as it is shown (Alt+↑ / Alt+↓);
 * "Open full page" goes to the unit's page.
 *
 * Somebody who may not change the unit reads it; the price is shown only to
 * somebody who may see the unit's sales.
 */

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "gone" } | { state: "ready"; unit: UnitDetailDTO; sales: UnitSalesDTO | null };

/** The status changes the panel offers, in the order they are drawn. */
const STATUS_ACTIONS: Array<{ key: Extract<SaleStatusDialog, "putOnSale" | "takeOff" | "hold" | "releaseHold" | "reserve" | "release">; label: "putOnSale" | "takeOffSale" | "hold" | "releaseHold" | "reserve" | "release"; icon: React.ReactNode; primary?: boolean }> = [
  { key: "putOnSale", label: "putOnSale", icon: <PlayCircle aria-hidden="true" />, primary: true },
  { key: "reserve", label: "reserve", icon: <BadgeCheck aria-hidden="true" />, primary: true },
  { key: "release", label: "release", icon: <Unlock aria-hidden="true" /> },
  { key: "hold", label: "hold", icon: <PauseCircle aria-hidden="true" /> },
  { key: "releaseHold", label: "releaseHold", icon: <PlayCircle aria-hidden="true" /> },
  { key: "takeOff", label: "takeOffSale", icon: <PauseCircle aria-hidden="true" /> },
];

export function UnitPanel({
  projectId,
  nav,
  ids,
  types,
  canViewSales,
  fullHref,
  onChanged,
}: {
  projectId: string;
  nav: UnitPanelNav;
  /** The units of the list as it is shown, in its order: what Previous and Next step through. */
  ids: readonly string[];
  types: UnitTypeOption[];
  /** Whether the person may see the units' sales (`project.unit.sales.view`): the price and the status buttons. */
  canViewSales: boolean;
  /** The unit's full page: its Overview from Units, its Sales section from Sales. */
  fullHref: (unitId: string) => string;
  /** The list reads itself again after a change made in the panel. */
  onChanged: () => void;
}) {
  const [last, setLast] = React.useState<string | null>(nav.openId);
  // Each opening reads the unit afresh, even the unit shown last: the list may have changed it meanwhile.
  const [opening, setOpening] = React.useState({ id: nav.openId, count: 0 });
  if (opening.id !== nav.openId) setOpening({ id: nav.openId, count: nav.openId && !opening.id ? opening.count + 1 : opening.count });
  React.useEffect(() => {
    if (nav.openId) setLast(nav.openId);
  }, [nav.openId]);
  // Keeps showing the last unit while the panel slides shut.
  const shown = nav.openId ?? last;
  return (
    <Drawer open={Boolean(nav.openId)} onOpenChange={(next) => (next ? null : nav.close())}>
      {shown ? <PanelBody key={`${shown}:${opening.count}`} unitId={shown} projectId={projectId} nav={nav} ids={ids} types={types} canViewSales={canViewSales} fullHref={fullHref} onChanged={onChanged} /> : null}
    </Drawer>
  );
}

function PanelBody({
  unitId,
  projectId,
  nav,
  ids,
  types,
  canViewSales,
  fullHref,
  onChanged,
}: {
  unitId: string;
  projectId: string;
  nav: UnitPanelNav;
  ids: readonly string[];
  types: UnitTypeOption[];
  canViewSales: boolean;
  fullHref: (unitId: string) => string;
  onChanged: () => void;
}) {
  const t = useTranslations("projects");
  const ts = useSalesTranslations();
  const locale = useLocale();
  const toast = useToast();
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [notice, setNotice] = React.useState<{ tone: "danger" | "warning"; text: string } | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  /** The editor's own guard, for stepping to another unit with unsaved input. */
  const guard = React.useRef<{ requestDismiss: (discard: () => void) => Promise<boolean>; settle: () => void } | null>(null);
  /** The field an "Add" asked for: focused once, when the form first shows, not again after a save reads the unit anew. */
  const pendingFocus = React.useRef<PanelField | null>(nav.focus);
  const takeFocus = React.useCallback(() => {
    const field = pendingFocus.current;
    pendingFocus.current = null;
    return field;
  }, []);

  const refetch = React.useCallback(() => setAttempt((value) => value + 1), []);

  React.useEffect(() => {
    let live = true;
    Promise.all([structureApi<UnitDetailDTO>(`/api/project-units/${unitId}`), canViewSales ? structureApi<UnitSalesDTO>(`/api/project-units/${unitId}/sales`).catch(() => null) : Promise.resolve(null)])
      .then(([unit, sales]) => {
        if (!live) return;
        // A unit of another project is not this list's to show.
        setLoad(unit.projectId === projectId ? { state: "ready", unit, sales } : { state: "gone" });
      })
      .catch((failure: unknown) => {
        if (!live) return;
        const code = (failure as { status?: number } | null)?.status;
        setLoad(code === 404 || code === 403 ? { state: "gone" } : { state: "error", message: failureMessage(failure, t("unitPanel.loadFailed")) });
      });
    return () => {
      live = false;
    };
  }, [unitId, projectId, canViewSales, attempt, t]);

  // The panel's editor lets go before a close steps back through history, so Back is not asked about twice.
  React.useEffect(() => {
    nav.beforeClose.current = () => guard.current?.settle();
    return () => {
      nav.beforeClose.current = null;
    };
  }, [nav.beforeClose]);

  const place = neighbours(ids, unitId);
  const go = (target: string | null) => {
    if (!target) return;
    const step = () => {
      setNotice(null);
      nav.open(target);
    };
    if (guard.current) void guard.current.requestDismiss(step);
    else step();
  };

  const ready = load.state === "ready" ? load : null;
  const unit = ready?.unit ?? null;
  const sales = ready?.sales ?? null;
  const typeName = unit ? unitTypeName(unit.unitType.name, locale) : "";
  const title = unit ? [unit.label, typeName, floorName(unit.floor.name, locale)].join(" · ") : load.state === "loading" ? t("unitPanel.loading") : t("unitPanel.title");
  const saleStatus = sales ? sales.saleStatus : unit ? saleStatusOf(unit.commercialStatus, unit.askingPrice?.amount ?? null) : null;
  const archived = unit?.publication.status === "ARCHIVED";
  const canEditDetails = Boolean(unit?.capabilities.canUpdateUnit) && !archived;
  const canEditPrice = Boolean(sales?.capabilities.canManagePrice) && !archived;
  const offers = sales ? saleStatusOffers({ status: sales.status, sellable: sales.sellable, hasReservation: Boolean(sales.activeReservation), capabilities: sales.capabilities }) : null;
  const statusActions = offers ? STATUS_ACTIONS.filter((action) => offers[action.key]) : [];

  /** A status change made through the Sales section's dialogs: said, and the panel and the list read again. */
  const submit = React.useCallback(
    async (url: string, body: Record<string, unknown>, success: string): Promise<unknown> => {
      const answer = await structureApi(url, { method: url.endsWith("/sales") ? "PATCH" : "POST", body });
      toast({ title: success });
      refetch();
      onChanged();
      return answer;
    },
    [toast, refetch, onChanged],
  );

  function saved(result: { details: boolean; priced: PriceSaveResult }, label: string) {
    const { priced } = result;
    if (priced.price === "refused") setNotice({ tone: "danger", text: t("unitPanel.priceRefused", { code: label, reason: priced.message ?? "" }) });
    else if (priced.onSale === "stayed") setNotice({ tone: "warning", text: ts("putOnSale.stayedReason", { unit: label, reason: priced.onSaleMessage ?? "" }) });
    else setNotice(null);
    if (result.details || priced.price === "saved") toast({ title: t("unitPanel.saved", { code: label }), description: priced.onSale === "moved" ? ts("putOnSale.moved", { unit: label }) : undefined, tone: "success" });
    refetch();
    onChanged();
  }

  return (
    <DrawerContent
      side="right"
      className="max-sm:w-full max-sm:max-w-none sm:max-w-[520px]"
      data-testid="unit-panel"
      data-unit-id={unitId}
      aria-describedby="unit-panel-desc"
      onKeyDown={(event) => {
        const step = stepFromKey(event, event.target as HTMLElement | null);
        if (step === null) return;
        event.preventDefault();
        go(step < 0 ? place.previous : place.next);
      }}
    >
      <header className="sticky top-0 z-10 space-y-1.5 border-b border-line bg-sidebar px-5 py-3">
        <div className="flex items-start gap-2">
          <DrawerTitle className="min-w-0 flex-1 text-card font-semibold text-fg [overflow-wrap:anywhere]" data-testid="unit-panel-title">
            {title}
          </DrawerTitle>
          {place.index >= 0 && place.total > 1 ? (
            <div className="flex shrink-0 items-center">
              <Button variant="ghost" size="icon-sm" aria-label={t("unitPanel.previous")} title={t("unitPanel.previousKeys")} aria-keyshortcuts="Alt+ArrowUp" disabled={!place.previous} onClick={() => go(place.previous)} data-testid="unit-panel-previous">
                <ChevronUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={t("unitPanel.next")} title={t("unitPanel.nextKeys")} aria-keyshortcuts="Alt+ArrowDown" disabled={!place.next} onClick={() => go(place.next)} data-testid="unit-panel-next">
                <ChevronDown />
              </Button>
            </div>
          ) : null}
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("unitPanel.close")} data-testid="unit-panel-close">
              <X />
            </Button>
          </DrawerClose>
        </div>
        <DrawerDescription id="unit-panel-desc" className="flex flex-wrap items-center gap-2 text-table text-fg-muted">
          {saleStatus ? <CommercialStatusBadge status={saleStatus} /> : null}
          {archived ? <Badge>{t("publication.ARCHIVED")}</Badge> : null}
          {place.index >= 0 && place.total > 1 ? <span className="tabular-nums" data-testid="unit-panel-position">{t("unitPanel.position", { index: place.index + 1, total: place.total })}</span> : null}
        </DrawerDescription>
      </header>

      <div className="flex-1 space-y-5 px-5 py-4" aria-busy={load.state === "loading"}>
        {load.state === "loading" ? (
          <div className="space-y-3" role="status" aria-label={t("unitPanel.loading")}>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : load.state === "gone" ? (
          <p className="text-table text-fg" role="alert">
            {t("unitPanel.gone")}
          </p>
        ) : load.state === "error" ? (
          <div className="space-y-3">
            <p className="text-table text-danger-strong" role="alert">
              {load.message}
            </p>
            <Button variant="secondary" onClick={() => { setLoad({ state: "loading" }); refetch(); }}>
              {t("unitPanel.tryAgain")}
            </Button>
          </div>
        ) : unit ? (
          <>
            {notice ? (
              <p role="alert" className={cn("rounded-md border px-3 py-2 text-table", notice.tone === "danger" ? "border-danger/30 bg-danger-soft text-danger-strong" : "border-warning/30 bg-warning-soft text-warning-strong")} data-testid="unit-panel-notice">
                {notice.text}
              </p>
            ) : null}
            {canEditDetails || canEditPrice ? (
              // Mounted per version read: a save or a status change reads the unit again and starts from what is saved.
              <PanelEditor
                key={`${unit.id}:${unit.version}:${sales?.version ?? 0}`}
                unit={unit}
                sales={sales}
                types={types}
                takeFocus={takeFocus}
                canEditDetails={canEditDetails}
                canEditPrice={canEditPrice}
                guard={guard}
                onDirty={setDirty}
                onSaved={(result) => saved(result, unit.label)}
              />
            ) : (
              <>
                <p className="text-meta text-fg-subtle">{t("unitPanel.readOnly")}</p>
                <ReadOnlyDetails unit={unit} />
              </>
            )}
            {sales && !canEditPrice ? <ReadOnlyPrice sales={sales} /> : null}

            {sales && statusActions.length ? (
              <section aria-labelledby="unit-panel-status" className="space-y-2 border-t border-line pt-4" data-testid="unit-panel-status">
                <h3 id="unit-panel-status" className="text-meta font-semibold text-fg">
                  {t("unitPanel.status")}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {statusActions.map((action) => (
                    <Button key={action.key} variant={action.primary ? "primary" : "secondary"} size="sm" disabled={dirty} onClick={() => setStatus(action.key)} data-testid={`unit-panel-${action.key}`}>
                      {action.icon}
                      {ts(`unitSales.${action.label}`)}
                    </Button>
                  ))}
                </div>
                {dirty ? <p className="text-meta text-fg-subtle">{t("unitPanel.saveFirst")}</p> : null}
                <SaleStatusDialogs open={status} onClose={() => setStatus(null)} sales={sales} submit={submit} />
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-sidebar px-5 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={fullHref(unitId)} data-testid="unit-panel-open-page">
            <ExternalLink aria-hidden="true" />
            {t("unitPanel.openFullPage")}
          </Link>
        </Button>
        {unit && (canEditDetails || canEditPrice) ? (
          <Button type="submit" form="unit-panel-form" disabled={!dirty} data-testid="unit-panel-save">
            {t("unitPanel.save")}
          </Button>
        ) : null}
      </footer>
    </DrawerContent>
  );
}

/* The form ------------------------------------------------------------------------------- */

const FOCUS_IDS: Record<ReturnType<typeof focusTarget>, string> = {
  bedrooms: "panel-bedrooms",
  internalArea: "panel-internalArea",
  saleableArea: "panel-saleableArea",
  price: "panel-asking-price",
};

function PanelEditor({
  unit,
  sales,
  types,
  takeFocus,
  canEditDetails,
  canEditPrice,
  guard,
  onDirty,
  onSaved,
}: {
  unit: UnitDetailDTO;
  sales: UnitSalesDTO | null;
  types: UnitTypeOption[];
  /** The field to put the cursor in, once: an empty cell's "Add". */
  takeFocus: () => PanelField | null;
  canEditDetails: boolean;
  canEditPrice: boolean;
  guard: React.MutableRefObject<{ requestDismiss: (discard: () => void) => Promise<boolean>; settle: () => void } | null>;
  onDirty: (dirty: boolean) => void;
  onSaved: (result: { details: boolean; priced: PriceSaveResult }) => void;
}) {
  const t = useTranslations("projects");
  const [technical, setTechnical] = React.useState<TechnicalValues>(() => technicalFromUnit(unit));
  const baseline = React.useRef(JSON.stringify(technicalFromUnit(unit)));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const category = types.find((type) => type.id === technical.unitTypeId)?.category ?? unit.unitType.category;
  // The price per m² of the areas as typed here: the saleable area, else the gross they work out (2026-11-09).
  const grossArea = shownAreas(technical, category).grossArea;
  const saleable = parseOptionalDecimal(technical.areas.saleableArea, areaRule(AREA_LABELS.saleableArea));
  const price = useUnitPrice({ unitId: unit.id, enabled: canEditPrice, areas: { saleableArea: saleable.ok ? saleable.value : null, grossArea }, sales });

  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const editor = useValuesEditor(
    { technical, price: price.touched ? [price.view.entry, price.view.text, price.view.putOnSale] : null },
    { module: "units", saveKind: "save", label: t("unitDialog.editorLabel", { code: unit.label }), save: () => persist.current() },
  );
  const { dirty, requestDismiss, rebaseline } = editor;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);
  React.useEffect(() => {
    guard.current = { requestDismiss, settle: rebaseline };
    return () => {
      guard.current = null;
      onDirty(false);
    };
  }, [guard, requestDismiss, rebaseline, onDirty]);

  // An empty cell's "Add" opens the panel on its field.
  React.useEffect(() => {
    // Taken in the frame, not the effect: an effect run twice in development cancels the first frame.
    const frame = window.requestAnimationFrame(() => {
      const focus = takeFocus();
      if (!focus) return;
      const field = focusTarget(focus);
      if (field === "price" ? !canEditPrice : !canEditDetails) return;
      const target = document.getElementById(FOCUS_IDS[field]);
      if (!target) return;
      reveal(target);
      target.focus();
    });
    return () => window.cancelAnimationFrame(frame);
    // Only as the panel opens on this unit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  persist.current = async () => {
    const local: Record<string, string> = canEditDetails ? technicalProblems(technical, (field) => t(`area.${field}`)) : {};
    // The price is checked first too, so a price that cannot be saved saves nothing.
    const priceOk = price.check();
    if (Object.keys(local).length || !priceOk) {
      setErrors(local);
      return INVALID;
    }
    const detailsChanged = canEditDetails && JSON.stringify(technical) !== baseline.current;
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await editor.track(async () => {
        // The unit first, with the version the panel read; its code stays as it is.
        if (detailsChanged) await structureApi(`/api/project-units/${unit.id}`, { method: "PATCH", body: { unitCode: unit.unitCode, ...technicalBody(technical), expectedVersion: unit.version } });
        // Then the price, through Sales' door; a refusal leaves the unit saved and comes back with the reason.
        const priced = await price.save(unit.id, unit.label, { quiet: true });
        return { details: detailsChanged, priced };
      });
      onSaved(result);
      return COMMITTED;
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(failureMessage(error, t("unitDialog.saveFailed")));
      return failureOutcome(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      id="unit-panel-form"
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) void persist.current();
      }}
    >
      <FormError message={formError} />
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-5 border-0 p-0">
        <section aria-labelledby="unit-panel-details" className="space-y-3" data-testid="unit-panel-details">
          <h3 id="unit-panel-details" className="text-meta font-semibold text-fg">
            {t("unitPanel.details")}
          </h3>
          {canEditDetails ? <TechnicalFields idPrefix="panel" values={technical} onChange={setTechnical} types={types} errors={errors} currentTypeId={unit.unitType.id} dense /> : <ReadOnlyDetails unit={unit} />}
        </section>
        {canEditPrice ? (
          <section className="border-t border-line pt-4" data-testid="unit-panel-price">
            <UnitPriceFields price={price} idPrefix="panel" unitLabel={unit.label} />
          </section>
        ) : null}
      </fieldset>
      {canEditDetails ? <Warnings items={warningsFor(technical, types, t)} /> : null}
      {pending ? (
        <p className="text-meta text-fg-muted" role="status">
          {t("unitPanel.saving")}
        </p>
      ) : null}
    </form>
  );
}

/* Reading only ------------------------------------------------------------------------------ */

const READ_AREAS: AreaField[] = ["internalArea", "balconyArea", "terraceArea", "netArea", "commonAreaAllocation", "grossArea", "saleableArea", "outdoorArea", "gardenArea"];

function ReadOnlyDetails({ unit }: { unit: UnitDetailDTO }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const items: Array<{ label: string; value: string }> = [
    { label: t("unitDialog.type"), value: unitTypeName(unit.unitType.name, locale) },
    { label: t("unitDialog.orientation"), value: unit.orientation ? t(`orientation.${unit.orientation}`) : "—" },
    ...COUNT_FIELDS.map((field) => ({ label: t(`count.${field}`), value: countText(unit[field]) })),
    // Every area typed, and the net and gross they make; the empty ones are left out.
    ...READ_AREAS.filter((field) => unit.areas[field] !== null).map((field) => ({ label: t(`area.${field}`), value: areaText(unit.areas[field], locale) })),
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3" data-testid="unit-panel-read">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="nesto-eyebrow text-fg-subtle">{item.label}</dt>
          <dd className="mt-0.5 text-table tabular-nums text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReadOnlyPrice({ sales }: { sales: UnitSalesDTO }) {
  const t = useTranslations("projects");
  const ts = useSalesTranslations();
  const locale = useLocale();
  return (
    <section aria-labelledby="unit-panel-price-read" className="space-y-2 border-t border-line pt-4" data-testid="unit-panel-price-read">
      <h3 id="unit-panel-price-read" className="text-meta font-semibold text-fg">
        {t("unitPanel.price")}
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <dt className="nesto-eyebrow text-fg-subtle">{t("unitTable.totalPrice")}</dt>
          <dd className="mt-0.5 text-table tabular-nums text-fg">{moneyLabel(sales.askingPrice, sales.currency, locale)}</dd>
        </div>
        <div>
          <dt className="nesto-eyebrow text-fg-subtle">{t("unitTable.pricePerSqm")}</dt>
          <dd className="mt-0.5 text-table tabular-nums text-fg">
            {perSqmLabel(sales.pricePerSqm, sales.currency, locale)}
            {sales.saleArea !== null ? <span className="block text-meta text-fg-subtle">{sales.saleAreaBasis === "SALEABLE_AREA" ? ts("unitSales.saleAreaSaleable") : ts("unitSales.saleAreaGross")}</span> : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}
