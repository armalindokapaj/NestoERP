"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SquareStack } from "lucide-react";
import { useViewerStore } from "@/lib/3d/viewer/store";
import { useIsDesktop } from "@/components/3d/viewer/hooks/useMediaQuery";
import { useIdleFade } from "@/components/3d/viewer/hooks/useIdleFade";
import { useViewerPreferences } from "@/components/3d/viewer/hooks/useViewerPreferences";
import { use3DAssetCache } from "@/components/3d/viewer/hooks/use3DAssetCache";
import { useT } from "@/lib/3d/viewer/i18n";
import { ThreeProjectViewer, type ThreeProjectViewerHandle } from "@/components/3d/company/ThreeProjectViewer";
import { ViewerDiagnostics } from "@/components/3d/viewer/ViewerDiagnostics";
import type { ModelLoadStatus, RendererFacts } from "@/lib/3d/runtime/render-engine/RenderEngine";
import { ViewerHUD } from "@/components/3d/viewer/viewer-hud/ViewerHUD";
import { getViewerLayoutState } from "@/components/3d/viewer/viewer-hud/layoutState";
import type { ActiveModule } from "@/components/3d/viewer/viewer-hud/types";
import { UnitsWorkspace } from "@/components/3d/viewer/units-workspace/UnitsWorkspace";
import { MobileUnitsSheet } from "@/components/3d/viewer/units-workspace/MobileUnitsSheet";
import {
  activeFilterCount,
  DEFAULT_UNIT_FILTERS,
  filterUnits,
  type UnitFilterState,
} from "@/components/3d/viewer/units-workspace/unitFilters";
import { computeSunTimeline, geographicSunPosition, snapSunTimeHours, snapSunTimePresets, sunPositionForAnchors, sunTimelinePresets, type SunTimePreset, type SunTimeWindow } from "@/lib/3d/runtime/sunPosition";
import { parseSectionFloorNumber, resolveFloorSection } from "@/lib/3d/viewer/floorSections";
import { buildFloorRail, type FloorRailEntry } from "@/lib/3d/viewer/floorRail";
import { makeFloorId } from "@/lib/3d/viewer/units";
import { FloorRail } from "@/components/3d/viewer/viewer-hud/FloorRail";
import type { CameraPreset, Section } from "@/lib/3d/viewer/types";
import { ConstructionTimelineStrip } from "@/components/3d/viewer/ConstructionTimelineStrip";
import { UnitDiscoveryPanel } from "@/components/3d/viewer/UnitDiscoveryPanel";
import { UnitPreviewCard } from "@/components/3d/viewer/UnitPreviewCard";
import { CompareOverlay } from "@/components/3d/viewer/compare/CompareOverlay";
import { CompareReplaceModal } from "@/components/3d/viewer/compare/CompareReplaceModal";
import type { ProjectViewerRuntimeBootstrap, ViewerChannel } from "@/lib/3d/viewer/runtimeTypes";
import { applyViewerQuality, applyViewerQualityToLighting, applyViewerQualityToRendering } from "@/lib/3d/viewer/viewerQuality";
import { applyEffectOverridesToLighting, applyEffectOverridesToRendering, parseEffectOverrides } from "@/lib/3d/viewer/viewerEffectOverrides";

const MIN_ONSCREEN_UNIT_COVERAGE = 0.1;

const MOBILE_REVEAL_SCREEN_BIAS = 0.45;

const MIN_SUN_TIME_WINDOW_HOURS = 1;

export function ProjectViewerRuntime({
  bootstrap,
  channel,
  brand,
  onModelLoadStatus,
}: {
  bootstrap: ProjectViewerRuntimeBootstrap;
  channel: ViewerChannel;
  /** The owner's mark, drawn on the loading overlay. */
  brand?: { name: string; logoUrl: string | null };
  /** NESTO: model files arrive on signed URLs, so the page offers a retry when one fails. */
  onModelLoadStatus?: (status: ModelLoadStatus) => void;
}) {
  const { project, construction, detailModels, viewerConfig, units } = bootstrap;

  use3DAssetCache(channel === "public" ? `/view/3d/${project.id}` : `/projects/${project.id}/3d`);

  const mainRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ThreeProjectViewerHandle>(null);

  const diagOpen = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("diag") === "1",
    () => false
  );
  const effectOverridesParam = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("fx") ?? "",
    () => ""
  );
  const effectOverrides = useMemo(
    () => parseEffectOverrides(effectOverridesParam ? `?fx=${effectOverridesParam}` : ""),
    [effectOverridesParam]
  );
  const [rendererFacts, setRendererFacts] = useState<RendererFacts | null>(null);
  const [siteStatus, setSiteStatus] = useState<string>("—");
  const [diagStats, setDiagStats] = useState<Parameters<NonNullable<Parameters<typeof ThreeProjectViewer>[0]["onPerfStats"]>>[0]>(null);
  const [unitPanelOpen, setUnitPanelOpen] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unmappedUnitId, setUnmappedUnitId] = useState<string | null>(null);
  const [fullDetailOpen, setFullDetailOpen] = useState(false);
  const resetDetailOnDismiss = useCallback((unitId: string | null) => {
    if (!unitId) setFullDetailOpen(false);
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [screenshotFlash, setScreenshotFlash] = useState<"success" | "error" | null>(null);
  const [fullscreenUnsupported, setFullscreenUnsupported] = useState(false);
  const [activeModule, setActiveModule] = useState<ActiveModule>("explore");
  const [unitsListOpen, setUnitsListOpen] = useState(false);
  const [unitFiltersExpanded, setUnitFiltersExpanded] = useState(true);
  const handleToggleUnitFilters = useCallback(() => setUnitFiltersExpanded((prev) => !prev), []);
  const handleOpenUnitFilters = useCallback(() => setUnitFiltersExpanded(true), []);
  useEffect(() => {
    viewerRef.current?.setIdleDroneSuspended(activeModule !== "explore");
    if (activeModule === "explore") viewerRef.current?.resetIdleTimer();
  }, [activeModule]);

  const handleToggleUnitsList = useCallback(() => {
    setUnitsListOpen((prev) => {
      if (!prev) setUnitFiltersExpanded(false);
      return !prev;
    });
  }, []);
  const handleCloseUnitsList = useCallback(() => setUnitsListOpen(false), []);
  const [unitFilters, setUnitFilters] = useState<UnitFilterState>(DEFAULT_UNIT_FILTERS);
  const isDesktop = useIsDesktop();
  const handleScenePointerDown = useCallback(() => {
    if (isDesktop) return;
    setUnitFiltersExpanded((prev) => (prev ? false : prev));
  }, [isDesktop]);
  const { leftPanelOpen, unitsSheetOpen } = getViewerLayoutState(activeModule, isDesktop, unitsListOpen);
  const idle = useIdleFade(60000);
  const { interfaceAutoHide, quality: viewerQuality } = useViewerPreferences();
  const chromeDimmed = interfaceAutoHide && idle && activeModule === "explore";
  const compareCount = useViewerStore((s) => s.compare.length);
  const setCompareOverlayOpen = useViewerStore((s) => s.setCompareOverlayOpen);
  const selectedUnit = useMemo(() => units.find((u) => u.id === selectedUnitId) ?? null, [units, selectedUnitId]);
  const unitListSurfaceOpen = leftPanelOpen || unitsSheetOpen;
  const unitCardOpen = !!selectedUnit && viewerConfig.viewerUI.showUnitInfo !== false && !unitListSurfaceOpen;

  const floorSectionsAvailable =
    viewerConfig.viewerUI.sectionsEnabled !== false && viewerConfig.sections.length > 0;
  const floorSectionForSelectedUnit = useMemo(
    () =>
      floorSectionsAvailable && selectedUnit
        ? resolveFloorSection(viewerConfig.sections, selectedUnit)
        : null,
    [floorSectionsAvailable, viewerConfig.sections, selectedUnit]
  );
  const resolveSectionForUnitId = useCallback(
    (unitId: string | null) => {
      if (!unitId || !floorSectionsAvailable) return null;
      const unit = units.find((u) => u.id === unitId) ?? null;
      return unit ? resolveFloorSection(viewerConfig.sections, unit) : null;
    },
    [units, floorSectionsAvailable, viewerConfig.sections]
  );
  const [activeFloorSectionId, setActiveFloorSectionId] = useState<string | null>(null);
  const activeFloorSection = useMemo(
    () => viewerConfig.sections.find((sec) => sec.id === activeFloorSectionId) ?? null,
    [viewerConfig.sections, activeFloorSectionId]
  );
  const floorExitOpen = !!activeFloorSectionId && !unitCardOpen;

  const applyFloorSection = useCallback(
    (section: Section | null, options?: { frameUnitIds?: string[] }) => {
      viewerRef.current?.activateSection(section, { showIndicator: false });
      setActiveFloorSectionId(section?.id ?? null);
      if (section?.cameraPreset) {
        viewerRef.current?.flyToPreset({
          id: section.id,
          label: section.name,
          durationMs: 900,
          ...section.cameraPreset,
        });
      } else if (section && options?.frameUnitIds?.length) {
        const framed = viewerRef.current?.revealUnits(
          options.frameUnitIds,
          isDesktop ? 0 : MOBILE_REVEAL_SCREEN_BIAS
        );
        if (!framed) {
          viewerRef.current?.revealArea(
            {
              centerX: section.centerX,
              centerZ: section.centerZ,
              y: section.heightM,
              radius: Math.max(section.widthM, section.depthM) / 2,
            },
            isDesktop ? 0 : MOBILE_REVEAL_SCREEN_BIAS
          );
        }
      }
      viewerRef.current?.resetIdleTimer();
    },
    [isDesktop]
  );

  const handleToggleFloorSection = useCallback(() => {
    const section = floorSectionForSelectedUnit;
    if (!section) return;
    applyFloorSection(section.id === activeFloorSectionId ? null : section);
  }, [floorSectionForSelectedUnit, activeFloorSectionId, applyFloorSection]);

  const handleExitFloorFromPill = useCallback(() => applyFloorSection(null), [applyFloorSection]);

  const cardUnit = unitCardOpen ? selectedUnit : null;

  const floorRailBuildings = useMemo(
    () => buildFloorRail(units, viewerConfig.sections),
    [units, viewerConfig.sections]
  );
  const selectedFloorId = useMemo(
    () => (selectedUnit ? makeFloorId(selectedUnit.buildingName, selectedUnit.floor) : null),
    [selectedUnit]
  );

  const handleSelectFloor = useCallback(
    (entry: FloorRailEntry) => {
      if (!entry.sectionId) return;
      if (entry.sectionId === activeFloorSectionId) {
        applyFloorSection(null);
        return;
      }
      const section = viewerConfig.sections.find((s) => s.id === entry.sectionId) ?? null;
      if (!section) return;
      applyFloorSection(section, { frameUnitIds: entry.unitIds });
    },
    [activeFloorSectionId, applyFloorSection, viewerConfig.sections]
  );

  const followFloorCutToUnit = useCallback(
    (unitId: string | null) => {
      if (!activeFloorSectionId || !unitId) return false;
      const section = resolveSectionForUnitId(unitId);
      if (!section || section.id === activeFloorSectionId) return false;
      applyFloorSection(section);
      return true;
    },
    [activeFloorSectionId, resolveSectionForUnitId, applyFloorSection]
  );

  const dropFloorCutIfUncontrolled = useCallback(
    (nextModule: ActiveModule, nextUnitId: string | null) => {
      if (!activeFloorSectionId) return;
      const cardWillBeOpen =
        !!nextUnitId && viewerConfig.viewerUI.showUnitInfo !== false && !unitListSurfaceOpen;
      if (!cardWillBeOpen) return;
      if (nextModule === "units") return;
      const cardSection = resolveSectionForUnitId(nextUnitId);
      if (cardSection?.id === activeFloorSectionId) return;
      applyFloorSection(null);
    },
    [
      activeFloorSectionId,
      unitListSurfaceOpen,
      resolveSectionForUnitId,
      viewerConfig.viewerUI.showUnitInfo,
      applyFloorSection,
    ]
  );

  const handleActiveModuleChange = useCallback(
    (module: ActiveModule) => {
      // The tab press paints first; the viewer-wide re-render it causes is interruptible.
      startTransition(() => {
        dropFloorCutIfUncontrolled(module, selectedUnitId);
        setActiveModule(module);
        setUnitsListOpen((prev) => (module === "units" ? prev : false));
        setUnitFiltersExpanded(true);
      });
    },
    [dropFloorCutIfUncontrolled, selectedUnitId]
  );
  const detailModelEntries = useMemo(
    () => detailModels.map((entry) => ({ ...entry, units, statusPreviewEnabled: true })),
    [detailModels, units]
  );

  const moreMenuProject = useMemo(
    () => ({
      slug: project.slug,
      name: project.name,
      developerName: project.developer.name,
      developerVerified: project.developer.verified,
      city: project.city,
      propertyType: project.propertyType,
      completionLabel: project.completionLabel,
      backHref: project.backHref,
    }),
    [project]
  );
  const { t } = useT();

  const exitFloorNumber = activeFloorSection ? parseSectionFloorNumber(activeFloorSection.name) : null;
  const exitFloorLabel = activeFloorSection
    ? exitFloorNumber == null
      ? activeFloorSection.name
      : t("unit.floorLabel", { n: exitFloorNumber })
    : null;
  const exitFloorTitle = activeFloorSection
    ? exitFloorNumber == null
      ? t("unit.exitFloorView")
      : t("unit.exitFloorViewTitle", { n: exitFloorNumber })
    : null;

  const [liveSunTimeHours, setLiveSunTimeHours] = useState<number | null>(null);
  const [liveSunDate, setLiveSunDate] = useState<string | null>(null);
  const [activeSunPreset, setActiveSunPreset] = useState<SunTimePreset["id"] | null>(null);
  const effectiveSunDate = liveSunDate ?? viewerConfig.simulationDate;
  const sunTimeInteractive = viewerConfig.solarControllerEnabled && viewerConfig.viewerTimeControlEnabled;

  const sunTimeWindow = useMemo<SunTimeWindow>(() => {
    const lo = Math.min(viewerConfig.viewerTimeStartHours, viewerConfig.viewerTimeEndHours);
    const hi = Math.max(viewerConfig.viewerTimeStartHours, viewerConfig.viewerTimeEndHours);
    const startHours = Math.min(Math.max(Math.round(lo), 0), 23);
    const stepHours = Math.max(1, Math.round(viewerConfig.viewerTimeStepMinutes / 60));
    const spanHours = Math.max(stepHours, MIN_SUN_TIME_WINDOW_HOURS, Math.floor((Math.round(hi) - startHours) / stepHours) * stepHours);
    return { startHours, endHours: Math.min(24, startHours + spanHours), stepHours };
  }, [viewerConfig.viewerTimeStartHours, viewerConfig.viewerTimeEndHours, viewerConfig.viewerTimeStepMinutes]);

  const effectiveSunTimeHours = sunTimeInteractive
    ? snapSunTimeHours(liveSunTimeHours ?? viewerConfig.viewerTimeHours, sunTimeWindow)
    : liveSunTimeHours ?? viewerConfig.viewerTimeHours;

  const sunTimeline = useMemo(() => {
    const elevationAt =
      viewerConfig.solarPathMode === "geographic"
        ? (h: number) => geographicSunPosition(new Date(effectiveSunDate), viewerConfig.geoLatitude, viewerConfig.geoLongitude, h).elevationDeg
        : (h: number) => sunPositionForAnchors(h, viewerConfig.solarAnchors).elevationDeg;
    return computeSunTimeline(elevationAt);
  }, [viewerConfig.solarPathMode, viewerConfig.geoLatitude, viewerConfig.geoLongitude, viewerConfig.solarAnchors, effectiveSunDate]);
  const sunTimePresets = useMemo(() => snapSunTimePresets(sunTimelinePresets(sunTimeline), sunTimeWindow), [sunTimeline, sunTimeWindow]);
  const sunTimeBounds = useMemo(
    () => ({ startHours: sunTimeWindow.startHours, endHours: sunTimeWindow.endHours, stepMinutes: sunTimeWindow.stepHours * 60 }),
    [sunTimeWindow]
  );

  const handleSunTimeChange = useCallback(
    (hours: number) => {
      setLiveSunTimeHours(snapSunTimeHours(hours, sunTimeWindow));
      setActiveSunPreset(null);
      viewerRef.current?.resetIdleTimer();
    },
    [sunTimeWindow]
  );
  const handleSunPresetSelect = useCallback(
    (preset: SunTimePreset) => {
      setLiveSunTimeHours(snapSunTimeHours(preset.hour, sunTimeWindow));
      setActiveSunPreset(preset.id);
      viewerRef.current?.resetIdleTimer();
    },
    [sunTimeWindow]
  );
  const handleSunTimeReset = useCallback(() => {
    setLiveSunTimeHours(null);
    setLiveSunDate(null);
    setActiveSunPreset(null);
    viewerRef.current?.resetIdleTimer();
  }, []);

  const [activeViewPresetId, setActiveViewPresetId] = useState<string | null>(null);
  const handleSelectViewPreset = useCallback((preset: CameraPreset) => {
    viewerRef.current?.flyToPreset(preset);
    setActiveViewPresetId(preset.id);
  }, []);

  const cameraConfig = useMemo(
    () => ({
      cameraFovDesktop: viewerConfig.cameraFovDesktop,
      cameraFovMobile: viewerConfig.cameraFovMobile,
      cameraNearClip: viewerConfig.cameraNearClip,
      cameraFarClip: viewerConfig.cameraFarClip,
      cameraStartDistanceMultiplier: viewerConfig.cameraStartDistanceMultiplier,
      cameraMinDistanceMultiplier: viewerConfig.cameraMinDistanceMultiplier,
      cameraMaxDistanceMultiplier: viewerConfig.cameraMaxDistanceMultiplier,
      cameraMinPolarDeg: viewerConfig.cameraMinPolarDeg,
      cameraMaxPolarDeg: viewerConfig.cameraMaxPolarDeg,
      cameraMinAzimuthDeg: viewerConfig.cameraMinAzimuthDeg,
      cameraMaxAzimuthDeg: viewerConfig.cameraMaxAzimuthDeg,
      cameraOrbitEnabled: viewerConfig.cameraOrbitEnabled,
      cameraPanEnabled: viewerConfig.cameraPanEnabled,
      cameraZoomEnabled: viewerConfig.cameraZoomEnabled,
      cameraDampingEnabled: viewerConfig.cameraDampingEnabled,
      autoRotate: chromeDimmed,
      idleDroneEnabled: viewerConfig.idleDroneEnabled,
      idleDroneDelaySec: viewerConfig.idleDroneDelaySec,
      idleDroneOrbitDurationSec: viewerConfig.idleDroneOrbitDurationSec,
      idleDroneClockwise: viewerConfig.idleDroneClockwise,
      idleDroneMotionEnabled: viewerConfig.idleDroneMotionEnabled,
      idleDroneHeightEnabled: viewerConfig.idleDroneHeightEnabled,
      idleDroneHeightAmplitude: viewerConfig.idleDroneHeightAmplitude,
      idleDroneDistanceEnabled: viewerConfig.idleDroneDistanceEnabled,
      idleDroneDistanceAmplitude: viewerConfig.idleDroneDistanceAmplitude,
      idleDroneTargetEnabled: viewerConfig.idleDroneTargetEnabled,
      idleDroneTargetAmplitude: viewerConfig.idleDroneTargetAmplitude,
      idleDroneVerticalCycles: viewerConfig.idleDroneVerticalCycles,
      idleDronePhaseOffsetDeg: viewerConfig.idleDronePhaseOffsetDeg,
      idleDroneSmoothness: viewerConfig.idleDroneSmoothness,
      cameraPresets: viewerConfig.cameraPresets,
    }),
    [viewerConfig, chromeDimmed]
  );

  const qualityConfig = useMemo(
    () =>
      applyViewerQuality(viewerQuality, {
        renderingMode: viewerConfig.renderingMode,
        qualityPreset: viewerConfig.qualityPreset,
        customRenderScale: viewerConfig.customRenderScale,
        customDprCap: viewerConfig.customDprCap,
        adaptiveQualityEnabled: viewerConfig.adaptiveQualityEnabled,
        runtimeQualityReductionEnabled: viewerConfig.runtimeQualityReductionEnabled,
        interactionQualityReductionEnabled: viewerConfig.interactionQualityReductionEnabled,
      }),
    [viewerConfig, viewerQuality]
  );

  const environmentConfig = useMemo(
    () => ({
      solarControllerEnabled: viewerConfig.solarControllerEnabled,
      solarPathMode: viewerConfig.solarPathMode,
      viewerTimeHours: effectiveSunTimeHours,
      solarAnchors: viewerConfig.solarAnchors,
      geoLatitude: viewerConfig.geoLatitude,
      geoLongitude: viewerConfig.geoLongitude,
      simulationDate: effectiveSunDate,
      northOffsetDeg: viewerConfig.northOffsetDeg,
      siteRotationDeg: viewerConfig.siteRotationDeg,
      sunDiscEnabled: viewerConfig.sunDiscEnabled,
      autoSunIntensityEnabled: viewerConfig.autoSunIntensityEnabled,
      autoSunColorEnabled: viewerConfig.autoSunColorEnabled,
      manualSunIntensity: viewerConfig.manualSunIntensity,
      manualSunColorHex: viewerConfig.manualSunColorHex,
      environmentRefreshEnabled: viewerConfig.environmentRefreshEnabled,
      sunAzimuthDeg: viewerConfig.sunAzimuthDeg,
      sunElevationDeg: viewerConfig.sunElevationDeg,
      skyEnabled: viewerConfig.skyEnabled,
      skyTurbidity: viewerConfig.skyTurbidity,
      skyRayleigh: viewerConfig.skyRayleigh,
      skyMieCoefficient: viewerConfig.skyMieCoefficient,
      skyMieDirectionalG: viewerConfig.skyMieDirectionalG,
      backdropEnabled: viewerConfig.backdropEnabled,
      backdropImageUrl: viewerConfig.backdropImageUrl,
      backdropRotationDeg: viewerConfig.backdropRotationDeg,
      backdropPitchDeg: viewerConfig.backdropPitchDeg,
      backdropElevation: viewerConfig.backdropElevation,
      environmentIntensity: viewerConfig.environmentIntensity,
      cloudsEnabled: viewerConfig.cloudsEnabled,
      cloudCoverage: viewerConfig.cloudCoverage,
      cloudDensity: viewerConfig.cloudDensity,
      cloudElevation: viewerConfig.cloudElevation,
      cloudMovementEnabled: viewerConfig.cloudMovementEnabled,
      cloudSunLightingEnabled: viewerConfig.cloudSunLightingEnabled,
      cloudShadowsEnabled: viewerConfig.cloudShadowsEnabled,
      cloudHeight: viewerConfig.cloudHeight,
      cloudThickness: viewerConfig.cloudThickness,
      cloudThreshold: viewerConfig.cloudThreshold,
      cloudOpacity: viewerConfig.cloudOpacity,
      cloudSoftness: viewerConfig.cloudSoftness,
      cloudScale: viewerConfig.cloudScale,
      cloudWindSpeed: viewerConfig.cloudWindSpeed,
      cloudWindDirectionDeg: viewerConfig.cloudWindDirectionDeg,
      cloudRaymarchSteps: viewerConfig.cloudRaymarchSteps,
      fogEnabled: viewerConfig.fogEnabled,
      fogColor: viewerConfig.fogColor,
      fogDensity: viewerConfig.fogDensity,
      fogMatchesSky: viewerConfig.fogMatchesSky,
      fogHeightBandEnabled: viewerConfig.fogHeightBandEnabled,
      fogHazeEnabled: viewerConfig.fogHazeEnabled,
      fogNoiseEnabled: viewerConfig.fogNoiseEnabled,
      fogMovementEnabled: viewerConfig.fogMovementEnabled,
      fogSunInteractionEnabled: viewerConfig.fogSunInteractionEnabled,
      fogBaseHeight: viewerConfig.fogBaseHeight,
      fogTopHeight: viewerConfig.fogTopHeight,
      fogHaze: viewerConfig.fogHaze,
      fogNoiseStrength: viewerConfig.fogNoiseStrength,
      fogNoiseScale: viewerConfig.fogNoiseScale,
      fogWindDirectionDeg: viewerConfig.fogWindDirectionDeg,
      fogWindSpeed: viewerConfig.fogWindSpeed,
      fogFalloff: viewerConfig.fogFalloff,
      fogMaxOpacity: viewerConfig.fogMaxOpacity,
      waterEnabled: viewerConfig.waterEnabled,
      waterDistortionScale: viewerConfig.waterDistortionScale,
      waterSize: viewerConfig.waterSize,
      waterType: viewerConfig.waterType,
      waterWavesEnabled: viewerConfig.waterWavesEnabled,
      waterMovementEnabled: viewerConfig.waterMovementEnabled,
      waterSunReflectionEnabled: viewerConfig.waterSunReflectionEnabled,
      waterEnvReflectionEnabled: viewerConfig.waterEnvReflectionEnabled,
      waterNormalMapEnabled: viewerConfig.waterNormalMapEnabled,
      waterHeight: viewerConfig.waterHeight,
      waterColor: viewerConfig.waterColor,
      waterDeepColor: viewerConfig.waterDeepColor,
      groundEnabled: viewerConfig.groundEnabled,
      groundStyle: viewerConfig.groundStyle,
      groundColor: viewerConfig.groundColor,
      groundFogEnabled: viewerConfig.groundFogEnabled,
      groundFogRadius: viewerConfig.groundFogRadius,
    }),
    [viewerConfig, effectiveSunTimeHours, effectiveSunDate]
  );

  const lightingConfig = useMemo(
    () =>
      applyEffectOverridesToLighting(effectOverrides, applyViewerQualityToLighting(viewerQuality, {
        sunLightEnabled: viewerConfig.sunLightEnabled,
        sunTemperatureK: viewerConfig.sunTemperatureK,
        autoSunIntensityEnabled: viewerConfig.autoSunIntensityEnabled,
        autoSunColorEnabled: viewerConfig.autoSunColorEnabled,
        manualSunIntensity: viewerConfig.manualSunIntensity,
        manualSunColorHex: viewerConfig.manualSunColorHex,
        csmEnabled: viewerConfig.csmEnabled,
        csmCascades: viewerConfig.csmCascades,
        csmMaxDistance: viewerConfig.csmMaxDistance,
        csmResolution: viewerConfig.csmResolution,
        csmSplitMode: viewerConfig.csmSplitMode,
        csmMargin: viewerConfig.csmMargin,
        softShadowsEnabled: viewerConfig.softShadowsEnabled,
        shadowSoftness: viewerConfig.shadowSoftness,
        shadowsEnabled: viewerConfig.shadowsEnabled,
        contactShadowsEnabled: viewerConfig.contactShadowsEnabled,
        contactShadowBlur: viewerConfig.contactShadowBlur,
        contactShadowDarkness: viewerConfig.contactShadowDarkness,
        contactShadowOpacity: viewerConfig.contactShadowOpacity,
        contactShadowRange: viewerConfig.contactShadowRange,
        transmittedShadowsEnabled: viewerConfig.transmittedShadowsEnabled,
        coloredShadowsEnabled: viewerConfig.coloredShadowsEnabled,
        transmittedShadowStrength: viewerConfig.transmittedShadowStrength,
        giEnabled: viewerConfig.giEnabled,
        giIndirectEnabled: viewerConfig.giIndirectEnabled,
        giAOEnabled: viewerConfig.giAOEnabled,
        giBackfaceLighting: viewerConfig.giBackfaceLighting,
        giTemporalFiltering: viewerConfig.giTemporalFiltering,
        giScreenSpaceSampling: viewerConfig.giScreenSpaceSampling,
        giIntensity: viewerConfig.giIntensity,
        giAOIntensity: viewerConfig.giAOIntensity,
        giRadius: viewerConfig.giRadius,
        giSliceCount: viewerConfig.giSliceCount,
        giStepCount: viewerConfig.giStepCount,
        giExpFactor: viewerConfig.giExpFactor,
        giThickness: viewerConfig.giThickness,
        giLinearThickness: viewerConfig.giLinearThickness,
        artificialLights: viewerConfig.artificialLights,
        volumetricLightingEnabled: viewerConfig.volumetricLightingEnabled,
        sunShaftsEnabled: viewerConfig.sunShaftsEnabled,
        lightVolumesEnabled: viewerConfig.lightVolumesEnabled,
        volumetricRaymarchSteps: viewerConfig.volumetricRaymarchSteps,
        volumetricDensity: viewerConfig.volumetricDensity,
        volumetricMaxDensity: viewerConfig.volumetricMaxDensity,
        volumetricDistanceAtten: viewerConfig.volumetricDistanceAtten,
      })),
    [viewerConfig, viewerQuality, effectOverrides]
  );

  const renderingConfig = useMemo(
    () =>
      applyEffectOverridesToRendering(effectOverrides, applyViewerQualityToRendering(viewerQuality, {
        ssrEnabled: viewerConfig.ssrEnabled,
        ssrIntensity: viewerConfig.ssrIntensity,
        ssrMaxDistance: viewerConfig.ssrMaxDistance,
        ssrThickness: viewerConfig.ssrThickness,
        ssrQuality: viewerConfig.ssrQuality,
        antialiasEnabled: viewerConfig.antialiasEnabled,
        bloomEnabled: viewerConfig.bloomEnabled,
        bloomStrength: viewerConfig.bloomStrength,
        bloomRadius: viewerConfig.bloomRadius,
        lensFlareEnabled: viewerConfig.lensFlareEnabled,
        lensFlareIntensity: viewerConfig.lensFlareIntensity,
        depthOfFieldEnabled: viewerConfig.depthOfFieldEnabled,
        depthOfFieldFocalLength: viewerConfig.depthOfFieldFocalLength,
        depthOfFieldBokehScale: viewerConfig.depthOfFieldBokehScale,
        distanceBlurEnabled: viewerConfig.distanceBlurEnabled,
        distanceBlurStartM: viewerConfig.distanceBlurStartM,
        distanceBlurFullM: viewerConfig.distanceBlurFullM,
        distanceBlurAmount: viewerConfig.distanceBlurAmount,
        distanceBlurRadius: viewerConfig.distanceBlurRadius,
        cameraAutoFocusEnabled: viewerConfig.cameraAutoFocusEnabled,
        motionBlurEnabled: viewerConfig.motionBlurEnabled,
        motionBlurIntensity: viewerConfig.motionBlurIntensity,
        exposure: viewerConfig.exposure,
        toneMapping: viewerConfig.toneMapping,
        lutEnabled: viewerConfig.lutEnabled,
        lutPreset: viewerConfig.lutPreset,
        lutIntensity: viewerConfig.lutIntensity,
      })),
    [viewerConfig, viewerQuality, effectOverrides]
  );

  const siteConfig = useMemo(
    () => ({
      siteEnabled: viewerConfig.siteEnabled,
      siteRadiusM: viewerConfig.siteRadiusM,
      siteTerrainEnabled: viewerConfig.siteTerrainEnabled,
      siteImageryEnabled: viewerConfig.siteImageryEnabled,
      siteImageryBrightness: viewerConfig.siteImageryBrightness,
      siteOffsetX: viewerConfig.siteOffsetX,
      siteOffsetZ: viewerConfig.siteOffsetZ,
      siteElevationOffset: viewerConfig.siteElevationOffset,
      siteRotationDeg: viewerConfig.siteRotationDeg,
      siteScale: viewerConfig.siteScale,
      latitude: project.coords?.lat ?? null,
      longitude: project.coords?.lng ?? null,
    }),
    [viewerConfig, project.coords]
  );
  const unitsConfig = useMemo(
    () => ({
      unitColorAvailable: viewerConfig.unitColorAvailable,
      unitColorReserved: viewerConfig.unitColorReserved,
      unitColorSold: viewerConfig.unitColorSold,
      unitColorSelected: viewerConfig.unitColorSelected,
      unitBlocksEnabled: viewerConfig.unitBlocksEnabled,
      unitBlocksStatusColorsEnabled: viewerConfig.unitBlocksStatusColorsEnabled,
      unitBlocksXrayEnabled: viewerConfig.unitBlocksXrayEnabled,
      unitBlocksDefaultOpacity: viewerConfig.unitBlocksDefaultOpacity,
      unitBlocksHoverOpacity: viewerConfig.unitBlocksHoverOpacity,
      unitBlocksSelectedOpacity: viewerConfig.unitBlocksSelectedOpacity,
      unitBlocksSelectedOutlineEnabled: viewerConfig.unitBlocksSelectedOutlineEnabled,
      unitBlocksSelectedOutlineWidth: viewerConfig.unitBlocksSelectedOutlineWidth,
      unitBlocksSelectedScaleEnabled: viewerConfig.unitBlocksSelectedScaleEnabled,
      unitBlocksSelectedScale: viewerConfig.unitBlocksSelectedScale,
      unitBlocksSelectedFillEnabled: viewerConfig.unitBlocksSelectedFillEnabled,
      unitColorSelectedFill: viewerConfig.unitColorSelectedFill,
      unitBlocksSelectedXrayEnabled: viewerConfig.unitBlocksSelectedXrayEnabled,
      unitPoiCameraEnabled: viewerConfig.unitPoiCameraEnabled,
      unitPoiCameraFov: viewerConfig.unitPoiCameraFov,
      unitPoiCameraDistanceMultiplier: viewerConfig.unitPoiCameraDistanceMultiplier,
      unitPoiCameraHeightOffset: viewerConfig.unitPoiCameraHeightOffset,
      unitPoiTransitionMs: viewerConfig.unitPoiTransitionMs,
      unitPoiAutoOcclusionCorrection: viewerConfig.unitPoiAutoOcclusionCorrection,
    }),
    [viewerConfig]
  );

  function toggleFullscreen() {
    const el = mainRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      if (!document.fullscreenEnabled || !el.requestFullscreen) {
        setFullscreenUnsupported(true);
        setTimeout(() => setFullscreenUnsupported(false), 2500);
        return;
      }
      el.requestFullscreen().catch(() => {
        setFullscreenUnsupported(true);
        setTimeout(() => setFullscreenUnsupported(false), 2500);
      });
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  useEffect(() => {
    function onChange() {
      setFullscreen(document.fullscreenElement === mainRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    viewerRef.current?.setUnitsMode(activeModule === "units");
  }, [activeModule]);

  useEffect(() => {
    const status = unitFilters.status;
    viewerRef.current?.setUnitStatusFilters({
      available: status === "all" || status === "available",
      reserved: status === "all" || status === "reserved",
      sold: status === "all" || status === "sold",
    });
  }, [unitFilters.status]);

  const unitFiltersWithoutStatus = useMemo(
    () => ({ ...unitFilters, status: "all" as const }),
    [unitFilters]
  );
  useEffect(() => {
    const isNarrowing =
      activeFilterCount(unitFiltersWithoutStatus) > 0 || unitFiltersWithoutStatus.query.trim() !== "";
    viewerRef.current?.setUnitIdFilter(
      isNarrowing ? filterUnits(units, unitFiltersWithoutStatus).map((u) => u.id) : null
    );
  }, [units, unitFiltersWithoutStatus]);

  async function handleScreenshot() {
    const dataUrl = await viewerRef.current?.captureScreenshot();
    if (!dataUrl) {
      setScreenshotFlash("error");
      setTimeout(() => setScreenshotFlash(null), 2500);
      return;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${project.slug}-nesto-3d.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setScreenshotFlash("success");
    setTimeout(() => setScreenshotFlash(null), 2500);
  }

  const handleReady = useCallback(() => setSceneReady(true), []);

  const handleSelectUnit = useCallback((unitId: string | null) => {
    if (!followFloorCutToUnit(unitId)) dropFloorCutIfUncontrolled(activeModule, unitId);
    setSelectedUnitId(unitId);
    resetDetailOnDismiss(unitId);
    const viewer = viewerRef.current;
    viewer?.setSelectedUnit(unitId);
    if (!unitId) {
      setUnmappedUnitId(null);
      return;
    }
    viewer?.resetIdleTimer();
    const view = viewer?.getUnitViewportState(unitId) ?? null;
    if (!view) {
      setUnmappedUnitId(unitId);
      return;
    }
    setUnmappedUnitId(null);
    if (isDesktop && view.onScreen && view.coverage >= MIN_ONSCREEN_UNIT_COVERAGE) return;
    if (!(view.poiAuthored && viewer?.focusUnit(unitId))) {
      viewer?.revealUnit(unitId, isDesktop ? 0 : MOBILE_REVEAL_SCREEN_BIAS);
    }
  }, [
    isDesktop,
    activeModule,
    followFloorCutToUnit,
    dropFloorCutIfUncontrolled,
    resetDetailOnDismiss,
  ]);

  const handleUnitClickIn3D = useCallback((unitId: string | null) => {
    if (!followFloorCutToUnit(unitId)) dropFloorCutIfUncontrolled(activeModule, unitId);
    setSelectedUnitId(unitId);
    resetDetailOnDismiss(unitId);
    setUnmappedUnitId(null);
  }, [
    activeModule,
    followFloorCutToUnit,
    dropFloorCutIfUncontrolled,
    resetDetailOnDismiss,
  ]);

  return (
    <div
      id="main-content"
      ref={mainRef}
      data-viewer-channel={channel}
      className="relative flex h-viewport w-full shrink-0 overflow-hidden bg-surface"
    >
      <UnitsWorkspace
        open={leftPanelOpen}
        onClose={handleCloseUnitsList}
        units={units}
        selectedUnitId={selectedUnitId}
        onSelectUnit={handleSelectUnit}
        unmappedUnitId={unmappedUnitId}
        filters={unitFilters}
        onFiltersChange={setUnitFilters}
      />

      <div className="relative h-full min-w-0 flex-1">
        {(
          <>
            <ViewerHUD
              brand={brand}
              viewerRef={viewerRef}
              sceneReady={sceneReady}
              activeModule={activeModule}
              onActiveModuleChange={handleActiveModuleChange}
              chromeDimmed={chromeDimmed}
              project={moreMenuProject}
              fullscreen={fullscreen}
              onToggleFullscreen={toggleFullscreen}
              onScreenshot={handleScreenshot}
              screenshotEnabled={viewerConfig.viewerUI.screenshotEnabled !== false}
              fullscreenEnabled={viewerConfig.viewerUI.fullscreenEnabled !== false}
              northOffsetDeg={viewerConfig.northOffsetDeg}
              viewerTimeHours={effectiveSunTimeHours}
              sunTimeInteractive={sunTimeInteractive}
              sunTimeBounds={sunTimeBounds}
              sunTimeline={sunTimeline}
              sunTimePresets={sunTimePresets}
              activeSunPreset={activeSunPreset}
              sunTimeCanReset={liveSunTimeHours != null || liveSunDate != null}
              onSunTimeChange={handleSunTimeChange}
              onSunPresetSelect={handleSunPresetSelect}
              onSunTimeReset={handleSunTimeReset}
              cameraPresets={viewerConfig.cameraPresets}
              activeViewPresetId={activeViewPresetId}
              onSelectViewPreset={handleSelectViewPreset}
              units={units}
              unitFilters={unitFilters}
              onUnitFiltersChange={setUnitFilters}
              unitsListOpen={unitsListOpen}
              onToggleUnitsList={handleToggleUnitsList}
              unitFiltersExpanded={unitFiltersExpanded}
              onToggleUnitFilters={handleToggleUnitFilters}
            />
            {activeModule === "units" && floorSectionsAvailable && (
              <div
                data-viewer-floor-rail
                className="pointer-events-none absolute left-3 top-1/2 z-30 -translate-y-1/2 pl-[env(safe-area-inset-left)] sm:left-4"
              >
                <FloorRail
                  buildings={floorRailBuildings}
                  activeSectionId={activeFloorSectionId}
                  selectedFloorId={selectedFloorId}
                  onSelectFloor={handleSelectFloor}
                  isTouch={!isDesktop}
                />
              </div>
            )}
          </>
        )}

        {!unitCardOpen && (compareCount > 0 || (!unitPanelOpen && project.status === "under_construction" && construction.stages.length > 0)) && (
          <div className="absolute right-3 top-[60px] z-20 flex shrink-0 items-stretch gap-2 pr-[env(safe-area-inset-right)] sm:right-4 sm:top-[68px]">
            {compareCount > 0 && (
              <button
                onClick={() => setCompareOverlayOpen(true)}
                className="glass-panel-dark flex items-center gap-1.5 rounded-pill px-3.5 text-xs font-semibold text-fg"
              >
                <SquareStack className="h-3.5 w-3.5" />
                {compareCount}
              </button>
            )}
            {!unitPanelOpen && project.status === "under_construction" && construction.stages.length > 0 && (
              <div className="flex items-stretch">
                <ConstructionTimelineStrip
                  stages={construction.stages}
                  overallPercent={construction.progressPercent}
                  compact
                />
              </div>
            )}
          </div>
        )}

        {screenshotFlash && (
          <div className="glass-panel-dark pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-pill px-4 py-2 text-xs font-semibold text-fg sm:top-20">
            {t(screenshotFlash === "success" ? "project.screenshotSaved" : "project.screenshotFailed")}
          </div>
        )}

        {fullscreenUnsupported && (
          <div className="glass-panel-dark pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-pill px-4 py-2 text-xs font-semibold text-fg sm:top-20">
            {t("project.fullscreenUnavailable")}
          </div>
        )}

        {(
          <div className="relative h-full w-full" onPointerDownCapture={handleScenePointerDown}>
            <ThreeProjectViewer
              ref={viewerRef}
              detailModels={detailModelEntries}
              cameraConfig={cameraConfig}
              qualityConfig={qualityConfig}
              environmentConfig={environmentConfig}
              lightingConfig={lightingConfig}
              renderingConfig={renderingConfig}
              unitsConfig={unitsConfig}
              siteConfig={siteConfig}
              onUnitClick={handleUnitClickIn3D}
              onReady={handleReady}
              onModelLoadStatus={onModelLoadStatus}
              onRendererFacts={setRendererFacts}
              onSiteStatus={(status) =>
                setSiteStatus(
                  status.state === "ready"
                    ? `ready (${Math.round(status.centreElevationM)}m)`
                    : status.state === "failed"
                      ? `failed — ${status.reason ?? "unknown"}`
                      : "loading…"
                )
              }
              showPerfStats={diagOpen}
              onPerfStats={setDiagStats}
              className="relative h-full w-full"
            />
            {diagOpen && <ViewerDiagnostics facts={rendererFacts} stats={diagStats} site={siteStatus} />}
          </div>
        )}
        {(
          <MobileUnitsSheet
            open={unitsSheetOpen}
            onClose={handleCloseUnitsList}
            units={units}
            selectedUnitId={selectedUnitId}
            onSelectUnit={handleSelectUnit}
            unmappedUnitId={unmappedUnitId}
            filters={unitFilters}
            onFiltersChange={setUnitFilters}
            onOpenDockFilters={handleOpenUnitFilters}
          />
        )}
      </div>

      <UnitDiscoveryPanel
        project={project}
        open={unitPanelOpen}
        onClose={() => setUnitPanelOpen(false)}
        onSelectUnit={(u) => handleSelectUnit(u.id)}
      />
      {(cardUnit || floorExitOpen) && (
        <UnitPreviewCard
          project={project}
          unit={cardUnit}
          expanded={fullDetailOpen}
          retracted={!unitCardOpen}
          floorSectionName={floorSectionForSelectedUnit?.name ?? null}
          floorSectionActive={
            !!floorSectionForSelectedUnit && floorSectionForSelectedUnit.id === activeFloorSectionId
          }
          onViewInFloor={handleToggleFloorSection}
          onExitFloor={handleExitFloorFromPill}
          exitFloorLabel={exitFloorLabel}
          exitFloorTitle={exitFloorTitle}
          onClose={() => handleSelectUnit(null)}
          onExpand={() => setFullDetailOpen(true)}
          onCollapse={() => setFullDetailOpen(false)}
        />
      )}
      {/* Rozaris mounts these in its root layout; here they belong to the viewer. */}
      <CompareOverlay />
      <CompareReplaceModal />
    </div>
  );
}
