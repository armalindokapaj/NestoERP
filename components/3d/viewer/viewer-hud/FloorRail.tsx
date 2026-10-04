"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { cn } from "@/lib/3d/viewer/utils";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { dockMagnification } from "@/lib/3d/viewer/dockMagnification";
import type { FloorRailBuilding, FloorRailEntry } from "@/lib/3d/viewer/floorRail";

const SLOT_DESKTOP = 40;
const SLOT_TOUCH = 44;

const MAX_SCALE = 1.95;
const LERP = 0.28;
const HOVER_SLOTS = 0.5;

export function FloorRail({
  buildings,
  activeSectionId,
  selectedFloorId,
  onSelectFloor,
  isTouch,
  className,
}: {
  buildings: FloorRailBuilding[];
  activeSectionId: string | null;
  selectedFloorId: string | null;
  onSelectFloor: (entry: FloorRailEntry) => void;
  isTouch: boolean;
  className?: string;
}) {
  const { t } = useT();
  const reducedMotion = useEffectiveReducedMotion();
  const slot = isTouch ? SLOT_TOUCH : SLOT_DESKTOP;

  const [pickedBuildingIndex, setPickedBuildingIndex] = useState(0);
  const [buildingMenuOpen, setBuildingMenuOpen] = useState(false);
  const buildingIndex = pickedBuildingIndex < buildings.length ? pickedBuildingIndex : 0;
  const building = buildings[buildingIndex];
  const floors = useMemo(() => building?.floors ?? [], [building]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const pointerClientYRef = useRef<number | null>(null);
  const scalesRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<(() => void) | null>(null);
  const [hovered, setHovered] = useState<{ index: number; top: number } | null>(null);

  useEffect(() => {
    rowRefs.current.length = floors.length;
    scalesRef.current.length = floors.length;
  }, [floors.length]);

  const tick = useCallback(() => {
    rafRef.current = null;
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;
    const railTop = wrapper.getBoundingClientRect().top;
    const pointerClientY = pointerClientYRef.current;

    const centres = rowRefs.current.map((el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });

    let moving = false;
    let nearest: { index: number; top: number; distance: number } | null = null;
    for (let i = 0; i < centres.length; i += 1) {
      const centre = centres[i];
      const el = rowRefs.current[i];
      if (centre == null || !el) continue;
      const distanceSlots = pointerClientY == null ? Infinity : Math.abs(pointerClientY - centre) / slot;
      const target =
        pointerClientY == null || reducedMotion ? 1 : 1 + (MAX_SCALE - 1) * dockMagnification(distanceSlots);

      const current = scalesRef.current[i] ?? 1;
      const next = current + (target - current) * LERP;
      const settled = Math.abs(next - target) < 0.002;
      scalesRef.current[i] = settled ? target : next;
      if (!settled) moving = true;

      const scale = scalesRef.current[i];
      const glyph = el.querySelector<HTMLElement>("[data-glyph]");
      if (glyph) {
        glyph.style.transform = `scale(${scale.toFixed(3)})`;
      }

      if (distanceSlots < HOVER_SLOTS && (!nearest || distanceSlots < nearest.distance)) {
        nearest = { index: i, top: centre - railTop, distance: distanceSlots };
      }
    }

    setHovered((prev) => {
      if (!nearest) return prev == null ? prev : null;
      if (prev && prev.index === nearest.index && Math.abs(prev.top - nearest.top) < 0.5) return prev;
      return { index: nearest.index, top: nearest.top };
    });
    if (moving) rafRef.current = requestAnimationFrame(() => tickRef.current?.());
  }, [reducedMotion, slot]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const schedule = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const trackPointer = useCallback(
    (clientY: number) => {
      pointerClientYRef.current = clientY;
      schedule();
    },
    [schedule]
  );

  const releasePointer = useCallback(() => {
    pointerClientYRef.current = null;
    schedule();
  }, [schedule]);

  if (!building || floors.length === 0) return null;

  const hoveredEntry = hovered ? floors[hovered.index] : null;

  return (
    <div className={cn("pointer-events-none flex flex-col items-start gap-2", className)}>
      {buildings.length > 1 && (
        <div className="pointer-events-auto relative">
          <button
            type="button"
            onClick={() => setBuildingMenuOpen((open) => !open)}
            className="viewer-glass flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[11px] font-semibold text-fg/85 transition-colors hover:text-fg"
          >
            {building.name}
            <ChevronDown className={cn("h-3 w-3 transition-transform", buildingMenuOpen && "rotate-180")} />
          </button>
          {buildingMenuOpen && (
            <div className="viewer-glass absolute left-0 top-full z-10 mt-1 min-w-[9rem] overflow-hidden rounded-card py-1">
              {buildings.map((b, i) => (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => {
                    setPickedBuildingIndex(i);
                    setBuildingMenuOpen(false);
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-[11px] font-medium transition-colors",
                    i === buildingIndex
                      ? "bg-accent/15 text-accent-strong"
                      : "text-fg/70 hover:bg-fg/5 hover:text-fg"
                  )}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={wrapperRef} className="relative">
        <div className="viewer-glass pointer-events-auto overflow-hidden rounded-panel">
          <div className="px-1.5 pb-1 pt-2 text-center text-[9px] font-semibold uppercase tracking-[0.08em] text-fg/40">
            {t("unit.floorRailHeading")}
          </div>
          <div className="mx-1.5 border-t border-fg/10" />
          <div
            ref={containerRef}
            role="group"
            aria-label={t("unit.floorRailLabel")}
            onPointerMove={(e) => {
            if (e.pointerType === "touch") return;
              trackPointer(e.clientY);
            }}
            onPointerLeave={releasePointer}
            onPointerDown={(e) => {
              if (e.pointerType !== "touch") return;
              trackPointer(e.clientY);
            }}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
            className="scroll-none max-h-[min(66vh,40rem)] overflow-y-auto px-1.5 py-1.5"
          >
            {floors.map((entry, index) => {
              const disabled = entry.sectionId == null;
              const active = entry.sectionId != null && entry.sectionId === activeSectionId;
              const selected = entry.floorId === selectedFloorId;
              return (
                <div
                  key={entry.floorId}
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  className="flex items-center"
                  style={{ height: slot }}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectFloor(entry)}
                    title={
                      disabled
                        ? t("unit.floorRailNoSection", { n: entry.floor })
                        : active
                          ? t("unit.exitFloorViewTitle", { n: entry.floor })
                          : t("unit.viewInFloorTitle", { n: entry.floor })
                    }
                    aria-label={t("unit.floorLabel", { n: entry.floor })}
                    aria-pressed={active}
                    className={cn(
                      "group flex h-full w-full items-center justify-center",
                      disabled ? "cursor-not-allowed" : "cursor-pointer"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-10 items-center justify-center rounded-control transition-colors duration-150",
                        disabled
                          ? "text-fg/25"
                          : active
                            ? "bg-accent text-accent-fg"
                            : selected
                              ? "text-accent-strong group-hover:bg-fg/5 group-hover:text-accent-strong"
                              : "text-fg/70 group-hover:bg-fg/5 group-hover:text-fg"
                      )}
                    >
                      <span
                        data-glyph
                        className="text-[15px] font-semibold leading-none tabular-nums will-change-transform"
                      >
                        {entry.floor}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {hoveredEntry && hovered && (
          <span
            className="viewer-glass pointer-events-none absolute left-full ml-3 -translate-y-1/2 whitespace-nowrap rounded-pill px-2.5 py-1 text-[11px] font-medium text-fg/90"
            style={{ top: hovered.top }}
          >
            {t("unit.floorLabel", { n: hoveredEntry.floor })}
            <span className="text-fg/50">
              {" · "}
              {hoveredEntry.sectionId == null
                ? t("unit.floorRailNoSectionShort")
                : hoveredEntry.unitCount === 1
                  ? t("unit.floorRailUnitsOne")
                  : t("unit.floorRailUnits", { count: hoveredEntry.unitCount })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
