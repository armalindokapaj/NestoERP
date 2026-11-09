"use client";

import * as React from "react";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import { ChevronDown } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";
import { COMMITTED, failureOutcome, INVALID, useValuesEditor } from "@/components/project-planning/use-values-editor";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { attributesFor, expectsCount, grossAreaIsTyped, unitWarningFindings, workedOutAreas } from "@/lib/modules/project-structure/structure.rules";
import type { Translate } from "@/lib/i18n/translator";
import { parseOptionalDecimal } from "@/lib/forms/decimal";
import { numberText as localisedNumber } from "@/lib/i18n/format";
import {
  AREA_LABELS,
  COUNT_CHOICES,
  COUNT_FIELDS,
  ENTERED_AREA_FIELDS,
  UNIT_ATTRIBUTES,
  UNIT_ORIENTATIONS,
  type AreaField,
  type CountField,
  type EnteredAreaField,
  type UnitAttributes,
  type UnitDTO,
  type UnitOrientation,
  type UnitTypeOption,
} from "@/lib/modules/project-structure/structure.types";
import { cn } from "@/lib/utils/cn";
import { areaRule, decimalPayload, decimalProblem, Field, fieldErrors, FormError, failureMessage, metresRule, numberText, structureApi, Warnings } from "./structure-ui";
import { FormSelect } from "@/components/ui/form-select";
import { UnitPriceFields, useUnitPrice } from "./unit-price-fields";

/**
 * Adding and editing a unit (E-05B §17-§26, §40, §55, §74, §95).
 *
 * The floor is the context and is not asked for again (§40). The type decides
 * which counts and details are offered — bedrooms for an apartment, EV-ready
 * for a parking space — and anything unusual is a warning beside the save
 * button, never a refusal (§74). Saving sends the version the form loaded, so
 * a unit somebody else changed in the meantime is not silently overwritten.
 *
 * A unit is its code, not a name (2026-11). The counts are picked from short
 * lists, and the net and gross areas are sums shown as they will be saved:
 * the server works them out again on every save.
 */

export type TechnicalValues = {
  unitTypeId: string;
  orientation: UnitOrientation | "";
  areas: Record<EnteredAreaField, string>;
  counts: Record<CountField, string>;
  attributes: UnitAttributes;
  description: string;
};

/** The areas in the order the sums read: internal + balcony + terrace = net; net + common = gross. */
const MAIN_AREAS: AreaField[] = ["internalArea", "balconyArea", "terraceArea", "netArea", "commonAreaAllocation", "grossArea", "saleableArea", "outdoorArea"];
const MORE_AREAS: EnteredAreaField[] = ["gardenArea"];

export function emptyTechnical(unitTypeId = ""): TechnicalValues {
  return {
    unitTypeId,
    orientation: "",
    areas: Object.fromEntries(ENTERED_AREA_FIELDS.map((field) => [field, ""])) as Record<EnteredAreaField, string>,
    counts: { bedrooms: "", bathrooms: "", storage: "" },
    attributes: {},
    description: "",
  };
}

/**
 * The net and gross areas the typed areas make, for the form to show. `null`
 * while a part cannot be read — the field's own error says why.
 */
function shownAreas(values: TechnicalValues, category: UnitTypeOption["category"]): { netArea: string | null; grossArea: string | null } {
  const read = {} as Record<EnteredAreaField, string | null>;
  for (const field of ENTERED_AREA_FIELDS) {
    const parsed = parseOptionalDecimal(values.areas[field], areaRule(AREA_LABELS[field]));
    if (!parsed.ok) return { netArea: null, grossArea: null };
    read[field] = parsed.value;
  }
  return workedOutAreas(category, read);
}

/** A count's choices, plus a saved value outside them so the select still shows what the unit has. */
function choicesFor(field: CountField, current: string): number[] {
  const choices = [...COUNT_CHOICES[field]];
  const saved = current === "" ? null : Number(current);
  return saved === null || choices.includes(saved) ? choices : [...choices, saved].sort((a, b) => a - b);
}

export function technicalBody(values: TechnicalValues) {
  // Empty is "none", not zero; text that is not a number goes as typed, so the
  // server refuses it on its field — `Number("abc")` is NaN, which JSON sends
  // as `null` and would quietly clear the count (AUD-09 §4, FV-06).
  const count = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  };
  return {
    unitTypeId: values.unitTypeId,
    orientation: values.orientation || null,
    // Canonical decimals by the shared locale rule; unreadable text goes as typed for the server to refuse (FV-06).
    // The gross area goes too, and counts only for land; the server adds up everyone else's.
    ...Object.fromEntries(ENTERED_AREA_FIELDS.map((field) => [field, decimalPayload(values.areas[field], areaRule(AREA_LABELS[field]))])),
    bedrooms: count(values.counts.bedrooms),
    bathrooms: count(values.counts.bathrooms),
    storage: count(values.counts.storage),
    attributes: Object.keys(values.attributes).length ? attributesPayload(values.attributes) : null,
    description: values.description.trim() || null,
  };
}

function attributesPayload(attributes: UnitAttributes): UnitAttributes {
  const out: Record<string, unknown> = { ...attributes };
  for (const key of ["frontage", "ceilingHeight"] as const) {
    const value = out[key];
    if (typeof value === "string") out[key] = decimalPayload(value, metresRule(key));
  }
  return out as UnitAttributes;
}

/**
 * The shared decimal rule's sentences for the typed areas, before anything is
 * sent (AUD-09 §3, FV-04): `1,234` is refused with both readings offered, the
 * same sentence finance gives.
 */
export function technicalProblems(values: TechnicalValues, areaLabel: (field: AreaField) => string = (field) => AREA_LABELS[field]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const field of ENTERED_AREA_FIELDS) {
    const problem = decimalProblem(values.areas[field], areaRule(areaLabel(field)));
    if (problem) found[field] = problem;
  }
  return found;
}

export function warningsFor(values: TechnicalValues, types: UnitTypeOption[], t: Translate<"projects">): string[] {
  const type = types.find((candidate) => candidate.id === values.unitTypeId);
  if (!type) return [];
  const count = (value: string) => (value.trim() === "" ? null : Number(value));
  const findings = unitWarningFindings(type.category, { bedrooms: count(values.counts.bedrooms), bathrooms: count(values.counts.bathrooms), storage: count(values.counts.storage), internalArea: values.areas.internalArea || null, saleableArea: values.areas.saleableArea || null });
  return findings.map((finding) => (finding.kind === "count" ? t(`unitWarnings.${finding.field}`, { category: t(`unitCategory.${type.category}`).toLowerCase() }) : t("unitWarnings.saleableBelowInternal")));
}

/** The technical half of the form, shared by a single unit and a batch's defaults (§42). */
export function TechnicalFields({ idPrefix, values, onChange, types, errors, currentTypeId }: { idPrefix: string; values: TechnicalValues; onChange: (values: TechnicalValues) => void; types: UnitTypeOption[]; errors: Record<string, string>; currentTypeId?: string }) {
  const [more, setMore] = React.useState(false);
  const t = useTranslations("projects");
  const locale = useLocale();
  const type = types.find((candidate) => candidate.id === values.unitTypeId);
  const category = type?.category ?? "OTHER";
  const offered = types.filter((candidate) => candidate.isActive || candidate.id === currentTypeId);
  const set = (patch: Partial<TechnicalValues>) => onChange({ ...values, ...patch });
  // A count the type does not expect stays reachable, and shows whenever it already holds a value.
  const counts = COUNT_FIELDS.filter((field) => expectsCount(category, field) || values.counts[field] !== "" || more);
  const areaFields: AreaField[] = [...MAIN_AREAS, ...(more ? MORE_AREAS : MORE_AREAS.filter((field) => values.areas[field] !== ""))];
  const worked = shownAreas(values, category);
  const attributes = attributesFor(category);
  const workedOut = (field: AreaField): field is "netArea" | "grossArea" => field === "netArea" || (field === "grossArea" && !grossAreaIsTyped(category));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("unitDialog.type")} htmlFor={`${idPrefix}-type`} error={errors.unitTypeId} required>
          <FormSelect id={`${idPrefix}-type`} className={selectClass} value={values.unitTypeId} onChange={(event) => set({ unitTypeId: event.target.value })} aria-invalid={Boolean(errors.unitTypeId)}>
            <option value="">{t("unitDialog.chooseType")}</option>
            {offered.map((option) => (
              <option key={option.id} value={option.id}>
                {unitTypeName(option.name, locale)}
                {option.isActive ? "" : t("unitDialog.retiredSuffix")}
              </option>
            ))}
          </FormSelect>
        </Field>
        <Field label={t("unitDialog.orientation")} htmlFor={`${idPrefix}-orientation`} error={errors.orientation}>
          <FormSelect id={`${idPrefix}-orientation`} className={selectClass} value={values.orientation} onChange={(event) => set({ orientation: event.target.value as UnitOrientation | "" })}>
            <option value="">{t("unitDialog.notSet")}</option>
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
          {areaFields.map((field) =>
            workedOut(field) ? (
              // A sum, never typed: shown as it will be saved, and worked out again by the server.
              <Field key={field} label={t(`area.${field}`)} htmlFor={`${idPrefix}-${field}`} error={errors[field]} hint={t(field === "netArea" ? "unitDialog.netAreaHint" : "unitDialog.grossAreaHint")}>
                <Input
                  id={`${idPrefix}-${field}`}
                  value={worked[field] === null ? "" : localisedNumber(Number(worked[field]), { minimumFractionDigits: 2, maximumFractionDigits: 2 }, locale, "en")}
                  readOnly
                  aria-readonly="true"
                  className="bg-surface-muted text-fg-muted"
                  data-testid={`${idPrefix}-${field}-sum`}
                />
              </Field>
            ) : (
              <Field key={field} label={t(`area.${field}`)} htmlFor={`${idPrefix}-${field}`} error={errors[field]}>
                <Input id={`${idPrefix}-${field}`} inputMode="decimal" value={values.areas[field as EnteredAreaField]} onChange={(event) => set({ areas: { ...values.areas, [field]: numberText(event.target.value) } })} aria-invalid={Boolean(errors[field])} />
              </Field>
            ),
          )}
        </div>
      </fieldset>

      {counts.length ? (
        <div className="grid grid-cols-3 gap-3">
          {counts.map((field) => (
            <Field key={field} label={t(`count.${field}`)} htmlFor={`${idPrefix}-${field}`} error={errors[field]}>
              <FormSelect id={`${idPrefix}-${field}`} className={selectClass} value={values.counts[field]} onChange={(event) => set({ counts: { ...values.counts, [field]: event.target.value } })} aria-invalid={Boolean(errors[field])}>
                <option value="">{t("unitDialog.notSet")}</option>
                {choicesFor(field, values.counts[field]).map((choice) => (
                  <option key={choice} value={String(choice)}>
                    {choice}
                  </option>
                ))}
              </FormSelect>
            </Field>
          ))}
        </div>
      ) : null}

      {attributes.length ? (
        <div className="flex flex-wrap items-end gap-4">
          {attributes.map((key) => {
            const spec = UNIT_ATTRIBUTES[key];
            if (spec.kind === "boolean") {
              return (
                <label key={key} className="flex h-10 items-center gap-2 text-table text-fg">
                  <Checkbox
                    checked={Boolean(values.attributes[key as "covered" | "evReady"])}
                    onCheckedChange={(checked) => {
                      const next = { ...values.attributes };
                      if (checked === true) next[key as "covered" | "evReady"] = true;
                      else delete next[key as "covered" | "evReady"];
                      set({ attributes: next });
                    }}
                  />
                  {t(`attribute.${key}`)}
                </label>
              );
            }
            const value = (values.attributes[key as "frontage" | "ceilingHeight"] as string | undefined) ?? "";
            return (
              <Field key={key} label={t(`attribute.${key}`)} htmlFor={`${idPrefix}-${key}`} error={errors[key]} className="w-40">
                <Input
                  id={`${idPrefix}-${key}`}
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => {
                    const next = { ...values.attributes };
                    const text = numberText(event.target.value);
                    if (text) next[key as "frontage" | "ceilingHeight"] = text;
                    else delete next[key as "frontage" | "ceilingHeight"];
                    set({ attributes: next });
                  }}
                />
              </Field>
            );
          })}
        </div>
      ) : null}

      <button type="button" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong" onClick={() => setMore((open) => !open)} aria-expanded={more}>
        <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} aria-hidden="true" />
        {more ? t("unitDialog.fewer") : t("unitDialog.more")}
      </button>

      <Field label={t("unitDialog.description")} htmlFor={`${idPrefix}-description`} error={errors.description}>
        <Textarea id={`${idPrefix}-description`} value={values.description} onChange={(event) => set({ description: event.target.value })} maxLength={1000} rows={2} />
      </Field>
    </div>
  );
}

export function technicalFromUnit(unit: UnitDTO): TechnicalValues {
  return {
    unitTypeId: unit.unitType.id,
    orientation: unit.orientation ?? "",
    areas: Object.fromEntries(ENTERED_AREA_FIELDS.map((field) => [field, unit.areas[field] ?? ""])) as Record<EnteredAreaField, string>,
    counts: Object.fromEntries(COUNT_FIELDS.map((field) => [field, unit[field] === null ? "" : String(unit[field])])) as Record<CountField, string>,
    attributes: { ...unit.attributes },
    description: unit.description ?? "",
  };
}

export function UnitDialog({
  open,
  onOpenChange,
  floor,
  unit,
  types,
  canManagePrice = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floor: { id: string; name: string; buildingName: string };
  unit?: UnitDTO;
  types: UnitTypeOption[];
  /** Whether the person may set prices (Sales' `project.unit.price.manage`): the dialog then carries the asking price too. */
  canManagePrice?: boolean;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("projects");
  const locale = useLocale();
  // Closing with unsaved input asks through the shared prompt (AUD-03 §5):
  // the X, Escape, the backdrop and Cancel all arrive here as a guarded close.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{unit ? t("unitDialog.editTitle", { code: unit.unitCode }) : t("unitDialog.addTitle")}</DialogTitle>
        <DialogDescription>
          {floor.buildingName} · {floorName(floor.name, locale)}
        </DialogDescription>
        {/* Mounted per opening: each opening starts from the unit as loaded. */}
        <UnitForm floor={floor} unit={unit} types={types} canManagePrice={canManagePrice} onSaved={onSaved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function UnitForm({
  floor,
  unit,
  types,
  canManagePrice,
  onSaved,
  onDone,
}: {
  floor: { id: string; name: string; buildingName: string };
  unit?: UnitDTO;
  types: UnitTypeOption[];
  canManagePrice: boolean;
  onSaved: (id: string) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const t = useTranslations("projects");
  const locale = useLocale();
  const [code, setCode] = React.useState(unit?.unitCode ?? "");
  const [active, setActive] = React.useState(unit?.isActive ?? true);
  const [technical, setTechnical] = React.useState<TechnicalValues>(() => (unit ? technicalFromUnit(unit) : emptyTechnical(types.find((type) => type.isActive)?.id ?? "")));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  // The asking price, per m² of the gross area these fields work out (2026-11-09); saved through Sales after the unit.
  const grossArea = shownAreas(technical, types.find((type) => type.id === technical.unitTypeId)?.category ?? "OTHER").grossArea;
  const price = useUnitPrice({ unitId: unit?.id, enabled: canManagePrice, grossArea });

  // What was typed is not thrown away by a stray click, a link or a closed tab
  // (E-05D §53, AUD-03 §3): the unit registers with the tab's coordinator.
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const editor = useValuesEditor(
    { code, active, technical, price: price.touched ? [price.view.entry, price.view.text] : null },
    { module: "units", saveKind: unit ? "save" : "create", label: unit ? t("unitDialog.editorLabel", { code: unit.unitCode }) : t("unitDialog.newLabel", { floor: floor.name }), save: () => persist.current() },
  );

  persist.current = async () => {
    const local: Record<string, string> = {};
    if (!code.trim()) local.unitCode = t("unitDialog.codeRequired");
    if (!technical.unitTypeId) local.unitTypeId = t("unitDialog.typeRequired");
    Object.assign(local, technicalProblems(technical, (field) => t(`area.${field}`)));
    // The price is checked first too, so a price that cannot be saved saves nothing.
    const priceOk = price.check();
    if (Object.keys(local).length || !priceOk) {
      setErrors(local);
      return INVALID;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    const body = { unitCode: code, ...technicalBody(technical) };
    try {
      if (unit) {
        await editor.track(() => structureApi(`/api/project-units/${unit.id}`, { method: "PATCH", body: { ...body, isActive: active, expectedVersion: unit.version } }));
        toast({ title: code !== unit.unitCode ? t("unitDialog.renamed", { old: unit.unitCode, code }) : t("unitDialog.saved", { code }) });
        await price.save(unit.id, code);
        onSaved(unit.id);
      } else {
        const created = await editor.track(() => structureApi<{ id: string }>(`/api/project-floors/${floor.id}/units`, { body }));
        toast({ title: t("unitDialog.added", { code, floor: floorName(floor.name, locale) }) });
        await price.save(created.id, code);
        onSaved(created.id);
      }
      onDone();
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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void persist.current();
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
      <FormError message={formError} />
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("unitDialog.code")} htmlFor="unit-code" error={errors.unitCode} required hint={unit ? t("unitDialog.codeHintEdit") : t("unitDialog.codeHintNew")}>
            <Input id="unit-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={80} autoFocus aria-invalid={Boolean(errors.unitCode)} />
          </Field>
        </div>
        <TechnicalFields idPrefix="unit" values={technical} onChange={setTechnical} types={types} errors={errors} currentTypeId={unit?.unitType.id} />
        <UnitPriceFields price={price} />
        {unit ? (
          <label className="flex items-center gap-2 text-table text-fg">
            <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
            {t("unitDialog.active")}
          </label>
        ) : null}
      </fieldset>
      <Warnings items={warningsFor(technical, types, t)} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("unitDialog.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? t("unitDialog.saving") : unit ? t("unitDialog.save") : t("unitDialog.addTitle")}
        </Button>
      </DialogFooter>
    </form>
  );
}
