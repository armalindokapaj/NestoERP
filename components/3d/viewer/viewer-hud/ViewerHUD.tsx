"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { gsap } from "gsap";
import { useIsDesktop } from "@/components/3d/viewer/hooks/useMediaQuery";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/3d/viewer/utils";
import { NorthCompass } from "./NorthCompass";
import { ProjectIdentity } from "./ProjectIdentity";
import { ViewerUtilities } from "./ViewerUtilities";
import { FirstVisitHint } from "./FirstVisitHint";
import { ProjectViewerDock } from "./dock/ProjectViewerDock";
import { getViewerLayoutState } from "./layoutState";
import type { ActiveModule } from "./types";
import type { ThreeProjectViewerHandle } from "@/components/3d/company/viewerTypes";
import type { SunTimePreset, SunTimeline } from "@/lib/3d/runtime/sunPosition";
import { DEFAULT_UNIT_FILTERS, type UnitFilterState } from "../units-workspace/unitFilters";
import type { CameraPreset, Unit } from "@/lib/3d/viewer/types";
import type { MoreMenuProjectInfo } from "./MoreMenu";

export function ViewerHUD({
  viewerRef,
  sceneReady,
  activeModule,
  onActiveModuleChange,
  chromeDimmed,
  project,
  fullscreen,
  onToggleFullscreen,
  onScreenshot,
  screenshotEnabled,
  fullscreenEnabled,
  northOffsetDeg,
  viewerTimeHours,
  sunTimeInteractive,
  sunTimeBounds,
  sunTimeline,
  sunTimePresets,
  activeSunPreset,
  sunTimeCanReset,
  onSunTimeChange,
  onSunPresetSelect,
  onSunTimeReset,
  cameraPresets,
  activeViewPresetId,
  onSelectViewPreset,
  units,
  unitFilters,
  onUnitFiltersChange,
  unitsListOpen,
  onToggleUnitsList,
  unitFiltersExpanded,
  onToggleUnitFilters,
}: {
  viewerRef: React.RefObject<ThreeProjectViewerHandle | null>;
  sceneReady: boolean;
  activeModule: ActiveModule;
  onActiveModuleChange: (module: ActiveModule) => void;
  chromeDimmed: boolean;
  project: MoreMenuProjectInfo;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onScreenshot: () => void;
  screenshotEnabled: boolean;
  fullscreenEnabled: boolean;
  northOffsetDeg?: number;
  viewerTimeHours?: number;
  sunTimeInteractive?: boolean;
  sunTimeBounds?: { startHours: number; endHours: number; stepMinutes: number };
  sunTimeline?: SunTimeline;
  sunTimePresets?: SunTimePreset[];
  activeSunPreset?: SunTimePreset["id"] | null;
  sunTimeCanReset?: boolean;
  onSunTimeChange?: (hours: number) => void;
  onSunPresetSelect?: (preset: SunTimePreset) => void;
  onSunTimeReset?: () => void;
  cameraPresets?: CameraPreset[];
  activeViewPresetId?: string | null;
  onSelectViewPreset?: (preset: CameraPreset) => void;
  units?: Unit[];
  unitFilters?: UnitFilterState;
  onUnitFiltersChange?: Dispatch<SetStateAction<UnitFilterState>>;
  unitsListOpen?: boolean;
  onToggleUnitsList?: () => void;
  unitFiltersExpanded?: boolean;
  onToggleUnitFilters?: () => void;
}) {
  const reducedMotion = useEffectiveReducedMotion();
  const isDesktop = useIsDesktop();
  const [loadSequenceDone, setLoadSequenceDone] = useState(false);
  const { leftPanelOpen } = getViewerLayoutState(activeModule, isDesktop, !!unitsListOpen);

  const overlayRef = useRef<HTMLDivElement>(null);
  const identityRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const utilitiesRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sceneReady) return;
    const d = (seconds: number) => (reducedMotion ? 0.001 : seconds);
    const tl = gsap.timeline({
      onComplete: () => setLoadSequenceDone(true),
    });
    tl.to(overlayRef.current, { autoAlpha: 0, duration: d(0.5), ease: "power1.out" })
      .fromTo(
        identityRef.current,
        { autoAlpha: 0, y: -6 },
        { autoAlpha: 1, y: 0, duration: d(0.4), ease: "power1.out" }
      )
      .fromTo(
        [compassRef.current, utilitiesRef.current],
        { autoAlpha: 0, y: -6 },
        { autoAlpha: 1, y: 0, duration: d(0.35), ease: "power1.out", stagger: d(0.05) }
      )
      .fromTo(
        navRef.current,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: d(0.4), ease: "power1.out" }
      );
    return () => {
      tl.kill();
    };
  }, [sceneReady, reducedMotion]);

  useEffect(() => {
    if (!loadSequenceDone) return;
    const el = navRef.current;
    if (!el) return;
    const tween = gsap.to(el, {
      scaleX: leftPanelOpen ? 0 : 1,
      autoAlpha: leftPanelOpen ? 0 : 1,
      transformOrigin: "50% 50%",
      duration: reducedMotion ? 0.001 : 0.25,
      delay: leftPanelOpen || reducedMotion ? 0 : 0.4,
      ease: leftPanelOpen ? "power2.in" : "power2.out",
    });
    return () => {
      tween.kill();
    };
  }, [leftPanelOpen, loadSequenceDone, reducedMotion]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div
        ref={overlayRef}
        className={
          "absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-surface " +
          (sceneReady ? "pointer-events-none" : "pointer-events-auto")
        }
      >
        <span className="font-serif text-lg tracking-[0.3em] text-fg">NESTO</span>
        <div className="viewer-loading-bar h-[2px] w-32 rounded-full" />
      </div>

      <header
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] transition-opacity duration-700 sm:p-4",
          chromeDimmed && "opacity-40"
        )}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <div ref={identityRef} className="pointer-events-auto min-w-0 opacity-0">
            <ProjectIdentity projectName={project.name} developerName={project.developerName} city={project.city} backHref={project.backHref} />
          </div>
          {isDesktop && (
            <div ref={compassRef} className="pointer-events-auto shrink-0 opacity-0">
              <NorthCompass viewerRef={viewerRef} northOffsetDeg={northOffsetDeg} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isDesktop && (
            <div ref={compassRef} className="pointer-events-auto shrink-0 opacity-0">
              <NorthCompass viewerRef={viewerRef} northOffsetDeg={northOffsetDeg} />
            </div>
          )}
          <div ref={utilitiesRef} className="pointer-events-auto shrink-0 opacity-0">
            <ViewerUtilities
              screenshotEnabled={screenshotEnabled}
              fullscreenEnabled={fullscreenEnabled}
              fullscreen={fullscreen}
              onToggleFullscreen={onToggleFullscreen}
              onScreenshot={onScreenshot}
              project={project}
            />
          </div>
        </div>
      </header>

      <FirstVisitHint ready={loadSequenceDone} />

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex justify-center pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] transition-opacity duration-700 sm:bottom-4 lg:px-0",
          chromeDimmed && "opacity-40"
        )}
      >
        <div ref={navRef} className="pointer-events-auto relative w-full opacity-0 lg:w-fit">
          <ProjectViewerDock
            activeModule={activeModule}
            onActiveModuleChange={onActiveModuleChange}
            isDesktop={isDesktop}
            sunTimeInteractive={!!sunTimeInteractive}
            sunTimeBounds={sunTimeBounds}
            sunTimeline={sunTimeline}
            sunTimePresets={sunTimePresets}
            activeSunPreset={activeSunPreset ?? null}
            sunTimeCanReset={!!sunTimeCanReset}
            viewerTimeHours={viewerTimeHours ?? 12}
            onSunTimeChange={(h) => onSunTimeChange?.(h)}
            onSunPresetSelect={(p) => onSunPresetSelect?.(p)}
            onSunTimeReset={() => onSunTimeReset?.()}
            units={units ?? []}
            unitFilters={unitFilters ?? DEFAULT_UNIT_FILTERS}
            onUnitFiltersChange={onUnitFiltersChange ?? (() => {})}
            unitsListOpen={!!unitsListOpen}
            onToggleUnitsList={() => onToggleUnitsList?.()}
            unitFiltersExpanded={unitFiltersExpanded !== false}
            onToggleUnitFilters={() => onToggleUnitFilters?.()}
            cameraPresets={cameraPresets ?? []}
            activeViewPresetId={activeViewPresetId ?? null}
            onSelectViewPreset={(p) => onSelectViewPreset?.(p)}
          />
        </div>
      </div>
    </div>
  );
}
