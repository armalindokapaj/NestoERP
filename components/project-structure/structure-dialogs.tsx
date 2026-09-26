"use client";

import * as React from "react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COMMITTED, failureOutcome, INVALID, useValuesEditor } from "@/components/project-planning/use-values-editor";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { defaultFloorName } from "@/lib/modules/project-structure/structure.rules";
import { FLOOR_LEVEL_LABELS, FLOOR_LEVEL_TYPES, type BuildingNodeDTO, type FloorLevelType, type FloorNodeDTO } from "@/lib/modules/project-structure/structure.types";
import { Field, fieldErrors, FormError, failureMessage, plural, structureApi } from "./structure-ui";

/**
 * Adding and editing a building (E-05B §35, §54) and a floor (§36), moving a
 * floor to another building (§53) and a unit to another floor (§52). Short
 * dialogs: the building or floor they act on is the context, never re-chosen.
 *
 * Each form mounts when its dialog opens and registers with the tab's
 * unsaved-work coordinator (AUD-03 §5): closing it with unsaved input asks.
 * A move is an explicit action, not a save, so Save and continue never moves.
 */

export function BuildingDialog({ open, onOpenChange, projectId, building, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; building?: BuildingNodeDTO; onSaved: (id: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{building ? `Edit ${building.name}` : "Add building"}</DialogTitle>
        <DialogDescription>{building ? "Renaming changes only what is shown. Floors and units keep their ids and links." : "Every unit sits in a building — a single-building project has one too."}</DialogDescription>
        <BuildingForm projectId={projectId} building={building} onSaved={onSaved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BuildingForm({ projectId, building, onSaved, onDone }: { projectId: string; building?: BuildingNodeDTO; onSaved: (id: string) => void; onDone: () => void }) {
  const [name, setName] = React.useState(building?.name ?? "");
  const [code, setCode] = React.useState(building?.code ?? "");
  const [description, setDescription] = React.useState(building?.description ?? "");
  const [active, setActive] = React.useState(building?.isActive ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const editor = useValuesEditor(
    { name, code, description, active },
    { module: "units", saveKind: building ? "save" : "create", label: building ? `Building ${building.name}` : "New building", save: () => persist.current() },
  );

  persist.current = async () => {
    if (!name.trim()) {
      setErrors({ name: "Give the building a name." });
      return INVALID;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const body = { name, code: code || null, description: description || null };
      if (building) {
        await editor.track(() => structureApi(`/api/project-buildings/${building.id}`, { method: "PATCH", body: { ...body, isActive: active, expectedVersion: building.version } }));
        onSaved(building.id);
      } else {
        const created = await editor.track(() => structureApi<{ id: string }>(`/api/projects/${projectId}/buildings`, { body }));
        onSaved(created.id);
      }
      onDone();
      return COMMITTED;
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(failureMessage(error, "The building could not be saved."));
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
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Name" htmlFor="building-name" error={errors.name} required>
          <Input id="building-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Block A" autoFocus aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Code" htmlFor="building-code" error={errors.code}>
          <Input id="building-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={40} placeholder="A" aria-invalid={Boolean(errors.code)} />
        </Field>
      </div>
      <Field label="Description" htmlFor="building-description" error={errors.description}>
        <Textarea id="building-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} />
      </Field>
      {building ? (
        <label className="flex items-center gap-2 text-table text-fg">
          <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
          Active
        </label>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : building ? "Save building" : "Add building"}
        </Button>
      </DialogFooter>
    </form>
  );
}

const NUMBERED: FloorLevelType[] = ["BASEMENT", "GROUND", "STANDARD"];

export function FloorDialog({ open, onOpenChange, building, floor, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; building: BuildingNodeDTO; floor?: FloorNodeDTO; onSaved: (id: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{floor ? `Edit ${floor.name}` : `Add a floor to ${building.name}`}</DialogTitle>
        <DialogDescription>A floor number is unique inside its building. The same number can exist in another building.</DialogDescription>
        <FloorForm building={building} floor={floor} onSaved={onSaved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function initialFloor(building: BuildingNodeDTO, floor?: FloorNodeDTO) {
  if (floor) {
    return { levelType: floor.levelType, number: floor.number === null ? "" : String(floor.number), name: floor.name, nameTouched: true, elevation: floor.elevation ?? "", description: floor.description ?? "", active: floor.isActive };
  }
  const next = building.floors.reduce((max, candidate) => (candidate.number !== null && candidate.levelType === "STANDARD" ? Math.max(max, candidate.number) : max), 0) + 1;
  return { levelType: "STANDARD" as FloorLevelType, number: String(next), name: defaultFloorName("STANDARD", next), nameTouched: false, elevation: "", description: "", active: true };
}

function FloorForm({ building, floor, onSaved, onDone }: { building: BuildingNodeDTO; floor?: FloorNodeDTO; onSaved: (id: string) => void; onDone: () => void }) {
  const [initial] = React.useState(() => initialFloor(building, floor));
  const [levelType, setLevelType] = React.useState<FloorLevelType>(initial.levelType);
  const [number, setNumber] = React.useState(initial.number);
  const [name, setName] = React.useState(initial.name);
  const [nameTouched, setNameTouched] = React.useState(initial.nameTouched);
  const [elevation, setElevation] = React.useState(initial.elevation);
  const [description, setDescription] = React.useState(initial.description);
  const [active, setActive] = React.useState(initial.active);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const editor = useValuesEditor(
    { levelType, number, name, elevation, description, active },
    { module: "units", saveKind: floor ? "save" : "create", label: floor ? `Floor ${floor.name}` : `New floor in ${building.name}`, save: () => persist.current() },
  );

  // The name follows the level and number until somebody types their own (§12).
  function suggest(nextType: FloorLevelType, nextNumber: string) {
    if (nameTouched) return;
    const parsed = nextNumber.trim() === "" ? null : Number(nextNumber);
    setName(defaultFloorName(nextType, Number.isInteger(parsed) ? parsed : null));
  }

  persist.current = async () => {
    setPending(true);
    setErrors({});
    setFormError(null);
    const body = { levelType, number: number.trim() === "" ? null : Number(number), name, elevation: elevation || null, description: description || null };
    try {
      if (floor) {
        await editor.track(() => structureApi(`/api/project-floors/${floor.id}`, { method: "PATCH", body: { ...body, isActive: active, expectedVersion: floor.version } }));
        onSaved(floor.id);
      } else {
        const created = await editor.track(() => structureApi<{ id: string }>(`/api/project-buildings/${building.id}/floors`, { body }));
        onSaved(created.id);
      }
      onDone();
      return COMMITTED;
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(failureMessage(error, "The floor could not be saved."));
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Level" htmlFor="floor-level" error={errors.levelType} required>
          <select
            id="floor-level"
            className={selectClass}
            value={levelType}
            onChange={(event) => {
              const next = event.target.value as FloorLevelType;
              setLevelType(next);
              suggest(next, number);
            }}
          >
            {FLOOR_LEVEL_TYPES.map((type) => (
              <option key={type} value={type}>
                {FLOOR_LEVEL_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Floor number" htmlFor="floor-number" error={errors.number} required={NUMBERED.includes(levelType)} hint={levelType === "BASEMENT" ? "Below ground: -1, -2…" : NUMBERED.includes(levelType) ? undefined : "Optional for this level."}>
          <Input
            id="floor-number"
            inputMode="numeric"
            value={number}
            onChange={(event) => {
              const next = event.target.value.replace(/[^\d-]/g, "");
              setNumber(next);
              suggest(levelType, next);
            }}
            aria-invalid={Boolean(errors.number)}
          />
        </Field>
      </div>
      <Field label="Name" htmlFor="floor-name" error={errors.name} required>
        <Input
          id="floor-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameTouched(true);
          }}
          maxLength={120}
          aria-invalid={Boolean(errors.name)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Elevation (m)" htmlFor="floor-elevation" error={errors.elevation} hint="Optional, above the project datum.">
          <Input id="floor-elevation" inputMode="decimal" value={elevation} onChange={(event) => setElevation(event.target.value.replace(",", "."))} aria-invalid={Boolean(errors.elevation)} />
        </Field>
      </div>
      <Field label="Description" htmlFor="floor-description" error={errors.description}>
        <Textarea id="floor-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} />
      </Field>
      {floor ? (
        <label className="flex items-center gap-2 text-table text-fg">
          <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
          Active
        </label>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : floor ? "Save floor" : "Add floor"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** An explicit action with its consequence spelled out — never an inline edit (§53). */
export function MoveFloorDialog({ open, onOpenChange, floor, buildings, onMoved }: { open: boolean; onOpenChange: (open: boolean) => void; floor: FloorNodeDTO; buildings: BuildingNodeDTO[]; onMoved: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Move {floor.name} to another building</DialogTitle>
        <DialogDescription>
          {floor.unitCount ? `Its ${plural(floor.unitCount, "unit")} move with it.` : "It has no units."} Unit codes do not change, and every unit keeps its page and its links.
        </DialogDescription>
        <MoveFloorForm floor={floor} buildings={buildings} onMoved={onMoved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MoveFloorForm({ floor, buildings, onMoved, onDone }: { floor: FloorNodeDTO; buildings: BuildingNodeDTO[]; onMoved: () => void; onDone: () => void }) {
  const others = buildings.filter((building) => building.id !== floor.buildingId);
  const [target, setTarget] = React.useState(others[0]?.id ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const editor = useValuesEditor({ target }, { module: "units", saveKind: "none", workflow: "Move floor", label: `Moving ${floor.name}` });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    setPending(true);
    setError(null);
    try {
      await editor.track(() => structureApi(`/api/project-floors/${floor.id}/move`, { body: { buildingId: target, expectedVersion: floor.version } }));
      onMoved();
      onDone();
    } catch (failure) {
      setError(failureMessage(failure, "The floor could not be moved."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <FormError message={error} />
      {others.length ? (
        <Field label="Building" htmlFor="move-floor-building" required>
          <select id="move-floor-building" className={selectClass} value={target} onChange={(event) => setTarget(event.target.value)}>
            {others.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="text-table text-fg-muted">This project has no other building to move it to.</p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || !target}>
          {pending ? "Moving…" : "Move floor"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Another floor of the same project; the unit's id, code and page stay (§52, §119). */
export function MoveUnitDialog({ open, onOpenChange, unit, buildings, onMoved }: { open: boolean; onOpenChange: (open: boolean) => void; unit: MovableUnit; buildings: MoveTargets; onMoved: (floorId: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Move {unit.unitCode}</DialogTitle>
        <DialogDescription>The unit keeps its code, its page and everything linked to it. Change the code separately if your naming needs it.</DialogDescription>
        <MoveUnitForm unit={unit} buildings={buildings} onMoved={onMoved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type MovableUnit = { id: string; unitCode: string; version: number; floorId: string; buildingId: string };
type MoveTargets = Array<{ id: string; name: string; floors: Array<{ id: string; name: string }> }>;

function MoveUnitForm({ unit, buildings, onMoved, onDone }: { unit: MovableUnit; buildings: MoveTargets; onMoved: (floorId: string) => void; onDone: () => void }) {
  const [buildingId, setBuildingId] = React.useState(unit.buildingId);
  const [floorId, setFloorId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const floors = buildings.find((building) => building.id === buildingId)?.floors ?? [];
  const editor = useValuesEditor({ buildingId, floorId }, { module: "units", saveKind: "none", workflow: "Move unit", label: `Moving ${unit.unitCode}` });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!floorId) return setError("Choose the floor to move it to.");
    setPending(true);
    setError(null);
    try {
      await editor.track(() => structureApi(`/api/project-units/${unit.id}/move`, { body: { floorId, expectedVersion: unit.version } }));
      onMoved(floorId);
      onDone();
    } catch (failure) {
      setError(failureMessage(failure, "The unit could not be moved."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="move-unit-building" required>
          <select
            id="move-unit-building"
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
          </select>
        </Field>
        <Field label="Floor" htmlFor="move-unit-floor" required>
          <select id="move-unit-floor" className={selectClass} value={floorId} onChange={(event) => setFloorId(event.target.value)}>
            <option value="">Choose a floor</option>
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id} disabled={floor.id === unit.floorId}>
                {floor.name}
                {floor.id === unit.floorId ? " (current)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Moving…" : "Move unit"}
        </Button>
      </DialogFooter>
    </form>
  );
}
