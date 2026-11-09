"use client";

import * as React from "react";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { floorName } from "@/lib/i18n/stock-names";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { FormSelect } from "@/components/ui/form-select";
import type { BuildingNodeDTO, FloorNodeDTO } from "@/lib/modules/project-structure/structure.types";
import { cn } from "@/lib/utils/cn";
import { Field } from "./structure-ui";

/**
 * "Add units", the Units tab's main button (2026-11-09). It first asks where:
 * the building and the floor, filled in from what the structure tree has
 * chosen. Then how many: one unit (the unit form) or several by a range of
 * codes (Bulk add). Continue hands both to the dialog that does the work; this
 * one writes nothing, so it has nothing to lose when closed.
 */

export type AddUnitsMode = "one" | "several";
export type AddUnitsChoice = { building: BuildingNodeDTO; floor: FloorNodeDTO; mode: AddUnitsMode };

/** A building's floors as the tree shows them: those with units first, the empty ones after. */
export function splitFloors(building: BuildingNodeDTO): { withUnits: FloorNodeDTO[]; empty: FloorNodeDTO[] } {
  return { withUnits: building.floors.filter((floor) => floor.unitCount > 0), empty: building.floors.filter((floor) => floor.unitCount === 0) };
}

/** Where the dialog opens: the chosen floor, else the chosen building's first floor with units (or first floor), else the first building that has floors. */
export function addUnitsTarget(buildings: BuildingNodeDTO[], selection: { buildingId: string | null; floorId: string | null }): { buildingId: string; floorId: string } | null {
  const usable = buildings.filter((building) => building.floors.length > 0);
  const building = usable.find((candidate) => candidate.id === selection.buildingId) ?? usable[0];
  if (!building) return null;
  const chosen = building.floors.find((floor) => floor.id === selection.floorId);
  const floor = chosen ?? building.floors.find((candidate) => candidate.unitCount > 0) ?? building.floors[0]!;
  return { buildingId: building.id, floorId: floor.id };
}

export function AddUnitsDialog({
  open,
  onOpenChange,
  buildings,
  selection,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildings: BuildingNodeDTO[];
  selection: { buildingId: string | null; floorId: string | null };
  onChoose: (choice: AddUnitsChoice) => void;
}) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const usable = buildings.filter((building) => building.floors.length > 0);
  const start = addUnitsTarget(buildings, selection);
  const [buildingId, setBuildingId] = React.useState(start?.buildingId ?? "");
  const [floorId, setFloorId] = React.useState(start?.floorId ?? "");
  const [mode, setMode] = React.useState<AddUnitsMode>("one");
  const building = usable.find((candidate) => candidate.id === buildingId) ?? null;
  const floor = building?.floors.find((candidate) => candidate.id === floorId) ?? null;
  const { withUnits, empty } = building ? splitFloors(building) : { withUnits: [], empty: [] };

  function chooseBuilding(id: string) {
    setBuildingId(id);
    const next = addUnitsTarget(buildings, { buildingId: id, floorId: null });
    setFloorId(next?.buildingId === id ? next.floorId : "");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!building || !floor) return;
    onChoose({ building, floor, mode });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-units-dialog">
        <DialogTitle>{t("addUnits.title")}</DialogTitle>
        <DialogDescription>{t("addUnits.body")}</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("addUnits.building")} htmlFor="add-units-building" required>
              <FormSelect id="add-units-building" className={selectClass} value={buildingId} onChange={(event) => chooseBuilding(event.target.value)}>
                {usable.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.code ? `${candidate.name} (${candidate.code})` : candidate.name}
                  </option>
                ))}
              </FormSelect>
            </Field>
            <Field label={t("addUnits.floor")} htmlFor="add-units-floor" required>
              <FormSelect id="add-units-floor" className={selectClass} value={floorId} onChange={(event) => setFloorId(event.target.value)}>
                {withUnits.map((level) => (
                  <option key={level.id} value={level.id}>
                    {floorName(level.name, locale)} · {t("counts.units", { count: level.unitCount })}
                  </option>
                ))}
                {empty.length ? (
                  <optgroup label={t("workspace.emptyFloorsGroup")}>
                    {empty.map((level) => (
                      <option key={level.id} value={level.id}>
                        {floorName(level.name, locale)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </FormSelect>
            </Field>
          </div>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 text-meta font-semibold text-fg">{t("addUnits.howMany")}</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {(["one", "several"] as const).map((value) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2.5 text-table transition-colors touch:min-h-11",
                    mode === value ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  )}
                >
                  <input type="radio" name="add-units-mode" value={value} className="sr-only" checked={mode === value} onChange={() => setMode(value)} data-testid={`add-units-${value}`} />
                  <span className="font-medium text-fg">{value === "one" ? t("addUnits.one") : t("addUnits.several")}</span>
                  <span className="text-meta text-fg-muted">{value === "one" ? t("addUnits.oneHint") : t("addUnits.severalHint")}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("addUnits.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!floor} data-testid="add-units-continue">
              {t("addUnits.continue")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
