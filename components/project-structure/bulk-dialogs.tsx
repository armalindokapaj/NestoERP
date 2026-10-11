"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";

import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useValuesEditor } from "@/components/project-planning/use-values-editor";
import { generateUnitCodes, planFloorRange, suggestCopiedCode, type FloorDraft } from "@/lib/modules/project-structure/structure.rules";
import {
  CONFIRM_FLOORS_ABOVE,
  FLOOR_LEVEL_TYPES,
  MAX_BULK_FLOORS,
  MAX_BULK_UNITS,
  type BatchConflict,
  type BatchPreview,
  type BuildingNodeDTO,
  type FloorLevelType,
  type FloorNodeDTO,
  type UnitListDTO,
  type UnitTypeOption,
} from "@/lib/modules/project-structure/structure.types";
import { cn } from "@/lib/utils/cn";
import { Field, fieldErrors, FormError, failureMessage, Steps, structureApi, Warnings } from "./structure-ui";
import { emptyTechnical, technicalBody, TechnicalFields, warningsFor, type TechnicalValues } from "./unit-dialog";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Creating structure in batches (E-05B §37-§45, §98).
 *
 * Every batch is previewed before it is written: the browser builds the list,
 * the server answers which entries clash — with the project, or with each
 * other — and nothing is created while any clash remains. The server checks
 * again as it writes, and writes all or nothing.
 *
 * Each batch mounts when its dialog opens and registers with the tab's
 * unsaved-work coordinator (AUD-03 §5): closing it with a range, codes or
 * edited names in it asks. Creating a batch is a reviewed, multistep step, so
 * Save and continue never creates one — the prompt offers Stay or Discard.
 */

function conflictFor(conflicts: BatchConflict[], index: number) {
  return conflicts.find((conflict) => conflict.index === index);
}

function ConflictBadge({ conflict }: { conflict: BatchConflict | undefined }) {
  const t = useTranslations("projects");
  if (!conflict) return null;
  return <Badge tone="danger">{conflict.reason === "EXISTS" ? t("bulk.alreadyExists") : t("bulk.repeated")}</Badge>;
}

/* Floors by range ------------------------------------------------------------ */

export function BulkFloorsDialog({ open, onOpenChange, buildings, initialBuildingId, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; buildings: BuildingNodeDTO[]; initialBuildingId: string; onCreated: (buildingId: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <BulkFloorsBody buildings={buildings} initialBuildingId={initialBuildingId} onCreated={onCreated} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BulkFloorsBody({ buildings, initialBuildingId, onCreated, onDone }: { buildings: BuildingNodeDTO[]; initialBuildingId: string; onCreated: (buildingId: string) => void; onDone: () => void }) {
  const t = useTranslations("projects");
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  const [buildingId, setBuildingId] = React.useState(initialBuildingId);
  const [from, setFrom] = React.useState("0");
  const [to, setTo] = React.useState("5");
  const [drafts, setDrafts] = React.useState<FloorDraft[]>([]);
  const [conflicts, setConflicts] = React.useState<BatchConflict[]>([]);
  const [confirmLarge, setConfirmLarge] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const building = buildings.find((candidate) => candidate.id === buildingId);
  const editor = useValuesEditor({ buildingId, from, to, drafts, confirmLarge }, { module: "units", saveKind: "none", workflow: t("bulk.createFloors"), label: t("bulk.newFloors") });

  async function check(list: FloorDraft[]) {
    const preview = await structureApi<BatchPreview>(`/api/project-buildings/${buildingId}/floors/bulk`, { body: { floors: list, dryRun: true } });
    setConflicts(preview.conflicts);
    return preview;
  }

  async function next(event: React.FormEvent) {
    event.preventDefault();
    const start = Number(from);
    const end = Number(to);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return setError(t("bulk.wholeNumbers"));
    if (end < start) return setError(t("bulk.lastBelowFirst"));
    if (end - start + 1 > MAX_BULK_FLOORS) return setError(t("bulk.atMostFloors", { max: MAX_BULK_FLOORS }));
    if (start < -50 || end > 500) return setError(t("bulk.floorRange"));
    const list = planFloorRange(start, end);
    setPending(true);
    setError(null);
    try {
      await check(list);
      setDrafts(list);
      setStep(1);
    } catch (failure) {
      setError(failureMessage(failure, t("bulk.floorsCheckFailed")));
    } finally {
      setPending(false);
    }
  }

  async function create() {
    setPending(true);
    setError(null);
    try {
      const preview = await check(drafts);
      if (preview.conflicts.length) return setError(t("bulk.floorsClash"));
      const result = await editor.track(() => structureApi<{ count: number }>(`/api/project-buildings/${buildingId}/floors/bulk`, { body: { floors: drafts, confirmLarge } }));
      toast({ title: t("bulk.floorsAdded", { floors: t("counts.floors", { count: result.count }), building: building?.name ?? t("bulk.theBuilding") }) });
      onCreated(buildingId);
      onDone();
    } catch (failure) {
      const details = (failure as { details?: { conflicts?: BatchConflict[] } }).details;
      if (details?.conflicts) setConflicts(details.conflicts);
      setError(failureMessage(failure, t("bulk.floorsCreateFailed")));
    } finally {
      setPending(false);
    }
  }

  const edit = (index: number, patch: Partial<FloorDraft>) => {
    setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
    setConflicts([]);
  };
  const large = drafts.length > CONFIRM_FLOORS_ABOVE;

  return (
    <>
      <DialogTitle>{t("bulk.createFloors")}</DialogTitle>
      <DialogDescription>{t("bulk.createFloorsBody")}</DialogDescription>
      <Steps steps={[t("bulk.stepRange"), t("bulk.stepNames")]} current={step} />
      {step === 0 ? (
        <form onSubmit={next} className="mt-4 space-y-4">
          <FormError message={error} />
          <Field label={t("bulk.building")} htmlFor="bulk-floors-building" required>
            <FormSelect id="bulk-floors-building" className={selectClass} value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
              {buildings.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </FormSelect>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("bulk.fromFloor")} htmlFor="bulk-floors-from" hint={t("bulk.fromHint")} required>
              <Input id="bulk-floors-from" inputMode="numeric" value={from} onChange={(event) => setFrom(event.target.value.replace(/[^\d-]/g, ""))} />
            </Field>
            <Field label={t("bulk.toFloor")} htmlFor="bulk-floors-to" required>
              <Input id="bulk-floors-to" inputMode="numeric" value={to} onChange={(event) => setTo(event.target.value.replace(/[^\d-]/g, ""))} />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("bulk.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? t("bulk.checking") : t("bulk.previewNames")}
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <div className="mt-4 space-y-4">
          <FormError message={error} />
          <p className="text-table text-fg-muted">
            {t("counts.floors", { count: drafts.length })} {t("bulk.in")} <span className="font-medium text-fg">{building?.name}</span>
            {conflicts.length ? <span className="text-danger-strong"> · {t("bulk.clashes", { count: conflicts.length })}</span> : null}
          </p>
          <ol className="max-h-[45dvh] divide-y divide-line overflow-y-auto rounded-md border border-line" data-testid="bulk-floor-preview">
            {drafts.map((draft, index) => {
              const conflict = conflictFor(conflicts, index);
              return (
                <li key={index} className={cn("grid grid-cols-[3rem_minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2", conflict && "bg-danger-soft/40")}>
                  <span className="text-table tabular-nums text-fg-muted">{draft.number}</span>
                  <FormSelect aria-label={t("bulk.levelOf", { number: draft.number ?? "" })} className={cn(selectClass, "h-9")} value={draft.levelType} onChange={(event) => edit(index, { levelType: event.target.value as FloorLevelType })}>
                    {FLOOR_LEVEL_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`floorLevel.${type}`)}
                      </option>
                    ))}
                  </FormSelect>
                  <Input aria-label={t("bulk.nameOf", { number: draft.number ?? "" })} className="h-9" value={draft.name} onChange={(event) => edit(index, { name: event.target.value })} maxLength={120} />
                  <ConflictBadge conflict={conflict} />
                </li>
              );
            })}
          </ol>
          {large ? (
            <label className="flex items-center gap-2 text-table text-fg">
              <Checkbox checked={confirmLarge} onCheckedChange={(value) => setConfirmLarge(value === true)} />
              {t("bulk.confirmLarge", { count: drafts.length })}
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setStep(0)} disabled={pending}>
              {t("bulk.back")}
            </Button>
            <Button type="button" onClick={() => void create()} disabled={pending || (large && !confirmLarge) || drafts.some((draft) => !draft.name.trim())}>
              {pending ? t("bulk.creating") : t("bulk.create", { what: t("counts.floors", { count: drafts.length }) })}
            </Button>
          </DialogFooter>
        </div>
      )}
    </>
  );
}

/* Units by code pattern ------------------------------------------------------ */

export function BulkUnitsDialog({ open, onOpenChange, floor, buildingName, types, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; floor: FloorNodeDTO; buildingName: string; types: UnitTypeOption[]; onCreated: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <BulkUnitsBody floor={floor} buildingName={buildingName} types={types} onCreated={onCreated} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BulkUnitsBody({ floor, buildingName, types, onCreated, onDone }: { floor: FloorNodeDTO; buildingName: string; types: UnitTypeOption[]; onCreated: () => void; onDone: () => void }) {
  const t = useTranslations("projects");
  const toast = useToast();
  const base = floor.number !== null && floor.number > 0 ? floor.number * 100 : 1;
  const [step, setStep] = React.useState(0);
  const [prefix, setPrefix] = React.useState("");
  const [start, setStart] = React.useState(() => String(base + (base === 1 ? 0 : 1)));
  const [end, setEnd] = React.useState(() => String(base + (base === 1 ? 3 : 4)));
  const [padding, setPadding] = React.useState(() => (base === 1 ? "2" : "0"));
  const [suffix, setSuffix] = React.useState("");
  const [technical, setTechnical] = React.useState<TechnicalValues>(() => emptyTechnical(types.find((type) => type.isActive)?.id ?? ""));
  const [conflicts, setConflicts] = React.useState<BatchConflict[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const editor = useValuesEditor({ prefix, start, end, padding, suffix, technical }, { module: "units", saveKind: "none", workflow: t("bulk.createUnits"), label: t("bulk.newUnitsOn", { floor: floor.name }) });

  const pattern = { prefix, start: Number(start), end: Number(end), padding: Number(padding) || 0, suffix };
  const valid = Number.isInteger(pattern.start) && Number.isInteger(pattern.end) && pattern.start >= 0 && pattern.end >= pattern.start && pattern.end - pattern.start < MAX_BULK_UNITS && pattern.padding >= 0 && pattern.padding <= 8;
  const codes = valid ? generateUnitCodes(pattern) : [];

  async function preview() {
    const result = await structureApi<BatchPreview & { warnings: string[] }>(`/api/project-floors/${floor.id}/units/bulk`, { body: { units: codes.map((unitCode) => ({ unitCode })), defaults: technicalBody(technical), dryRun: true } });
    setConflicts(result.conflicts);
    return result;
  }

  async function toStep(target: number) {
    setError(null);
    if (target >= 1) {
      if (!valid) return setError(t("bulk.unitRange", { max: MAX_BULK_UNITS }));
      if (!technical.unitTypeId) return setErrors({ unitTypeId: t("bulk.unitsType") });
    }
    if (target === 2) {
      setPending(true);
      try {
        await preview();
      } catch (failure) {
        const fields = fieldErrors(failure);
        setErrors(fields);
        setError(failureMessage(failure, t("bulk.unitsCheckFailed")));
        if (Object.keys(fields).length) return setStep(1);
        return;
      } finally {
        setPending(false);
      }
    }
    setErrors({});
    setStep(target);
  }

  async function create() {
    setPending(true);
    setError(null);
    try {
      const checked = await preview();
      if (checked.conflicts.length) return setError(t("bulk.codesClash"));
      const result = await editor.track(() => structureApi<{ count: number }>(`/api/project-floors/${floor.id}/units/bulk`, { body: { units: codes.map((unitCode) => ({ unitCode })), defaults: technicalBody(technical) } }));
      toast({ title: t("bulk.unitsAdded", { units: t("counts.units", { count: result.count }), floor: floor.name }) });
      onCreated();
      onDone();
    } catch (failure) {
      const details = (failure as { details?: { conflicts?: BatchConflict[] } }).details;
      if (details?.conflicts) setConflicts(details.conflicts);
      setError(failureMessage(failure, t("bulk.unitsCreateFailed")));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogTitle>{t("bulk.bulkAddUnits")}</DialogTitle>
      <DialogDescription>
        {t("bulk.bulkBody", { building: buildingName, floor: floor.name })}
      </DialogDescription>
      <Steps steps={[t("bulk.stepCodes"), t("bulk.stepShared"), t("bulk.stepPreview")]} current={step} />
      <FormError message={error} />
      {step === 0 ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label={t("bulk.prefix")} htmlFor="bulk-prefix" className="col-span-2 sm:col-span-1">
              <Input id="bulk-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} maxLength={20} placeholder="A-" />
            </Field>
            <Field label={t("bulk.start")} htmlFor="bulk-start" required>
              <Input id="bulk-start" inputMode="numeric" value={start} onChange={(event) => setStart(event.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label={t("bulk.end")} htmlFor="bulk-end" required>
              <Input id="bulk-end" inputMode="numeric" value={end} onChange={(event) => setEnd(event.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label={t("bulk.digits")} htmlFor="bulk-padding" hint={t("bulk.digitsHint")}>
              <Input id="bulk-padding" inputMode="numeric" value={padding} onChange={(event) => setPadding(event.target.value.replace(/\D/g, "").slice(0, 1))} />
            </Field>
            <Field label={t("bulk.suffix")} htmlFor="bulk-suffix">
              <Input id="bulk-suffix" value={suffix} onChange={(event) => setSuffix(event.target.value)} maxLength={20} />
            </Field>
          </div>
          <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-table text-fg" data-testid="bulk-code-sample">
            {codes.length ? (
              <>
                <span className="font-medium">{codes[0]}</span>
                {codes.length > 1 ? (
                  <>
                    {" "}→ <span className="font-medium">{codes[codes.length - 1]}</span>
                  </>
                ) : null}{" "}
                <span className="text-fg-muted">· {t("counts.units", { count: codes.length })}</span>
              </>
            ) : (
              <span className="text-fg-muted">{t("bulk.enterRange")}</span>
            )}
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("bulk.cancel")}
              </Button>
            </DialogClose>
            <Button type="button" onClick={() => void toStep(1)} disabled={!codes.length}>
              {t("bulk.next")}
            </Button>
          </DialogFooter>
        </div>
      ) : step === 1 ? (
        <div className="mt-4 space-y-4">
          <TechnicalFields idPrefix="bulk" values={technical} onChange={setTechnical} types={types} errors={errors} />
          <Warnings items={warningsFor(technical, types)} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setStep(0)} disabled={pending}>
              {t("bulk.back")}
            </Button>
            <Button type="button" onClick={() => void toStep(2)} disabled={pending}>
              {pending ? t("bulk.checking") : t("bulk.preview")}
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-table text-fg-muted">
            {t("counts.units", { count: codes.length })} {t("bulk.ofType")} <span className="font-medium text-fg">{types.find((type) => type.id === technical.unitTypeId)?.name}</span>
            {conflicts.length ? <span className="text-danger-strong">{t("bulk.codesUsed", { count: conflicts.length })}</span> : t("bulk.noClashes")}
          </p>
          <ul className="grid max-h-[40dvh] grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-4" data-testid="bulk-unit-preview">
            {codes.map((code, index) => {
              const conflict = conflictFor(conflicts, index);
              return (
                <li key={`${code}-${index}`} className={cn("flex items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-table", conflict ? "border-danger/40 bg-danger-soft text-danger-strong" : "border-line text-fg")} title={conflict ? (conflict.reason === "EXISTS" ? t("bulk.usedOnProject") : t("bulk.repeatedInBatch")) : undefined}>
                  <span className="truncate font-medium">{code}</span>
                  {conflict ? <span className="text-micro">{conflict.reason === "EXISTS" ? t("bulk.exists") : t("bulk.repeat")}</span> : null}
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setStep(1)} disabled={pending}>
              {t("bulk.back")}
            </Button>
            <Button type="button" onClick={() => void create()} disabled={pending || conflicts.length > 0}>
              {pending ? t("bulk.creating") : t("bulk.create", { what: t("counts.units", { count: codes.length }) })}
            </Button>
          </DialogFooter>
        </div>
      )}
    </>
  );
}

/* Copy a floor ---------------------------------------------------------------- */

type CopyRow = { sourceUnitId: string; sourceCode: string; typeName: string; include: boolean; unitCode: string; name: string };

export function CopyFloorDialog({ open, onOpenChange, projectId, floor, buildings, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; floor: FloorNodeDTO; buildings: BuildingNodeDTO[]; onCreated: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <CopyFloorBody projectId={projectId} floor={floor} buildings={buildings} onCreated={onCreated} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CopyFloorBody({ projectId, floor, buildings, onCreated, onDone }: { projectId: string; floor: FloorNodeDTO; buildings: BuildingNodeDTO[]; onCreated: () => void; onDone: () => void }) {
  const t = useTranslations("projects");
  const toast = useToast();
  const sources = buildings.flatMap((building) => building.floors.filter((candidate) => candidate.id !== floor.id && candidate.unitCount > 0).map((candidate) => ({ ...candidate, buildingName: building.name })));
  const [sourceId, setSourceId] = React.useState("");
  const [rows, setRows] = React.useState<CopyRow[]>([]);
  const [conflicts, setConflicts] = React.useState<BatchConflict[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  // The rows a chosen floor loads are its suggestion; what counts as input is
  // the choice of floor and any row changed from what was suggested.
  const [suggested, setSuggested] = React.useState<CopyRow[]>([]);
  const editor = useValuesEditor({ sourceId, edits: rows.filter((row, index) => JSON.stringify(row) !== JSON.stringify(suggested[index])) }, { module: "units", saveKind: "none", workflow: t("bulk.copyUnits"), label: t("bulk.copyingTo", { floor: floor.name }) });

  async function load(id: string) {
    setSourceId(id);
    setRows([]);
    setConflicts([]);
    if (!id) return;
    const source = sources.find((candidate) => candidate.id === id);
    setPending(true);
    setError(null);
    try {
      const loaded: CopyRow[] = [];
      for (let page = 1; ; page += 1) {
        const result = await structureApi<UnitListDTO>(`/api/projects/${projectId}/units?floorId=${encodeURIComponent(id)}&limit=100&page=${page}`);
        for (const unit of result.items) {
          loaded.push({
            sourceUnitId: unit.id,
            sourceCode: unit.unitCode,
            typeName: unit.unitType.name,
            include: unit.unitType.isActive,
            unitCode: suggestCopiedCode(unit.unitCode, source?.number ?? null, floor.number),
            name: unit.name ? suggestCopiedCode(unit.name, source?.number ?? null, floor.number) : "",
          });
        }
        if (page * result.pageSize >= result.total || page >= 5) break;
      }
      setRows(loaded);
      setSuggested(loaded);
    } catch (failure) {
      setError(failureMessage(failure, t("bulk.sourceLoadFailed")));
    } finally {
      setPending(false);
    }
  }

  const chosen = rows.filter((row) => row.include);
  const body = (dryRun: boolean) => ({ sourceFloorId: sourceId, units: chosen.map((row) => ({ sourceUnitId: row.sourceUnitId, unitCode: row.unitCode, name: row.name || null })), dryRun });

  async function check() {
    const result = await structureApi<BatchPreview>(`/api/project-floors/${floor.id}/units/copy`, { body: body(true) });
    // The server numbers conflicts within the units sent; map them back onto the rows shown.
    const indexOf = chosen.map((row) => rows.indexOf(row));
    setConflicts(result.conflicts.map((conflict) => ({ ...conflict, index: indexOf[conflict.index] ?? conflict.index })));
    return result;
  }

  async function create() {
    if (!chosen.length) return setError(t("bulk.chooseOne"));
    setPending(true);
    setError(null);
    try {
      const checked = await check();
      if (checked.conflicts.length) return setError(t("bulk.copyClash"));
      const result = await editor.track(() => structureApi<{ count: number }>(`/api/project-floors/${floor.id}/units/copy`, { body: body(false) }));
      toast({ title: t("bulk.copied", { units: t("bulk.newUnits", { count: result.count }), floor: floor.name }) });
      onCreated();
      onDone();
    } catch (failure) {
      setError(failureMessage(failure, t("bulk.copyFailed")));
    } finally {
      setPending(false);
    }
  }

  const edit = (index: number, patch: Partial<CopyRow>) => {
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
    setConflicts([]);
  };

  return (
    <>
      <DialogTitle>{t("bulk.copyTitle", { floor: floor.name })}</DialogTitle>
      <DialogDescription>{t("bulk.copyBody")}</DialogDescription>
      <div className="mt-4 space-y-4">
        <FormError message={error} />
        <Field label={t("bulk.copyFrom")} htmlFor="copy-source" required>
          <FormSelect id="copy-source" className={selectClass} value={sourceId} onChange={(event) => void load(event.target.value)}>
            <option value="">{t("bulk.chooseFloor")}</option>
            {buildings.map((building) => {
              const own = sources.filter((candidate) => candidate.buildingId === building.id);
              return own.length ? (
                <optgroup key={building.id} label={building.name}>
                  {own.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} · {t("counts.units", { count: candidate.unitCount })}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </FormSelect>
        </Field>
        {rows.length ? (
          <ul className="max-h-[45dvh] divide-y divide-line overflow-y-auto rounded-md border border-line" data-testid="copy-floor-preview">
            {rows.map((row, index) => {
              const conflict = conflictFor(conflicts, index);
              return (
                <li key={row.sourceUnitId} className={cn("grid grid-cols-[auto_minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2", conflict && "bg-danger-soft/40")}>
                  <Checkbox aria-label={t("bulk.copyNamed", { code: row.sourceCode })} checked={row.include} onCheckedChange={(value) => edit(index, { include: value === true })} />
                  <span className="truncate text-table text-fg-muted" title={row.typeName}>
                    {row.sourceCode} →
                  </span>
                  <Input aria-label={t("bulk.newCodeFor", { code: row.sourceCode })} className="h-9" value={row.unitCode} disabled={!row.include} onChange={(event) => edit(index, { unitCode: event.target.value })} maxLength={80} />
                  <ConflictBadge conflict={conflict} />
                </li>
              );
            })}
          </ul>
        ) : sourceId && !pending ? (
          <p className="text-table text-fg-muted">{t("bulk.noUnits")}</p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={pending}>
              {t("bulk.cancel")}
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void create()} disabled={pending || !chosen.length || chosen.some((row) => !row.unitCode.trim())}>
            {pending ? t("bulk.working") : t("bulk.copy", { what: t("counts.units", { count: chosen.length }) })}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
