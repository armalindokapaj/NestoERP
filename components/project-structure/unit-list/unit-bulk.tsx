"use client";

import * as React from "react";
import { Archive, ChevronDown, MoveRight, Pencil, Tag, Tags, X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { useValuesEditor } from "@/components/project-planning/use-values-editor";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { PutOnSaleTick } from "@/components/sales/unit-sales/put-on-sale";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { MobileActionBar } from "@/components/ui/mobile-action-bar";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/client/api-request";
import { parseOptionalDecimal } from "@/lib/forms/decimal";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import type { Translate } from "@/lib/i18n/translator";
import type { BulkDetailField } from "@/lib/modules/project-structure/structure.schema";
import { COUNT_CHOICES, UNIT_ORIENTATIONS, type UnitTypeOption } from "@/lib/modules/project-structure/structure.types";
import {
  afterChange,
  goesOnSaleWithPrice,
  saleStatusCount,
  setUnits,
  toggleUnit,
  unitRefs,
  type BulkOutcome,
  type BulkSkip,
  type SaleStatusChange,
  type SelectedUnit,
  type Selection,
  type UnitSelectionDTO,
} from "@/lib/modules/project-structure/unit-bulk.rules";
import { PRICE_ENTRIES, type PriceEntry } from "@/lib/modules/sales/units/unit-pricing.rules";
import { cn } from "@/lib/utils/cn";
import { areaRule, decimalPayload, decimalProblem, Field, failureMessage, FormError, numberText } from "../structure-ui";

/**
 * Ticking units and changing them together (2026-11-09, "Tick and edit").
 *
 * The same on the Units and the Sales tab: a tick per row or card, the page's
 * tick in the header, "Select all N matching" for the whole filtered list,
 * and a bar while anything is ticked — how many, the changes this person may
 * make, and Clear (Escape clears too). On a phone the bar sits above the
 * bottom navigation and its changes are one Actions menu.
 *
 * Each change opens its own form or confirmation and is sent once for all the
 * ticked units; the server changes each unit as its own page would and names
 * any it skipped, with the reason, which this shows. The ticks stay after
 * Edit details, Set price and a sale-status change, carrying each unit's new
 * versions, so the next change can follow on the same units; a move or an
 * archive takes the units out of view, so it clears them.
 */

export type BulkCapabilities = { details: boolean; price: boolean; status: boolean; move: boolean; archive: boolean };

export function canChangeTogether(caps: BulkCapabilities): boolean {
  return caps.details || caps.price || caps.status || caps.move || caps.archive;
}

type Dialog =
  | { kind: "details" | "price" | "move" | "archive"; units: SelectedUnit[]; fromSelection: boolean }
  | { kind: "status"; change: SaleStatusChange; units: SelectedUnit[]; fromSelection: boolean }
  | { kind: "result"; title: string; outcome: BulkOutcome }
  | null;

type Place = { id: string; name: string; floors: Array<{ id: string; name: string }> };

/** Sends one change for many units: up to 500 units, each its own transaction, so it gets longer than a single save. */
function sendBulk(projectId: string, body: Record<string, unknown>): Promise<BulkOutcome> {
  return apiRequest<BulkOutcome>(`/api/projects/${projectId}/units/bulk`, { method: "POST", body, deadlineMs: 130_000, messageFrom: "field" });
}

/**
 * The ticks and the changes of one list. `resetKey` is what the list shows —
 * its tree choice, search and filters, not its page or sort: when it changes,
 * the ticks go, so nothing stays ticked that the person can no longer see.
 */
export function useUnitBulk({
  projectId,
  caps,
  resetKey,
  types = [],
  buildings = [],
  onChanged,
}: {
  projectId: string;
  caps: BulkCapabilities;
  resetKey: string;
  types?: UnitTypeOption[];
  buildings?: Place[];
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("projects");
  const toast = useToast();
  const [selection, setSelection] = React.useState<Selection>(() => new Map());
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [pending, setPending] = React.useState(false);

  const lastKey = React.useRef(resetKey);
  React.useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setSelection(new Map());
  }, [resetKey]);

  // Escape clears the ticks — unless a dialog or a menu is open, or the person is typing in a field.
  React.useEffect(() => {
    if (selection.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']")) return;
      setSelection(new Map());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection.size]);

  const units = React.useMemo(() => [...selection.values()], [selection]);

  /** Opens a change for the ticked units, or for the units given (a row's own menu). */
  const start = React.useCallback(
    (kind: "details" | "price" | "move" | "archive" | SaleStatusChange, given?: SelectedUnit[]) => {
      const chosen = given ?? units;
      if (!chosen.length) return;
      const fromSelection = !given;
      if (kind === "put_on_sale" || kind === "take_off_sale") setDialog({ kind: "status", change: kind, units: chosen, fromSelection });
      else setDialog({ kind, units: chosen, fromSelection });
    },
    [units],
  );

  /** Sends a change, says what it did, and carries on with the ticks or clears them. */
  async function run(body: Record<string, unknown>, title: string, keepTicks: boolean, fromSelection: boolean): Promise<boolean> {
    setPending(true);
    try {
      const outcome = await sendBulk(projectId, body);
      if (fromSelection) setSelection((current) => (keepTicks ? afterChange(current, outcome) : new Map()));
      else setSelection((current) => afterChange(current, outcome));
      const skipped = outcome.skipped.length + (outcome.putOnSale?.skipped.length ?? 0);
      if (skipped) setDialog({ kind: "result", title, outcome });
      else {
        setDialog(null);
        const offered = outcome.putOnSale?.moved.length ?? 0;
        toast({ title: outcome.updated.length ? t("unitList.result.updated", { count: outcome.updated.length }) : t("unitList.result.nothing"), description: offered ? t("unitList.result.onSale", { count: offered }) : undefined, tone: "success" });
      }
      await onChanged();
      return true;
    } catch (error) {
      toast({ title: failureMessage(error, t("unitList.result.failed")), tone: "danger" });
      return false;
    } finally {
      setPending(false);
    }
  }

  const toggle = React.useCallback((unit: SelectedUnit) => setSelection((current) => toggleUnit(current, unit)), []);
  const setMany = React.useCallback((list: readonly SelectedUnit[], on: boolean) => setSelection((current) => setUnits(current, list, on)), []);
  const clear = React.useCallback(() => setSelection(new Map()), []);

  const actions: Array<{ key: string; label: string; icon: React.ReactNode; onSelect: () => void; destructive?: boolean }> = [];
  if (caps.details) actions.push({ key: "details", label: t("unitList.action.details"), icon: <Pencil aria-hidden="true" />, onSelect: () => start("details") });
  if (caps.price) actions.push({ key: "price", label: t("unitList.action.price"), icon: <Tag aria-hidden="true" />, onSelect: () => start("price") });
  if (caps.status && saleStatusCount("put_on_sale", units) > 0) actions.push({ key: "put_on_sale", label: t("unitList.action.putOnSale"), icon: <Tags aria-hidden="true" />, onSelect: () => start("put_on_sale") });
  if (caps.status && saleStatusCount("take_off_sale", units) > 0) actions.push({ key: "take_off_sale", label: t("unitList.action.takeOffSale"), icon: <Tags aria-hidden="true" />, onSelect: () => start("take_off_sale") });
  if (caps.move) actions.push({ key: "move", label: t("unitList.action.move"), icon: <MoveRight aria-hidden="true" />, onSelect: () => start("move") });
  if (caps.archive && units.some((unit) => !unit.archived)) actions.push({ key: "archive", label: t("unitList.action.archive"), icon: <Archive aria-hidden="true" />, onSelect: () => start("archive"), destructive: true });

  const bar = selection.size ? <SelectionBar count={selection.size} actions={actions} onClear={clear} /> : null;

  const open = dialog && dialog.kind !== "result" ? dialog : null;
  const close = (value: boolean) => {
    if (!value && !pending) setDialog(null);
  };
  const dialogs = (
    <>
      {open?.kind === "details" ? (
        <BulkDetailsDialog
          units={open.units}
          types={types}
          pending={pending}
          onOpenChange={close}
          onSubmit={(change) => run({ action: "details", units: unitRefs(open.units, "details"), change }, t("unitList.action.details"), true, open.fromSelection)}
        />
      ) : null}
      {open?.kind === "price" ? (
        <BulkPriceDialog
          units={open.units}
          canPutOnSale={caps.status}
          pending={pending}
          onOpenChange={close}
          onSubmit={(price) => run({ action: "price", units: unitRefs(open.units, "price"), ...price }, t("unitList.action.price"), true, open.fromSelection)}
        />
      ) : null}
      {open?.kind === "move" ? (
        <BulkMoveDialog
          units={open.units}
          buildings={buildings}
          pending={pending}
          onOpenChange={close}
          onSubmit={(floorId) => run({ action: "move", units: unitRefs(open.units, "move"), floorId }, t("unitList.action.move"), false, open.fromSelection)}
        />
      ) : null}
      <ConfirmDialog
        open={open?.kind === "status"}
        onOpenChange={close}
        title={open?.kind === "status" ? t(open.change === "put_on_sale" ? "unitList.status.putTitle" : "unitList.status.takeTitle", { count: open.units.length }) : t("unitList.action.putOnSale")}
        description={open?.kind === "status" ? statusBody(t, open.change, open.units) : ""}
        confirmLabel={open?.kind === "status" && open.change === "take_off_sale" ? t("unitList.action.takeOffSale") : t("unitList.action.putOnSale")}
        destructive={false}
        pending={pending}
        onConfirm={() => {
          if (open?.kind !== "status") return;
          void run({ action: "status", units: unitRefs(open.units, "status"), change: open.change }, open.change === "put_on_sale" ? t("unitList.action.putOnSale") : t("unitList.action.takeOffSale"), true, open.fromSelection);
        }}
      />
      <ConfirmDialog
        open={open?.kind === "archive"}
        onOpenChange={close}
        title={open?.kind === "archive" ? t("unitList.archive.title", { count: open.units.length }) : t("unitList.action.archive")}
        description={t("unitList.archive.body")}
        confirmLabel={t("unitList.action.archive")}
        pending={pending}
        onConfirm={() => {
          if (open?.kind !== "archive") return;
          void run({ action: "archive", units: unitRefs(open.units, "archive") }, t("unitList.action.archive"), false, open.fromSelection);
        }}
      />
      {dialog?.kind === "result" ? <BulkResultDialog title={dialog.title} outcome={dialog.outcome} onClose={() => setDialog(null)} /> : null}
    </>
  );

  return { selection, units, toggle, setMany, clear, start, bar, dialogs, setSelection };
}

function statusBody(t: Translate<"projects">, change: SaleStatusChange, units: SelectedUnit[]): string {
  const moving = saleStatusCount(change, units);
  const left = units.length - moving;
  const body = change === "put_on_sale" ? t("unitList.status.putBody") : t("unitList.status.takeBody");
  return left > 0 ? `${body} ${t("unitList.status.left", { count: left })}` : body;
}

/* The bar --------------------------------------------------------------------- */

function SelectionBar({ count, actions, onClear }: { count: number; actions: Array<{ key: string; label: string; icon: React.ReactNode; onSelect: () => void; destructive?: boolean }>; onClear: () => void }) {
  const t = useTranslations("projects");
  return (
    <MobileActionBar
      role="region"
      aria-label={t("unitList.selectionBar")}
      data-testid="unit-selection-bar"
      // From md: sticky at the foot of the list, a raised strip like the phone's slab.
      className="md:sticky md:bottom-4 md:z-20 md:justify-start md:rounded-lg md:border md:border-line md:bg-surface md:px-3 md:py-2 md:shadow-menu"
    >
      <p className="mr-auto min-w-0 px-1 text-table font-medium text-fg md:mr-0" aria-live="polite" data-testid="unit-selection-count">
        {t("unitList.selected", { count })}
      </p>
      {/* Beside the count from md; last on a phone, after the Actions menu. */}
      <Button type="button" size="sm" variant="ghost" className="max-md:order-last" onClick={onClear} data-testid="unit-selection-clear">
        <X aria-hidden="true" />
        {t("unitList.clear")}
      </Button>
      <div className="hidden flex-wrap items-center justify-end gap-2 md:ml-auto md:flex">
        {actions.map((action) => (
          <Button key={action.key} type="button" size="sm" variant={action.destructive ? "danger" : "secondary"} onClick={action.onSelect} data-testid={`bulk-${action.key}`}>
            {action.label}
          </Button>
        ))}
      </div>
      {actions.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="md:hidden" data-testid="bulk-actions-menu">
              {t("unitList.actions")}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {actions.map((action) => (
              <DropdownMenuItem key={action.key} className={action.destructive ? "text-danger-strong" : undefined} onSelect={action.onSelect}>
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </MobileActionBar>
  );
}

/* Edit details ------------------------------------------------------------------ */

const AREA_CHANGES = ["internalArea", "balconyArea", "terraceArea", "commonAreaAllocation", "saleableArea", "outdoorArea", "gardenArea"] as const;
const COUNT_CHANGES = ["bedrooms", "bathrooms", "storage"] as const;
/** A select's "clear it" choice, apart from "leave as is" (""). */
const CLEAR = "__clear";

type DetailsForm = {
  unitTypeId: string;
  orientation: string;
  areas: Record<(typeof AREA_CHANGES)[number], string>;
  counts: Record<(typeof COUNT_CHANGES)[number], string>;
  description: string;
  clearDescription: boolean;
};

const EMPTY_DETAILS: DetailsForm = {
  unitTypeId: "",
  orientation: "",
  areas: { internalArea: "", balconyArea: "", terraceArea: "", commonAreaAllocation: "", saleableArea: "", outdoorArea: "", gardenArea: "" },
  counts: { bedrooms: "", bathrooms: "", storage: "" },
  description: "",
  clearDescription: false,
};

/** The change a details form sends: only the fields touched. An empty area is left as it is. */
export function detailsChange(form: DetailsForm): Partial<Record<BulkDetailField, unknown>> {
  const change: Partial<Record<BulkDetailField, unknown>> = {};
  if (form.unitTypeId) change.unitTypeId = form.unitTypeId;
  if (form.orientation) change.orientation = form.orientation === CLEAR ? null : form.orientation;
  for (const field of AREA_CHANGES) if (form.areas[field].trim()) change[field] = decimalPayload(form.areas[field], areaRule(field));
  for (const field of COUNT_CHANGES) if (form.counts[field]) change[field] = form.counts[field] === CLEAR ? null : Number(form.counts[field]);
  if (form.clearDescription) change.description = null;
  else if (form.description.trim()) change.description = form.description.trim();
  return change;
}

function BulkDetailsDialog({ units, types, pending, onOpenChange, onSubmit }: { units: SelectedUnit[]; types: UnitTypeOption[]; pending: boolean; onOpenChange: (open: boolean) => void; onSubmit: (change: Partial<Record<BulkDetailField, unknown>>) => Promise<boolean> }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const [form, setForm] = React.useState<DetailsForm>(EMPTY_DETAILS);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [more, setMore] = React.useState(false);
  const title = t("unitList.details.title", { count: units.length });
  const editor = useValuesEditor(form, { module: "units", saveKind: "none", workflow: title, label: title });
  const leave = t("unitList.details.leave");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    for (const field of AREA_CHANGES) {
      const problem = decimalProblem(form.areas[field], areaRule(t(`area.${field}`)));
      if (problem) found[field] = problem;
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    const change = detailsChange(form);
    if (!Object.keys(change).length) return setFormError(t("unitList.details.nothing"));
    setFormError(null);
    await editor.track(async () => {
      if (await onSubmit(change)) editor.rebaseline();
    });
  }

  const areaFields = more ? AREA_CHANGES : AREA_CHANGES.filter((field) => field !== "outdoorArea" && field !== "gardenArea");
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" presentation="fullscreen-phone">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("unitList.details.body")}</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate data-testid="bulk-details-form">
          <FormError message={formError} />
          <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("unitDialog.type")} htmlFor="bulk-type">
                <FormSelect id="bulk-type" className={selectClass} value={form.unitTypeId} onChange={(event) => setForm({ ...form, unitTypeId: event.target.value })}>
                  <option value="">{leave}</option>
                  {types
                    .filter((type) => type.isActive)
                    .map((type) => (
                      <option key={type.id} value={type.id}>
                        {unitTypeName(type.name, locale)}
                      </option>
                    ))}
                </FormSelect>
              </Field>
              <Field label={t("unitDialog.orientation")} htmlFor="bulk-orientation">
                <FormSelect id="bulk-orientation" className={selectClass} value={form.orientation} onChange={(event) => setForm({ ...form, orientation: event.target.value })}>
                  <option value="">{leave}</option>
                  <option value={CLEAR}>{t("unitDialog.notSet")}</option>
                  {UNIT_ORIENTATIONS.map((orientation) => (
                    <option key={orientation} value={orientation}>
                      {t(`orientation.${orientation}`)}
                    </option>
                  ))}
                </FormSelect>
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-meta font-semibold text-fg">{t("unitDialog.areas")}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {areaFields.map((field) => (
                  <Field key={field} label={t(`area.${field}`)} htmlFor={`bulk-${field}`} error={errors[field]}>
                    <Input id={`bulk-${field}`} inputMode="decimal" placeholder={leave} value={form.areas[field]} onChange={(event) => setForm({ ...form, areas: { ...form.areas, [field]: numberText(event.target.value) } })} aria-invalid={Boolean(errors[field])} />
                  </Field>
                ))}
              </div>
              <p className="mt-2 text-meta text-fg-subtle">{t("unitList.details.areasHint")}</p>
            </fieldset>
            <div className="grid grid-cols-3 gap-3">
              {COUNT_CHANGES.map((field) => (
                <Field key={field} label={t(`count.${field}`)} htmlFor={`bulk-${field}`}>
                  <FormSelect id={`bulk-${field}`} className={selectClass} value={form.counts[field]} onChange={(event) => setForm({ ...form, counts: { ...form.counts, [field]: event.target.value } })}>
                    <option value="">{leave}</option>
                    <option value={CLEAR}>{t("unitDialog.notSet")}</option>
                    {COUNT_CHOICES[field].map((choice) => (
                      <option key={choice} value={String(choice)}>
                        {choice}
                      </option>
                    ))}
                  </FormSelect>
                </Field>
              ))}
            </div>
            <button type="button" className="tap-target inline-flex items-center gap-1 text-table font-medium text-accent-strong" onClick={() => setMore((open) => !open)} aria-expanded={more}>
              <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} aria-hidden="true" />
              {more ? t("unitDialog.fewer") : t("unitList.details.moreAreas")}
            </button>
            <Field label={t("unitDialog.description")} htmlFor="bulk-description">
              <Textarea id="bulk-description" value={form.description} placeholder={leave} disabled={form.clearDescription} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={1000} rows={2} />
            </Field>
            <label className="flex items-center gap-2 text-table text-fg">
              <Checkbox checked={form.clearDescription} onCheckedChange={(checked) => setForm({ ...form, clearDescription: checked === true })} />
              {t("unitList.details.clearDescription")}
            </label>
          </fieldset>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                {t("unitDialog.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} data-testid="bulk-details-apply">
              {t("unitList.details.apply", { count: units.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* Set price ------------------------------------------------------------------- */

function BulkPriceDialog({ units, canPutOnSale, pending, onOpenChange, onSubmit }: { units: SelectedUnit[]; canPutOnSale: boolean; pending: boolean; onOpenChange: (open: boolean) => void; onSubmit: (price: { entry: PriceEntry; amount: string; reason: string | null; putOnSale: boolean }) => Promise<boolean> }) {
  const t = useTranslations("projects");
  const ts = useSalesTranslations();
  // Opens on Per m², as the unit form and the Price dialog do (2026-11-09).
  const [entry, setEntry] = React.useState<PriceEntry>("PER_SQM");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const offSale = units.filter(goesOnSaleWithPrice).length;
  const sold = units.filter((unit) => unit.status === "SOLD").length;
  const [putOnSale, setPutOnSale] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const title = t("unitList.price.title", { count: units.length });
  const editor = useValuesEditor({ entry, amount, reason, putOnSale }, { module: "units", saveKind: "none", workflow: title, label: title });
  const rule = { label: entry === "TOTAL" ? ts("unitDialogs.entryTotal") : ts("unitDialogs.entryPerSqm"), scale: 2, maxIntegerDigits: 15, min: "0.01" };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseOptionalDecimal(amount, rule);
    if (!parsed.ok) return setError(parsed.message);
    if (parsed.value === null) return setError(t("unitList.price.amountRequired"));
    setError(null);
    await editor.track(async () => {
      if (await onSubmit({ entry, amount: parsed.value!, reason: reason.trim() || null, putOnSale: canPutOnSale && offSale > 0 && putOnSale })) editor.rebaseline();
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" presentation="fullscreen-phone">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{entry === "TOTAL" ? t("unitList.price.bodyTotal") : t("unitList.price.bodyPerSqm")}</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate data-testid="bulk-price-form">
          <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <div className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5" role="radiogroup" aria-label={ts("unitDialogs.priceEntry")}>
              {PRICE_ENTRIES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    "relative inline-flex cursor-pointer items-center rounded-md px-3 py-1.5 text-table font-medium text-fg-muted transition-colors hover:text-fg touch:min-h-11",
                    "has-[:checked]:bg-accent-soft has-[:checked]:text-accent-strong has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  )}
                >
                  <input type="radio" name="bulk-price-entry" value={value} className="sr-only" checked={entry === value} onChange={() => setEntry(value)} data-testid={`bulk-price-entry-${value === "TOTAL" ? "total" : "per-sqm"}`} />
                  {value === "TOTAL" ? ts("unitDialogs.entryTotal") : ts("unitDialogs.entryPerSqm")}
                </label>
              ))}
            </div>
            <Field label={entry === "TOTAL" ? ts("unitDialogs.entryTotal") : t("unitList.price.rateLabel")} htmlFor="bulk-price-amount" error={error ?? undefined}>
              <Input id="bulk-price-amount" inputMode="decimal" autoFocus value={amount} onChange={(event) => setAmount(numberText(event.target.value))} aria-invalid={Boolean(error)} data-testid="bulk-price-amount" />
            </Field>
            <Field label={t("unitList.price.reason")} htmlFor="bulk-price-reason">
              <Input id="bulk-price-reason" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
            </Field>
            {canPutOnSale && offSale > 0 ? <PutOnSaleTick checked={putOnSale} onChange={setPutOnSale} label={t("unitList.price.putOnSale", { count: offSale })} hint={t("unitList.price.putOnSaleHint", { count: offSale })} testId="bulk-price-put-on-sale" /> : null}
            {sold ? <p className="text-meta text-fg-muted">{t("unitList.price.soldSkipped", { count: sold })}</p> : null}
          </fieldset>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                {t("unitDialog.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} data-testid="bulk-price-apply">
              {t("unitList.price.apply", { count: units.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* Move to floor ------------------------------------------------------------------ */

function BulkMoveDialog({ units, buildings, pending, onOpenChange, onSubmit }: { units: SelectedUnit[]; buildings: Place[]; pending: boolean; onOpenChange: (open: boolean) => void; onSubmit: (floorId: string) => Promise<boolean> }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const [buildingId, setBuildingId] = React.useState(buildings[0]?.id ?? "");
  const [floorId, setFloorId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const floors = buildings.find((building) => building.id === buildingId)?.floors ?? [];
  const title = t("unitList.move.title", { count: units.length });
  const editor = useValuesEditor({ buildingId, floorId }, { module: "units", saveKind: "none", workflow: title, label: title });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!floorId) return setError(t("structureDialogs.chooseFloor"));
    setError(null);
    await editor.track(async () => {
      if (await onSubmit(floorId)) editor.rebaseline();
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent presentation="sheet-phone">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("unitList.move.body")}</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4" data-testid="bulk-move-form">
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("structureDialogs.building")} htmlFor="bulk-move-building" required>
              <FormSelect
                id="bulk-move-building"
                className={selectClass}
                value={buildingId}
                onChange={(event) => {
                  setBuildingId(event.target.value);
                  setFloorId("");
                }}
              >
                {buildings.map((building) => (
                  <option key={building.id} value={building.id}>
                    {building.name}
                  </option>
                ))}
              </FormSelect>
            </Field>
            <Field label={t("structureDialogs.floor")} htmlFor="bulk-move-floor" required>
              <FormSelect id="bulk-move-floor" className={selectClass} value={floorId} onChange={(event) => setFloorId(event.target.value)}>
                <option value="">{t("structureDialogs.chooseFloor")}</option>
                {floors.map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floorName(floor.name, locale)}
                  </option>
                ))}
              </FormSelect>
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                {t("unitDialog.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} data-testid="bulk-move-apply">
              {t("unitList.move.apply", { count: units.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* What a change did ------------------------------------------------------------- */

/** Units a change left as they were, each with the reason; also the Prices page's units that stayed off sale. */
export function SkipList({ items }: { items: BulkSkip[] }) {
  const t = useTranslations("projects");
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-line bg-surface-muted px-3 py-2 text-table" data-testid="bulk-skipped">
      {items.map((item) => (
        <li key={item.id} data-reason={item.reason}>
          <span className="font-medium text-fg">{item.label ?? t("unitList.result.unknownUnit")}</span>
          <span className="text-fg-muted"> — {t(`unitList.skip.${item.reason}`)}</span>
        </li>
      ))}
    </ul>
  );
}

function BulkResultDialog({ title, outcome, onClose }: { title: string; outcome: BulkOutcome; onClose: () => void }) {
  const t = useTranslations("projects");
  const onSale = outcome.putOnSale;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" presentation="sheet-phone">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {outcome.updated.length ? t("unitList.result.updated", { count: outcome.updated.length }) : t("unitList.result.nothing")}
          {onSale && onSale.moved.length ? ` ${t("unitList.result.onSale", { count: onSale.moved.length })}` : ""}
        </DialogDescription>
        <div className="mt-4 space-y-4" data-testid="bulk-result">
          {outcome.skipped.length ? (
            <section className="space-y-2">
              <h3 className="text-table font-semibold text-fg">{t("unitList.result.skippedTitle", { count: outcome.skipped.length })}</h3>
              <SkipList items={outcome.skipped} />
            </section>
          ) : null}
          {onSale?.skipped.length ? (
            <section className="space-y-2">
              <h3 className="text-table font-semibold text-fg">{t("unitList.result.notOnSaleTitle", { count: onSale.skipped.length })}</h3>
              <SkipList items={onSale.skipped} />
            </section>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t("unitList.result.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Ticking more than a page -------------------------------------------------------- */

/** Every unit a list's filters match (its `select=all` read): their ids, versions and what the bar needs. */
export function fetchSelection(url: string): Promise<UnitSelectionDTO> {
  return apiRequest<UnitSelectionDTO>(url);
}

/**
 * The line above a list that ticks more than its page: "Select all N
 * matching" once the page is ticked, "Select this floor" when a floor is
 * chosen, and how many units still miss something, with Fill in.
 */
export function SelectionHelp({
  ticked,
  page,
  total,
  limit,
  onSelectAll,
  floor,
  missing,
}: {
  ticked: number;
  page: "all" | "some" | "none";
  total: number;
  limit: number;
  onSelectAll: () => Promise<void>;
  floor?: { count: number; onSelect: () => Promise<void> } | null;
  missing?: { text: string; onFill: () => Promise<void> } | null;
}) {
  const t = useTranslations("projects");
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const act = (work: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast({ title: failureMessage(error, t("unitList.selectFailed")), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const allPageTicked = page === "all" && ticked < total;
  const items: React.ReactNode[] = [];
  if (missing) {
    items.push(
      <span key="missing" className="inline-flex flex-wrap items-center gap-x-1.5" data-testid="units-missing">
        <span>{missing.text}</span>
        <span aria-hidden="true">·</span>
        <button type="button" className="tap-target font-medium text-accent-strong hover:underline disabled:opacity-60" disabled={busy} onClick={act(missing.onFill)} data-testid="units-fill-in">
          {t("unitList.fillIn")}
        </button>
      </span>,
    );
  }
  if (allPageTicked) {
    items.push(
      <span key="all" className="inline-flex flex-wrap items-center gap-x-1.5" data-testid="unit-select-all">
        <span>{t("unitList.pageTicked", { count: ticked })}</span>
        {total <= limit ? (
          <button type="button" className="tap-target font-medium text-accent-strong hover:underline disabled:opacity-60" disabled={busy} onClick={act(onSelectAll)}>
            {busy ? t("unitList.selecting") : t("unitList.selectAll", { count: total })}
          </button>
        ) : (
          <span>{t("unitList.selectAllCapped", { limit })}</span>
        )}
      </span>,
    );
  } else if (ticked > 0 && ticked >= total && total > 0 && page === "all") {
    items.push(
      <span key="every" data-testid="unit-all-ticked">
        {t("unitList.allTicked", { count: total })}
      </span>,
    );
  }
  if (floor && floor.count > 0 && !allPageTicked) {
    items.push(
      <button key="floor" type="button" className="tap-target font-medium text-accent-strong hover:underline disabled:opacity-60" disabled={busy} onClick={act(floor.onSelect)} data-testid="unit-select-floor">
        {t("unitList.selectFloor", { count: floor.count })}
      </button>,
    );
  }
  if (!items.length) return null;
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-fg-muted">{items}</div>;
}
