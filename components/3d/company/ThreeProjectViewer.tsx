"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useThreeDTranslations } from "@/components/3d/three-d-text";
import { RenderEngine } from "@/lib/3d/runtime/render-engine/RenderEngine";
import type { ThreeProjectViewerHandle, ThreeProjectViewerProps } from "./viewerTypes";

export type { ThreeProjectViewerHandle, ThreeProjectViewerProps } from "./viewerTypes";

export const ThreeProjectViewer = forwardRef<ThreeProjectViewerHandle, ThreeProjectViewerProps>(
  function ThreeProjectViewer(
    { detailModels, className, showPerfStats, onPerfStats, cameraConfig, qualityConfig, environmentConfig, lightingConfig, renderingConfig, unitsConfig, siteConfig, onUnitClick, onUnitHover, onReady, onModelLoadStatus, onSiteStatus, onRendererFacts, onContextLost },
    ref
  ) {
    const t = useThreeDTranslations();
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<RenderEngine | null>(null);
    const [webglFailed, setWebglFailed] = useState(false);
    const [contextLost, setContextLost] = useState(false);
    const readyFiredRef = useRef(false);
    const onModelLoadStatusRef = useRef(onModelLoadStatus);
    onModelLoadStatusRef.current = onModelLoadStatus;
    const onUnitClickRef = useRef(onUnitClick);
    onUnitClickRef.current = onUnitClick;
    const onUnitHoverRef = useRef(onUnitHover);
    const onSiteStatusRef = useRef(onSiteStatus);
    const onRendererFactsRef = useRef(onRendererFacts);
    const onContextLostRef = useRef(onContextLost);
    onRendererFactsRef.current = onRendererFacts;
    onContextLostRef.current = onContextLost;
    onUnitHoverRef.current = onUnitHover;
    onSiteStatusRef.current = onSiteStatus;
    const detailModelsRef = useRef(detailModels);
    detailModelsRef.current = detailModels;
    const isFirstSyncRef = useRef(true);

    useImperativeHandle(ref, () => ({
      resetView: () => engineRef.current?.resetView(),
      captureScreenshot: () => engineRef.current?.captureScreenshot() ?? Promise.resolve(null),
      computeGroundAlignOffset: (slotId: string) => engineRef.current?.computeGroundAlignOffset(slotId) ?? null,
      getCameraState: () => engineRef.current?.getCameraState() ?? null,
      flyToPreset: (preset) => engineRef.current?.flyToPreset(preset),
      showCameraHelperFor: (preset) => engineRef.current?.showCameraHelperFor(preset),
      activateSection: (section, options) => engineRef.current?.activateSection(section, options),
      getContentBounds: () => engineRef.current?.getContentBounds() ?? null,
      getEffectiveRenderScale: () => engineRef.current?.getEffectiveRenderScale() ?? 1,
      setSelectedUnit: (unitId) => engineRef.current?.setSelectedUnit(unitId),
      setUnitsMode: (enabled) => engineRef.current?.setUnitsMode(enabled),
      setUnitStatusFilters: (filters) => engineRef.current?.setUnitStatusFilters(filters),
      setUnitIdFilter: (unitIds) => engineRef.current?.setUnitIdFilter(unitIds),
      isolateUnit: (unitId) => engineRef.current?.isolateUnit(unitId),
      hoverUnit: (unitId) => engineRef.current?.hoverUnit(unitId),
      focusUnit: (unitId) => engineRef.current?.focusUnit(unitId) ?? false,
      getUnitViewportState: (unitId) => engineRef.current?.getUnitViewportState(unitId) ?? null,
      revealUnit: (unitId, screenBiasY) => engineRef.current?.revealUnit(unitId, screenBiasY) ?? false,
      revealUnits: (unitIds, screenBiasY, frameFraction) =>
        engineRef.current?.revealUnits(unitIds, screenBiasY, frameFraction) ?? false,
      revealArea: (area, screenBiasY, frameFraction) =>
        engineRef.current?.revealArea(area, screenBiasY, frameFraction) ?? false,
      resetUnitCamera: () => engineRef.current?.resetUnitCamera(),
      getUnitRegistrySnapshot: () => engineRef.current?.getUnitRegistrySnapshot() ?? [],
      resetIdleTimer: () => engineRef.current?.resetIdleTimer(),
      isIdleDroneActive: () => engineRef.current?.isIdleDroneActive() ?? false,
      setIdleDroneSuspended: (suspended) => engineRef.current?.setIdleDroneSuspended(suspended),
      previewIdleDrone: () => engineRef.current?.startIdleDronePreview(),
      stopIdleDronePreview: () => engineRef.current?.stopIdleDronePreview(),
      setShowDronePath: (enabled) => engineRef.current?.setShowDronePath(enabled),
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let cancelled = false;
      const engine = new RenderEngine({
        onModelLoadStatus: (status) => onModelLoadStatusRef.current?.(status),
        onWebglFail: () => setWebglFailed(true),
        onContextLost: () => {
          setContextLost(true);
          onContextLostRef.current?.();
        },
        onRendererFacts: (facts) => onRendererFactsRef.current?.(facts),
        onPerfStats: (stats) => onPerfStats?.(stats),
        onUnitClick: (unitId) => onUnitClickRef.current?.(unitId),
        onUnitHover: (unitId) => onUnitHoverRef.current?.(unitId),
        onSiteStatus: (status) => onSiteStatusRef.current?.(status),
      });
      engineRef.current = engine;
      void engine.mount(container, { showPerfStats }).then(() => {
        if (cancelled) return;
        void engine.syncModels(detailModelsRef.current).then(() => {
          if (readyFiredRef.current) return;
          readyFiredRef.current = true;
          onReady?.();
        });
      });
      return () => {
        cancelled = true;
        engine.dispose();
        engineRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (isFirstSyncRef.current) {
        isFirstSyncRef.current = false;
        return;
      }
      void engineRef.current?.syncModels(detailModels).then(() => {
        if (readyFiredRef.current) return;
        readyFiredRef.current = true;
        onReady?.();
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detailModels]);

    useEffect(() => {
      engineRef.current?.setPerfStatsEnabled(!!showPerfStats);
    }, [showPerfStats]);

    useEffect(() => {
      if (cameraConfig) engineRef.current?.setCameraConfig(cameraConfig);
    }, [cameraConfig]);

    useEffect(() => {
      if (qualityConfig) engineRef.current?.setQualityConfig(qualityConfig);
    }, [qualityConfig]);

    useEffect(() => {
      if (environmentConfig) engineRef.current?.setEnvironmentConfig(environmentConfig);
    }, [environmentConfig]);

    useEffect(() => {
      if (lightingConfig) engineRef.current?.setLightingConfig(lightingConfig);
    }, [lightingConfig]);

    useEffect(() => {
      if (renderingConfig) engineRef.current?.setRenderingConfig(renderingConfig);
    }, [renderingConfig]);

    useEffect(() => {
      if (unitsConfig) engineRef.current?.setUnitsConfig(unitsConfig);
    }, [unitsConfig]);

    useEffect(() => {
      if (siteConfig) engineRef.current?.setSiteConfig(siteConfig);
    }, [siteConfig]);

    return (
      <div ref={containerRef} className={className}>
        {webglFailed && (
          <div className="flex h-full w-full items-center justify-center bg-surface text-sm text-fg/60">
            {t("renderer.cannotDisplay")}
          </div>
        )}
        {contextLost && !webglFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/95 p-6 text-center text-sm text-fg/70">
            <p>{t("renderer.interrupted")}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-control border border-fg/20 px-3 py-1.5 text-xs font-medium text-fg hover:bg-fg/10"
            >
              {t("renderer.reload")}
            </button>
          </div>
        )}
      </div>
    );
  }
);

