"use client";

import { forwardRef, type Dispatch, type SetStateAction } from "react";
import type { SunTimePreset } from "@/lib/3d/runtime/sunPosition";
import type { CameraPreset, Unit } from "@/lib/3d/viewer/types";
import type { UnitFilterState } from "../../units-workspace/unitFilters";
import type { ActiveModule } from "../types";
import { NavigationContent } from "./NavigationContent";
import { TimeContent } from "./TimeContent";
import { UnitsContent } from "./UnitsContent";
import { ViewsContent } from "./ViewsContent";

type NavId = Exclude<ActiveModule, "none">;
export type DockMode = "nav" | "sunTime" | "units" | "views";

export type DockPopoverId = "timePresets" | "unitsSurface" | "unitsRooms";

export const DockContent = forwardRef<
  HTMLDivElement,
  {
    mode: DockMode;
    activeModule: ActiveModule;
    onSelectNav: (id: NavId) => void;
    isDesktop: boolean;
    interactive: boolean;
    timeHours: number;
    bounds: { startHours: number; endHours: number; stepMinutes: number };
    presets: SunTimePreset[];
    activePresetId: SunTimePreset["id"] | null;
    canReset: boolean;
    onTimeChange: (hours: number) => void;
    onPresetSelect: (preset: SunTimePreset) => void;
    onReset: () => void;
    units: Unit[];
    unitFilters: UnitFilterState;
    onUnitFiltersChange: Dispatch<SetStateAction<UnitFilterState>>;
    unitsListOpen: boolean;
    onToggleUnitsList: () => void;
    unitFiltersExpanded: boolean;
    onToggleUnitFilters: () => void;
    cameraPresets: CameraPreset[];
    activeViewPresetId: string | null;
    onSelectViewPreset: (preset: CameraPreset) => void;
    onBack: () => void;
    onClose: () => void;
    openPopover: DockPopoverId | null;
    onTogglePopover: (id: DockPopoverId) => void;
    onClosePopover: () => void;
  }
>(function DockContent(
  {
    mode,
    activeModule,
    onSelectNav,
    isDesktop,
    interactive,
    timeHours,
    bounds,
    presets,
    activePresetId,
    canReset,
    onTimeChange,
    onPresetSelect,
    onReset,
    units,
    unitFilters,
    onUnitFiltersChange,
    unitsListOpen,
    onToggleUnitsList,
    unitFiltersExpanded,
    onToggleUnitFilters,
    cameraPresets,
    activeViewPresetId,
    onSelectViewPreset,
    onBack,
    onClose,
    openPopover,
    onTogglePopover,
    onClosePopover,
  },
  ref
) {
  if (mode === "sunTime") {
    return (
      <TimeContent
        ref={ref}
        isDesktop={isDesktop}
        interactive={interactive}
        timeHours={timeHours}
        bounds={bounds}
        presets={presets}
        activePresetId={activePresetId}
        canReset={canReset}
        onTimeChange={onTimeChange}
        onPresetSelect={onPresetSelect}
        onReset={onReset}
        onBack={onBack}
        onClose={onClose}
        popoverOpen={openPopover === "timePresets"}
        onTogglePopover={() => onTogglePopover("timePresets")}
        onClosePopover={onClosePopover}
      />
    );
  }
  if (mode === "units") {
    return (
      <UnitsContent
        ref={ref}
        isDesktop={isDesktop}
        units={units}
        filters={unitFilters}
        onFiltersChange={onUnitFiltersChange}
        listOpen={unitsListOpen}
        onToggleList={onToggleUnitsList}
        filtersExpanded={unitFiltersExpanded}
        onToggleFilters={onToggleUnitFilters}
        onBack={onBack}
        onClose={onClose}
        openPopover={openPopover}
        onTogglePopover={onTogglePopover}
        onClosePopover={onClosePopover}
      />
    );
  }
  if (mode === "views") {
    return (
      <ViewsContent
        ref={ref}
        isDesktop={isDesktop}
        presets={cameraPresets}
        activePresetId={activeViewPresetId}
        onSelectPreset={onSelectViewPreset}
        onBack={onBack}
        onClose={onClose}
      />
    );
  }
  return <NavigationContent ref={ref} activeModule={activeModule} onSelect={onSelectNav} />;
});
