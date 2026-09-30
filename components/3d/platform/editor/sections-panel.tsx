"use client";

import * as React from "react";
import { Copy, Plus, Scissors, Trash2 } from "lucide-react";

import type { ThreeProjectViewerHandle } from "@/components/3d/company/viewerTypes";
import { SECTION_FOOTPRINT_MAX_M, SECTION_HEIGHT_STOPS_M, SECTION_MAX_DIMENSION_M } from "@/lib/3d/runtime/render-engine/sections";
import { SECTION_SITE_EXEMPT_HINT } from "@/lib/3d/runtime/render-engine/sectionScope";
import type { Project3DConfig, Section } from "@/lib/3d/runtime/types";
import { parseSectionFloorNumber } from "@/lib/3d/viewer/floorSections";
import { cn } from "@/lib/utils/cn";
import { ColorRow, GroupCard, SectionHeading, SliderRow, ToggleRow } from "./rozaris-fields";

/*
 * The Sections tool, ported as it is in the Rozaris Web3D Experience Editor
 * (panels/SectionsPanel.tsx): Floor Sections / Manual Clipping, saved section
 * presets with duplicate and delete, and the active section's height, footprint
 * and cap. It edits the same draft, so Save, Reset and the conflict checks cover it.
 */

const DEFAULT_FILL_COLOR = "#f2f2f2";

type Props = {
  draft: Project3DConfig;
  change: (patch: Partial<Project3DConfig>) => void;
  viewerRef: React.RefObject<ThreeProjectViewerHandle | null>;
  canEdit: boolean;
};

export function SectionsPanel({ draft, change, viewerRef, canEdit }: Props) {
  const [mode, setMode] = React.useState<"floor" | "manual">("manual");
  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(null);
  const sections = draft.sections;
  const active = sections.find((s) => s.id === activeSectionId) ?? null;

  // Leaving the tool clears the cut, so the other tools see the whole model.
  React.useEffect(() => () => viewerRef.current?.activateSection(null), [viewerRef]);

  function activate(id: string | null) {
    setActiveSectionId(id);
    const section = sections.find((s) => s.id === id) ?? null;
    viewerRef.current?.activateSection(section, { showIndicator: true });
  }

  function create() {
    const bounds = viewerRef.current?.getContentBounds() ?? null;
    const midHeight = bounds ? (bounds.minY + bounds.maxY) / 2 : 3;
    const section: Section = {
      id: `section-${Date.now()}`,
      name: mode === "floor" ? `Floor Section ${sections.length + 1}` : `Section ${sections.length + 1}`,
      scope: "project",
      centerX: bounds?.centerX ?? 0,
      centerZ: bounds?.centerZ ?? 0,
      widthM: bounds ? Math.max(5, bounds.sizeX * 0.6) : 20,
      depthM: bounds ? Math.max(5, bounds.sizeZ * 0.6) : 20,
      heightOnly: mode === "floor",
      rotationDeg: 0,
      heightM: midHeight,
      bottomEnabled: false,
      fillGapsEnabled: false,
      fillColor: DEFAULT_FILL_COLOR,
    };
    change({ sections: [...sections, section] });
    setActiveSectionId(section.id);
    viewerRef.current?.activateSection(section, { showIndicator: true });
  }

  function duplicate(id: string) {
    const source = sections.find((s) => s.id === id);
    if (!source) return;
    change({ sections: [...sections, { ...source, id: `section-${Date.now()}`, name: `${source.name} copy` }] });
  }

  function remove(id: string) {
    if (id === activeSectionId) activate(null);
    change({ sections: sections.filter((s) => s.id !== id) });
  }

  function set(patch: Partial<Section>) {
    if (!active) return;
    change({ sections: sections.map((s) => (s.id === active.id ? { ...s, ...patch } : s)) });
    viewerRef.current?.activateSection({ ...active, ...patch }, { showIndicator: true });
  }

  return (
    <div className="space-y-3">
      <SectionHeading>Sections</SectionHeading>
      <div className="flex gap-1 rounded-md bg-neutral-900 p-0.5">
        <button type="button" onClick={() => setMode("floor")} className={cn("flex-1 rounded px-2 py-1 text-[11px] font-semibold", mode === "floor" ? "bg-neutral-700 text-white" : "text-neutral-400")}>
          Floor Sections
        </button>
        <button type="button" onClick={() => setMode("manual")} className={cn("flex-1 rounded px-2 py-1 text-[11px] font-semibold", mode === "manual" ? "bg-neutral-700 text-white" : "text-neutral-400")}>
          Manual Clipping
        </button>
      </div>
      <button
        type="button"
        onClick={create}
        disabled={!canEdit}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" /> New {mode === "floor" ? "Floor Section" : "Section"}
      </button>

      {mode === "floor" && (
        <p className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 text-[10px] leading-relaxed text-neutral-400">
          Name a section after its floor — <span className="text-neutral-200">Floor 7</span> or <span className="text-neutral-200">Kati 7</span> — and every unit on floor 7 gets a
          &ldquo;View in Floor&rdquo; button in the public viewer that activates it. The default &ldquo;Floor Section 1&rdquo; name does <span className="text-neutral-200">not</span> link (its number is a counter, not a storey).
        </p>
      )}

      <p className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 text-[10px] leading-relaxed text-neutral-400">{SECTION_SITE_EXEMPT_HINT}</p>

      <SectionHeading>Presets</SectionHeading>
      {sections.length === 0 && <p className="p-2 text-center text-xs text-neutral-600">No sections saved yet.</p>}
      <div className="space-y-1">
        {sections.map((s) => {
          const floor = parseSectionFloorNumber(s.name);
          return (
            <div key={s.id} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1.5", s.id === activeSectionId ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-800")}>
              <button type="button" onClick={() => activate(s.id === activeSectionId ? null : s.id)} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                <span className="flex w-full min-w-0 items-center gap-1.5 text-xs font-semibold text-neutral-200">
                  <Scissors className="h-3 w-3 shrink-0 text-neutral-500" />
                  <span className="truncate">{s.name}</span>
                  {s.heightOnly && <span className="shrink-0 rounded bg-neutral-800 px-1 text-[9px] text-neutral-400">FLOOR</span>}
                </span>
                {floor !== null && <span className="pl-[18px] text-[10px] font-medium text-indigo-300">Linked to units on floor {floor}</span>}
              </button>
              <button type="button" onClick={() => duplicate(s.id)} disabled={!canEdit} title="Duplicate" className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-40">
                <Copy className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => remove(s.id)} disabled={!canEdit} title="Delete" className="shrink-0 rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-40">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {active && (
        <div className="space-y-3">
          <div className="h-px bg-neutral-800" />
          <input
            value={active.name}
            disabled={!canEdit}
            aria-label="Section name"
            onChange={(e) => set({ name: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
          />
          <GroupCard>
            <ToggleRow label="Height Only" checked={!!active.heightOnly} disabled={!canEdit} onChange={(v) => set({ heightOnly: v })} />
            <ToggleRow label="Bottom Plane" checked={active.bottomEnabled} disabled={!canEdit} onChange={(v) => set({ bottomEnabled: v })} />
          </GroupCard>

          <SliderRow label="Height (Slab)" value={active.heightM} stops={SECTION_HEIGHT_STOPS_M} step={0.1} suffix="m" editable disabled={!canEdit} onChange={(v) => set({ heightM: v })} />

          {!active.heightOnly && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Footprint</p>
              <SliderRow label="Center X" value={active.centerX} min={-SECTION_MAX_DIMENSION_M / 2} max={SECTION_MAX_DIMENSION_M / 2} step={0.5} suffix="m" editable disabled={!canEdit} onChange={(v) => set({ centerX: v })} />
              <SliderRow label="Center Z" value={active.centerZ} min={-SECTION_MAX_DIMENSION_M / 2} max={SECTION_MAX_DIMENSION_M / 2} step={0.5} suffix="m" editable disabled={!canEdit} onChange={(v) => set({ centerZ: v })} />
              <SliderRow label="Width" value={active.widthM} min={0} max={SECTION_FOOTPRINT_MAX_M} step={0.5} suffix="m" editable disabled={!canEdit} onChange={(v) => set({ widthM: v })} />
              <SliderRow label="Depth" value={active.depthM} min={0} max={SECTION_FOOTPRINT_MAX_M} step={0.5} suffix="m" editable disabled={!canEdit} onChange={(v) => set({ depthM: v })} />
              <SliderRow label="Rotation" value={active.rotationDeg} min={-180} max={180} step={1} suffix="°" editable disabled={!canEdit} onChange={(v) => set({ rotationDeg: v })} />
            </>
          )}

          <SectionHeading>Cap</SectionHeading>
          <GroupCard>
            <ToggleRow label="Fill Gaps" checked={active.fillGapsEnabled} disabled={!canEdit} onChange={(v) => set({ fillGapsEnabled: v })} />
            <ColorRow label="Fill Color" value={active.fillColor} disabled={!canEdit || !active.fillGapsEnabled} onChange={(v) => set({ fillColor: v })} />
          </GroupCard>
        </div>
      )}
    </div>
  );
}
