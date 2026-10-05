"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { gsap } from "gsap";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { useEscapeKey } from "@/components/3d/viewer/hooks/useEscapeKey";
import type { SunTimePreset, SunTimeline } from "@/lib/3d/runtime/sunPosition";
import type { CameraPreset, Unit } from "@/lib/3d/viewer/types";
import type { UnitFilterState } from "../../units-workspace/unitFilters";
import { DOCK_DIMENSIONS, DOCK_MORPH_EASE, DOCK_MORPH_SHADOW, DOCK_MORPH_TIMING } from "../layoutState";
import type { ActiveModule } from "../types";
import { DockShell } from "./DockShell";
import { DockContent, type DockMode, type DockPopoverId } from "./DockContent";

type NavId = Exclude<ActiveModule, "none">;

function modeFor(activeModule: ActiveModule): DockMode {
  if (activeModule === "sunTime") return "sunTime";
  if (activeModule === "units") return "units";
  if (activeModule === "views") return "views";
  return "nav";
}

export function ProjectViewerDock({
  activeModule,
  onActiveModuleChange,
  isDesktop,
  sunTimeInteractive,
  sunTimeBounds,
  sunTimeline,
  sunTimePresets,
  activeSunPreset,
  sunTimeCanReset,
  viewerTimeHours,
  onSunTimeChange,
  onSunPresetSelect,
  onSunTimeReset,
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
}: {
  activeModule: ActiveModule;
  onActiveModuleChange: (module: ActiveModule) => void;
  isDesktop: boolean;
  sunTimeInteractive: boolean;
  sunTimeBounds?: { startHours: number; endHours: number; stepMinutes: number };
  sunTimeline?: SunTimeline;
  sunTimePresets?: SunTimePreset[];
  activeSunPreset: SunTimePreset["id"] | null;
  sunTimeCanReset: boolean;
  viewerTimeHours: number;
  onSunTimeChange: (hours: number) => void;
  onSunPresetSelect: (preset: SunTimePreset) => void;
  onSunTimeReset: () => void;
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
}) {
  const reducedMotion = useEffectiveReducedMotion();
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timelineTweenRef = useRef<gsap.core.Timeline | null>(null);
  const unlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timeDataReady = !!(sunTimeBounds && sunTimeline && sunTimePresets);
  const rawTargetMode = modeFor(activeModule);
  const targetMode: DockMode = rawTargetMode === "sunTime" && !timeDataReady ? "nav" : rawTargetMode;

  const [renderedMode, setRenderedMode] = useState<DockMode>(targetMode);
  const [, setTransitioning] = useState(false);
  const [openPopover, setOpenPopover] = useState<DockPopoverId | null>(null);

  const morphTo = useCallback(
    (nextMode: DockMode) => {
      const shell = shellRef.current;
      const content = contentRef.current;
      timelineTweenRef.current?.kill();
      if (unlockTimeoutRef.current) clearTimeout(unlockTimeoutRef.current);

      const lockSeconds = reducedMotion ? 0.1 : DOCK_MORPH_TIMING.transitionLock;
      const onStart = () => {
        setTransitioning(true);
        setOpenPopover(null);
      };
      const onComplete = () => {
        setTransitioning(false);
        unlockTimeoutRef.current = null;
        if (shell) gsap.set(shell, { clearProps: "boxShadow,y" });
      };
      unlockTimeoutRef.current = setTimeout(() => setTransitioning(false), lockSeconds * 1000);

      const targetWidth: number | "auto" | null = isDesktop
        ? nextMode === "sunTime"
          ? DOCK_DIMENSIONS.sunTime.widthDesktop
          : "auto"
        : null;

      if (!shell || !content) {
        const tl = gsap.timeline({ onStart, onComplete });
        timelineTweenRef.current = tl;
        tl.call(() => {
          setRenderedMode(nextMode);
          if (shell && targetWidth != null) gsap.set(shell, { width: targetWidth });
        });
        return;
      }

      if (reducedMotion) {
        const tl = gsap.timeline({ onStart, onComplete });
        timelineTweenRef.current = tl;
        tl.to(content, { autoAlpha: 0, duration: 0.05 })
          .call(() => {
            setRenderedMode(nextMode);
            requestAnimationFrame(() => {
              const el = shellRef.current;
              if (!el) return;
              if (typeof targetWidth === "number") gsap.set(el, { width: targetWidth });
              else if (targetWidth === "auto") gsap.set(el, { width: "auto" });
              else if (!isDesktop) gsap.set(el, { height: "auto" });
            });
          })
          .to(content, { autoAlpha: 1, duration: 0.05 });
        return;
      }

      if (!isDesktop) {
        gsap.set(shell, { height: shell.getBoundingClientRect().height });
      }

      const tl = gsap.timeline({ onStart, onComplete });
      timelineTweenRef.current = tl;

      tl.to(content, { autoAlpha: 0, y: 6, duration: DOCK_MORPH_TIMING.navCollapse, ease: "power1.in" }, 0);

      tl.call(() => setRenderedMode(nextMode), [], DOCK_MORPH_TIMING.navCollapse);

      if (typeof targetWidth === "number") {
        tl.to(
          shell,
          { width: targetWidth, duration: DOCK_MORPH_TIMING.containerMorph, ease: DOCK_MORPH_EASE },
          DOCK_MORPH_TIMING.navCollapse * 0.7
        );
      }

      tl.to(
        shell,
        { boxShadow: DOCK_MORPH_SHADOW.lifted, y: -3, duration: DOCK_MORPH_TIMING.containerMorph * 0.6, ease: "power2.out" },
        DOCK_MORPH_TIMING.navCollapse * 0.7
      ).to(shell, { boxShadow: DOCK_MORPH_SHADOW.rest, y: 0, duration: DOCK_MORPH_TIMING.containerMorph * 0.7, ease: "power2.inOut" });

      tl.call(
        () => {
          const el = contentRef.current;
          if (!el) return;
          gsap.set(el, { autoAlpha: 1 });
          gsap.fromTo(
            el.children,
            { autoAlpha: 0, y: 8 },
            {
              autoAlpha: 1,
              y: 0,
              duration: DOCK_MORPH_TIMING.contentRevealItem,
              stagger: DOCK_MORPH_TIMING.contentRevealStagger,
              ease: "power2.out",
            }
          );
          if (!isDesktop) {
            const targetHeight = el.scrollHeight;
            gsap.to(shellRef.current, {
              height: targetHeight,
              duration: DOCK_MORPH_TIMING.containerMorph,
              ease: DOCK_MORPH_EASE,
              onComplete: () => gsap.set(shellRef.current, { height: "auto" }),
            });
          }

          if (targetWidth === "auto" && shellRef.current) {
            const shellEl = shellRef.current;
            const prevWidth = shellEl.getBoundingClientRect().width;
            gsap.set(shellEl, { width: "auto" });
            const measuredWidth = shellEl.getBoundingClientRect().width;
            gsap.set(shellEl, { width: prevWidth });
            gsap.to(shellEl, {
              width: measuredWidth,
              duration: DOCK_MORPH_TIMING.containerMorph,
              ease: DOCK_MORPH_EASE,
              onComplete: () => gsap.set(shellEl, { width: "auto" }),
            });
          }
        },
        [],
        DOCK_MORPH_TIMING.navCollapse + DOCK_MORPH_TIMING.containerMorph * 0.4
      );
    },
    [isDesktop, reducedMotion]
  );

  useEffect(() => {
    if (targetMode === renderedMode) return;
    morphTo(targetMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMode]);

  useEffect(() => {
    return () => {
      timelineTweenRef.current?.kill();
      if (unlockTimeoutRef.current) clearTimeout(unlockTimeoutRef.current);
    };
  }, []);

  // A tap is never swallowed: morphTo kills the running timeline and starts from the
  // current values, so the last tap always wins.
  const guardedChange = useCallback(
    (module: ActiveModule) => {
      onActiveModuleChange(module);
    },
    [onActiveModuleChange]
  );
  const handleSelectNav = useCallback((id: NavId) => guardedChange(id), [guardedChange]);
  const handleBack = useCallback(() => guardedChange("explore"), [guardedChange]);

  const handleTogglePopover = useCallback((id: DockPopoverId) => {
    setOpenPopover((current) => (current === id ? null : id));
  }, []);
  const handleClosePopover = useCallback(() => setOpenPopover(null), []);

  useEscapeKey(
    renderedMode !== "nav" || openPopover !== null,
    useCallback(() => {
      if (openPopover !== null) {
        setOpenPopover(null);
      } else if (renderedMode !== "nav") {
        handleBack();
      }
    }, [openPopover, renderedMode, handleBack])
  );

  return (
    <DockShell ref={shellRef} className={isDesktop ? undefined : "w-full"}>
      <DockContent
        ref={contentRef}
        mode={renderedMode}
        activeModule={activeModule}
        onSelectNav={handleSelectNav}
        isDesktop={isDesktop}
        interactive={sunTimeInteractive}
        timeHours={viewerTimeHours}
        bounds={sunTimeBounds ?? { startHours: 6, endHours: 21, stepMinutes: 15 }}
        presets={sunTimePresets ?? []}
        activePresetId={activeSunPreset}
        canReset={sunTimeCanReset}
        onTimeChange={onSunTimeChange}
        onPresetSelect={onSunPresetSelect}
        onReset={onSunTimeReset}
        units={units}
        unitFilters={unitFilters}
        onUnitFiltersChange={onUnitFiltersChange}
        unitsListOpen={unitsListOpen}
        onToggleUnitsList={onToggleUnitsList}
        unitFiltersExpanded={unitFiltersExpanded}
        onToggleUnitFilters={onToggleUnitFilters}
        cameraPresets={cameraPresets}
        activeViewPresetId={activeViewPresetId}
        onSelectViewPreset={onSelectViewPreset}
        onBack={handleBack}
        onClose={handleBack}
        openPopover={openPopover}
        onTogglePopover={handleTogglePopover}
        onClosePopover={handleClosePopover}
      />
    </DockShell>
  );
}
