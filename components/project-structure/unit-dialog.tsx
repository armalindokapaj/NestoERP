"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
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
import { attributesFor, expectsCount, unitWarnings } from "@/lib/modules/project-structure/structure.rules";
import {
  AREA_FIELDS,
  AREA_LABELS,
  COUNT_FIELDS,
  UNIT_ATTRIBUTES,
  UNIT_ORIENTATIONS,
  UNIT_POSITIONS,
  type AreaField,
  type CountField,
  type UnitAttributes,
  type UnitDTO,
  type UnitOrientation,
  type UnitPosition,
  type UnitTypeOption,
} from "@/lib/modules/project-structure/structure.types";
import { cn } from "@/lib/utils/cn";
import { areaRule, decimalPayload, decimalProblem, Field, fieldErrors, FormError, failureMessage, metresRule, numberText, structureApi, Warnings } from "./structure-ui";

/**
 * Adding and editing a unit (E-05B §17-§26, §40, §55, §74, §95).
 *
 * The floor is the context and is not asked for again (§40). The type decides
 * which counts and details are offered — bedrooms for an apartment, EV-ready
 * for a parking space — and anything unusual is a warning beside the save
 * button, never a refusal (§74). Saving sends the version the form loaded, so
 * a unit somebody else changed in the meantime is not silently overwritten.
 */

export type TechnicalValues = {
  unitTypeId: string;
  position: UnitPosition | "";
  orientation: UnitOrientation | "";
  areas: Record<AreaField, string>;
  counts: Record<CountField, string>;
  attributes: UnitAttributes;
  description: string;
};

const PRIMARY_AREAS: AreaField[] = ["internalArea", "grossArea", "saleableArea", "outdoorArea"];

export function emptyTechnical(unitTypeId = ""): TechnicalValues {
  return {
    unitTypeId,
    position: "",
    orientation: "",
    areas: Object.fromEntries(AREA_FIELDS.map((field) => [field, ""])) as Record<AreaField, string>,
    counts: { rooms: "", bedrooms: "", bathrooms: "" },
    attributes: {},
    description: "",
  };
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
    position: values.position || null,
    orientation: values.orientation || null,
    // Canonical decimals by the shared locale rule; unreadable text goes as typed for the server to refuse (FV-06).
    ...Object.fromEntries(AREA_FIELDS.map((field) => [field, decimalPayload(values.areas[field], areaRule(AREA_LABELS[field]))])),
    rooms: count(values.counts.rooms),
    bedrooms: count(values.counts.bedrooms),
    bathrooms: count(values.counts.bathrooms),
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
export function technicalProblems(values: TechnicalValues): Record<string, string> {
  const found: Record<string, string> = {};
  for (const field of AREA_FIELDS) {
    const problem = decimalProblem(values.areas[field], areaRule(AREA_LABELS[field]));
    if (problem) found[field] = problem;
  }
  return found;
}

export function warningsFor(values: TechnicalValues, types: UnitTypeOption[]): string[] {
  const type = types.find((candidate) => candidate.id === values.unitTypeId);
  if (!type) return [];
  const count = (value: string) => (value.trim() === "" ? null : Number(value));
  return unitWarnings(type.category, { rooms: count(values.counts.rooms), bedrooms: count(values.counts.bedrooms), bathrooms: count(values.counts.bathrooms), internalArea: values.areas.internalArea || null, saleableArea: values.areas.saleableArea || null });
}

/** The technical half of the form, shared by a single unit and a batch's defaults (§42). */
export function TechnicalFields({ idPrefix, values, onChange, types, errors, currentTypeId }: { idPrefix: string; values: TechnicalValues; onChange: (values: TechnicalValues) => void; types: UnitTypeOption[]; errors: Record<string, string>; currentTypeId?: string }) {
  const [more, setMore] = React.useState(false);
  const t = useTranslations("projects");
  const type = types.find((candidate) => candidate.id === values.unitTypeId);
  const category = type?.category ?? "OTHER";
  const offered = types.filter((candidate) => candidate.isActive || candidate.id === currentTypeId);
  const set = (patch: Partial<TechnicalValues>) => onChange({ ...values, ...patch });
  // A count the type does not expect stays reachable, and shows whenever it already holds a value.
  const counts = COUNT_FIELDS.filter((field) => expectsCount(category, field) || values.counts[field] !== "" || more);
  const extraAreas = AREA_FIELDS.filter((field) => !PRIMARY_AREAS.includes(field));
  const attributes = attributesFor(category);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("unitDialog.type")} htmlFor={`${idPrefix}-type`} error={errors.unitTypeId} required>
          <select id={`${idPrefix}-type`} className={selectClass} value={values.unitTypeId} onChange={(event) => set({ unitTypeId: event.target.value })} aria-invalid={Boolean(errors.unitTypeId)}>
            <option value="">{t("unitDialog.chooseType")}</option>
            {offered.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.isActive ? "" : " (retired)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("unitDialog.position")} htmlFor={`${idPrefix}-position`} error={errors.position}>
          <select id={`${idPrefix}-position`} className={selectClass} value={values.position} onChange={(event) => set({ position: event.target.value as UnitPosition | "" })}>
            <option value="">{t("unitDialog.notSet")}</option>
            {UNIT_POSITIONS.map((position) => (
              <option key={position} value={position}>
                {t(`position.${position}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("unitDialog.orientation")} htmlFor={`${idPrefix}-orientation`} error={errors.orientation}>
          <select id={`${idPrefix}-orientation`} className={selectClass} value={values.orientation} onChange={(event) => set({ orientation: event.target.value as UnitOrientation | "" })}>
            <option value="">{t("unitDialog.notSet")}</option>
            {UNIT_ORIENTATIONS.map((orientation) => (
              <option key={orientation} value={orientation}>
                {t(`orientation.${orientation}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-meta font-semibold text-fg">{t("unitDialog.areas")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...PRIMARY_AREAS, ...(more ? extraAreas : extraAreas.filter((field) => values.areas[field] !== ""))].map((field) => (
            <Field key={field} label={t(`area.${field}`)} htmlFor={`${idPrefix}-${field}`} error={errors[field]}>
              <Input id={`${idPrefix}-${field}`} inputMode="decimal" value={values.areas[field]} onChange={(event) => set({ areas: { ...values.areas, [field]: numberText(event.target.value) } })} aria-invalid={Boolean(errors[field])} />
            </Field>
          ))}
        </div>
      </fieldset>

      {counts.length ? (
        <div className="grid grid-cols-3 gap-3">
          {counts.map((field) => (
            <Field key={field} label={t(`count.${field}`)} htmlFor={`${idPrefix}-${field}`} error={errors[field]}>
              <Input id={`${idPrefix}-${field}`} inputMode="numeric" value={values.counts[field]} onChange={(event) => set({ counts: { ...values.counts, [field]: event.target.value.replace(/\D/g, "") } })} aria-invalid={Boolean(errors[field])} />
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
    position: unit.position ?? "",
    orientation: unit.orientation ?? "",
    areas: Object.fromEntries(AREA_FIELDS.map((field) => [field, unit.areas[field] ?? ""])) as Record<AreaField, string>,
    counts: { rooms: unit.rooms === null ? "" : String(unit.rooms), bedrooms: unit.bedrooms === null ? "" : String(unit.bedrooms), bathrooms: unit.bathrooms === null ? "" : String(unit.bathrooms) },
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
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floor: { id: string; name: string; buildingName: string };
  unit?: UnitDTO;
  types: UnitTypeOption[];
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("projects");
  // Closing with unsaved input asks through the shared prompt (AUD-03 §5):
  // the X, Escape, the backdrop and Cancel all arrive here as a guarded close.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{unit ? t("unitDialog.editTitle", { code: unit.unitCode }) : t("unitDialog.addTitle")}</DialogTitle>
        <DialogDescription>
          {floor.buildingName} · {floor.name}
        </DialogDescription>
        {/* Mounted per opening: each opening starts from the unit as loaded. */}
        <UnitForm floor={floor} unit={unit} types={types} onSaved={onSaved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function UnitForm({
  floor,
  unit,
  types,
  onSaved,
  onDone,
}: {
  floor: { id: string; name: string; buildingName: string };
  unit?: UnitDTO;
  types: UnitTypeOption[];
  onSaved: (id: string) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const t = useTranslations("projects");
  const [code, setCode] = React.useState(unit?.unitCode ?? "");
  const [name, setName] = React.useState(unit?.name ?? "");
  const [active, setActive] = React.useState(unit?.isActive ?? true);
  const [technical, setTechnical] = React.useState<TechnicalValues>(() => (unit ? technicalFromUnit(unit) : emptyTechnical(types.find((type) => type.isActive)?.id ?? "")));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  // What was typed is not thrown away by a stray click, a link or a closed tab
  // (E-05D §53, AUD-03 §3): the unit registers with the tab's coordinator.
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const editor = useValuesEditor(
    { code, name, active, technical },
    { module: "units", saveKind: unit ? "save" : "create", label: unit ? t("unitDialog.editorLabel", { code: unit.unitCode }) : t("unitDialog.newLabel", { floor: floor.name }), save: () => persist.current() },
  );

  persist.current = async () => {
    const local: Record<string, string> = {};
    if (!code.trim()) local.unitCode = t("unitDialog.codeRequired");
    if (!technical.unitTypeId) local.unitTypeId = t("unitDialog.typeRequired");
    Object.assign(local, technicalProblems(technical));
    if (Object.keys(local).length) {
      setErrors(local);
      return INVALID;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    const body = { unitCode: code, name: name || null, ...technicalBody(technical) };
    try {
      if (unit) {
        await editor.track(() => structureApi(`/api/project-units/${unit.id}`, { method: "PATCH", body: { ...body, isActive: active, expectedVersion: unit.version } }));
        toast({ title: code !== unit.unitCode ? t("unitDialog.renamed", { old: unit.unitCode, code }) : t("unitDialog.saved", { code }) });
        onSaved(unit.id);
      } else {
        const created = await editor.track(() => structureApi<{ id: string }>(`/api/project-floors/${floor.id}/units`, { body }));
        toast({ title: t("unitDialog.added", { code, floor: floor.name }) });
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
          <Field label={t("unitDialog.name")} htmlFor="unit-name" error={errors.name}>
            <Input id="unit-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder={t("unitDialog.namePlaceholder")} />
          </Field>
        </div>
        <TechnicalFields idPrefix="unit" values={technical} onChange={setTechnical} types={types} errors={errors} currentTypeId={unit?.unitType.id} />
        {unit ? (
          <label className="flex items-center gap-2 text-table text-fg">
            <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
            {t("unitDialog.active")}
          </label>
        ) : null}
      </fieldset>
      <Warnings items={warningsFor(technical, types)} />
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
