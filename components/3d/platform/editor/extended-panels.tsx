"use client";

import * as React from "react";
import { Plus, RotateCcw, Search, Trash2 } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { Button } from "@/components/ui/button";
import { PROJECT_3D_PLATFORM_API_ROOT } from "@/lib/3d/platform";
import { LUT_PRESETS } from "@/lib/3d/runtime/viewerPresets";
import type { ArtificialLight, Project3DConfig, ViewerUIToggles } from "@/lib/3d/runtime/types";
import { environmentPresetPatch, pickEnvironmentPresetConfig } from "@/lib/3d/shared/environment-presets";
import type { Project3DNodeOverride, Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { cn } from "@/lib/utils/cn";
import { Choice, Color, Panel, Range, Toggle } from "./controls";

/*
 * The Rozaris Experience Editor's remaining controls, ported panel by panel.
 * They sit below the controls each NESTO tool already had and edit the same
 * draft, so Save, Reset and the conflict checks cover them unchanged.
 */

type Config = Project3DConfig;
type KeysOf<V> = { [K in keyof Config]-?: Config[K] extends V ? K : never }[keyof Config];
type Change = (patch: Partial<Config>) => void;
type ConfigProps = { draft: Config; change: Change };

/** Draft-bound shorthands: a toggle, slider or color for one Experience field. */
function binders({ draft, change }: ConfigProps) {
  return {
    t: (label: string, key: KeysOf<boolean>, disabled?: boolean) => <Toggle key={key} label={label} value={draft[key] as boolean} disabled={disabled} onChange={(value) => change({ [key]: value } as Partial<Config>)} />,
    r: (label: string, key: KeysOf<number>, min: number, max: number, step: number, suffix?: string, disabled?: boolean) => <Range key={key} label={label} value={draft[key] as number} min={min} max={max} step={step} suffix={suffix} disabled={disabled} onChange={(value) => change({ [key]: value } as Partial<Config>)} />,
    c: (label: string, key: KeysOf<string>, disabled?: boolean) => <Color key={key} label={label} value={draft[key] as string} disabled={disabled} onChange={(value) => change({ [key]: value } as Partial<Config>)} />,
  };
}

function options(values: string[]) {
  return values.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));
}

/* ------------------------------------------------------------------ Units */

export function UnitStylePanels({ draft, change, statusPreview, onStatusPreview }: ConfigProps & { statusPreview: boolean; onStatusPreview: (value: boolean) => void }) {
  const { t, r, c } = binders({ draft, change });
  const blocks = draft.unitBlocksEnabled;
  return <>
    <Panel title="Unit blocks">
      {t("Unit blocks", "unitBlocksEnabled")}
      <Toggle label="Status preview (editor only)" value={statusPreview} onChange={onStatusPreview} />
      <p className="text-[11px] leading-4 text-neutral-500">Status preview shows the unit blocks in this viewport. Click a block to see its selected style.</p>
    </Panel>
    <Panel title="Appearance">
      {t("Status colors", "unitBlocksStatusColorsEnabled", !blocks)}
      {t("X-Ray", "unitBlocksXrayEnabled", !blocks)}
      {r("Default opacity", "unitBlocksDefaultOpacity", 0, 1, 0.01, undefined, !blocks)}
      {r("Hover opacity", "unitBlocksHoverOpacity", 0, 1, 0.01, undefined, !blocks)}
      {r("Selected opacity", "unitBlocksSelectedOpacity", 0, 1, 0.01, undefined, !blocks)}
    </Panel>
    <Panel title="Selected unit">
      {t("Outline", "unitBlocksSelectedOutlineEnabled", !blocks)}
      {draft.unitBlocksSelectedOutlineEnabled ? r("Outline width", "unitBlocksSelectedOutlineWidth", 0.5, 20, 0.5, "px", !blocks) : null}
      {t("Enlarge", "unitBlocksSelectedScaleEnabled", !blocks)}
      {draft.unitBlocksSelectedScaleEnabled ? r("Enlarge scale", "unitBlocksSelectedScale", 1, 1.5, 0.01, "×", !blocks) : null}
      {t("Fill", "unitBlocksSelectedFillEnabled", !blocks)}
      {t("X-Ray", "unitBlocksSelectedXrayEnabled", !blocks)}
    </Panel>
    <Panel title="Colors">
      {c("Available", "unitColorAvailable")}
      {c("Reserved", "unitColorReserved")}
      {c("Sold", "unitColorSold")}
      {c("Selected outline", "unitColorSelected")}
      {c("Selected fill", "unitColorSelectedFill")}
    </Panel>
    <Panel title="Unit camera">
      {t("Unit camera", "unitPoiCameraEnabled")}
      {r("FOV", "unitPoiCameraFov", 10, 90, 1, "°", !draft.unitPoiCameraEnabled)}
      {r("Distance", "unitPoiCameraDistanceMultiplier", 0.5, 10, 0.1, "×", !draft.unitPoiCameraEnabled)}
      {r("Height", "unitPoiCameraHeightOffset", -10, 10, 0.1, "m", !draft.unitPoiCameraEnabled)}
      {r("Transition", "unitPoiTransitionMs", 0, 3000, 50, "ms", !draft.unitPoiCameraEnabled)}
      {t("Auto occlusion correction", "unitPoiAutoOcclusionCorrection", !draft.unitPoiCameraEnabled)}
    </Panel>
    <Panel title="Caustics">
      {t("Caustics", "causticsEnabled")}
      {r("Scale", "causticsScale", 0.05, 5, 0.05, undefined, !draft.causticsEnabled)}
      {r("Speed", "causticsSpeed", 0, 2, 0.01, undefined, !draft.causticsEnabled)}
      {r("Available intensity", "causticsIntensityAvailable", 0, 3, 0.05, undefined, !draft.causticsEnabled)}
      {r("Reserved intensity", "causticsIntensityReserved", 0, 3, 0.05, undefined, !draft.causticsEnabled)}
      {r("Sold intensity", "causticsIntensitySold", 0, 3, 0.05, undefined, !draft.causticsEnabled)}
    </Panel>
  </>;
}

export type EditorUnitRow = { id: string; code: string; status: "available" | "reserved" | "sold"; linked: boolean };

/** Every project unit with its status; Select previews the selected style, Test camera flies the unit camera. */
export function UnitListPanel({ units, selectedUnitId, onSelect, onTestCamera }: { units: EditorUnitRow[]; selectedUnitId: string | null; onSelect: (unitId: string | null) => void; onTestCamera: (unitId: string) => void }) {
  const [query, setQuery] = React.useState("");
  const shown = units.filter((unit) => unit.code.toLowerCase().includes(query.trim().toLowerCase()));
  const tone = { available: "text-emerald-400", reserved: "text-amber-300", sold: "text-red-400" } as const;
  return <Panel title={`Units (${units.length})`}>
    <SearchBox value={query} onChange={setQuery} placeholder="Search units…" />
    <div className="max-h-72 space-y-1 overflow-y-auto">
      {shown.map((unit) => <div key={unit.id} className={cn("flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-[11px]", selectedUnitId === unit.id ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-800")}>
        <button type="button" className="min-w-0 flex-1 truncate text-left text-neutral-200" onClick={() => onSelect(selectedUnitId === unit.id ? null : unit.id)}>{unit.code}</button>
        <span className={cn("capitalize", tone[unit.status])}>{unit.status}</span>
        {unit.linked ? <button type="button" className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800" onClick={() => onTestCamera(unit.id)}>Test camera</button> : <span className="text-neutral-600">not linked</span>}
      </div>)}
    </div>
  </Panel>;
}

/* ------------------------------------------------------------ Interaction */

export function InteractionPanels({ draft, change }: ConfigProps) {
  const ui = draft.viewerUI;
  const set = (patch: Partial<ViewerUIToggles>) => change({ viewerUI: { ...ui, ...patch } });
  const toggle = (label: string, key: keyof ViewerUIToggles, disabled?: boolean) => <Toggle key={key} label={label} value={ui[key] !== false} disabled={disabled} onChange={(value) => set({ [key]: value })} />;
  const filtersOff = ui.filtersEnabled === false;
  return <>
    <Panel title="Units">
      {toggle("Unit interaction", "unitInteractionEnabled")}
      {toggle("Hover", "hoverEnabled")}
      {toggle("Select", "selectEnabled")}
      {toggle("Highlight", "highlightEnabled")}
      {toggle("Status colors", "statusColorsEnabled")}
      {toggle("Isolation", "isolationEnabled")}
      {toggle("Floor isolation", "floorIsolationEnabled")}
      {toggle("Information card", "showUnitInfo")}
      {toggle("Unit page link", "unitPageLinkEnabled")}
    </Panel>
    <Panel title="Filters">
      {toggle("Filters", "filtersEnabled")}
      {toggle("Floor", "filterFloorEnabled", filtersOff)}
      {toggle("Availability", "filterAvailabilityEnabled", filtersOff)}
      {toggle("Bedrooms", "filterBedroomsEnabled", filtersOff)}
      {toggle("Type", "filterTypeEnabled", filtersOff)}
      {toggle("Price", "filterPriceEnabled", filtersOff)}
    </Panel>
    <Panel title="Viewer controls">
      {toggle("Home", "home")}
      {toggle("Unit search", "unitSearch")}
      {toggle("Reset", "resetEnabled")}
      {toggle("Fullscreen", "fullscreenEnabled")}
      {toggle("Shots menu", "shotsMenuEnabled")}
      {toggle("Sections", "sectionsEnabled")}
      {toggle("Sun presets", "sunPresetEnabled")}
      {toggle("Screenshot", "screenshotEnabled")}
      {toggle("Share", "shareEnabled")}
    </Panel>
  </>;
}

/* -------------------------------------------------------------- Materials */

export function MaterialNodeList({ nodes, selectedNodeId, overriddenIds, onSelect }: { nodes: Project3DSceneNode[]; selectedNodeId: string | null; overriddenIds: Set<string>; onSelect: (nodeId: string) => void }) {
  const [query, setQuery] = React.useState("");
  const shown = nodes.filter((node) => node.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <Panel title="Mesh search">
    <SearchBox value={query} onChange={setQuery} placeholder="Search meshes…" />
    <div className="max-h-40 overflow-y-auto rounded border border-neutral-800">
      {shown.map((node) => <button key={node.nodeId} type="button" onClick={() => onSelect(node.nodeId)} className={cn("flex w-full items-center gap-1.5 border-b border-neutral-900 px-2 py-1.5 text-left text-[11px] last:border-b-0", selectedNodeId === node.nodeId ? "bg-indigo-500/15 text-white" : "text-neutral-400 hover:bg-neutral-900")}>
        <span className={cn("size-1.5 shrink-0 rounded-full", overriddenIds.has(node.nodeId) ? "bg-indigo-400" : "bg-transparent")} />
        <span className="truncate">{node.name}</span>
      </button>)}
      {shown.length === 0 ? <p className="p-2 text-[11px] text-neutral-500">No meshes match.</p> : null}
    </div>
  </Panel>;
}

export function MaterialExtraPanels({ override, change, onRestore, disabled }: { override: Project3DNodeOverride | null; change: (patch: Partial<Project3DNodeOverride>) => void; onRestore: () => void; disabled: boolean }) {
  const o = override ?? ({} as Partial<Project3DNodeOverride>);
  const off = disabled || o.materialOverrideEnabled === false;
  const t = (label: string, value: boolean, patch: (value: boolean) => Partial<Project3DNodeOverride>, extraOff?: boolean) => <Toggle label={label} value={value} disabled={off || extraOff} onChange={(next) => change(patch(next))} />;
  const r = (label: string, value: number, min: number, max: number, step: number, patch: (value: number) => Partial<Project3DNodeOverride>, extraOff?: boolean, suffix?: string) => <Range label={label} value={value} min={min} max={max} step={step} suffix={suffix} disabled={off || extraOff} onChange={(next) => change(patch(next))} />;
  const c = (label: string, value: string, patch: (value: string) => Partial<Project3DNodeOverride>, extraOff?: boolean) => <Color label={label} value={value} disabled={off || extraOff} onChange={(next) => change(patch(next))} />;
  const glassOff = !o.transmissionEnabled;
  return <>
    <Button type="button" variant="secondary" size="sm" disabled={disabled || !override} onClick={onRestore}><RotateCcw aria-hidden="true" />Restore original</Button>
    <Panel title="Texture maps">
      {t("Base texture", o.baseTextureEnabled !== false, (baseTextureEnabled) => ({ baseTextureEnabled }))}
      {t("Roughness map", o.roughnessMapEnabled !== false, (roughnessMapEnabled) => ({ roughnessMapEnabled }))}
      {t("Metalness map", o.metalnessMapEnabled !== false, (metalnessMapEnabled) => ({ metalnessMapEnabled }))}
      {t("Normal map", o.normalMapEnabled !== false, (normalMapEnabled) => ({ normalMapEnabled }))}
      {r("Normal strength", o.normalStrength ?? 1, 0, 4, 0.05, (normalStrength) => ({ normalStrength }))}
      {t("AO map", o.aoMapEnabled !== false, (aoMapEnabled) => ({ aoMapEnabled }))}
    </Panel>
    <Panel title="Emissive">
      {t("Emissive", Boolean(o.emissiveEnabled), (emissiveEnabled) => ({ emissiveEnabled }))}
      {t("Emissive map", o.emissiveMapEnabled !== false, (emissiveMapEnabled) => ({ emissiveMapEnabled }), !o.emissiveEnabled)}
      {c("Color", o.emissiveColorHex ?? "#ffffff", (emissiveColorHex) => ({ emissiveColorHex }), !o.emissiveEnabled)}
      {r("Intensity", o.emissiveIntensity ?? 1, 0, 20, 0.1, (emissiveIntensity) => ({ emissiveIntensity }), !o.emissiveEnabled)}
    </Panel>
    <Panel title="Glass">
      {r("Transmission", o.transmission ?? 1, 0, 1, 0.01, (transmission) => ({ transmission }), glassOff)}
      {r("IOR", o.ior ?? 1.5, 1, 2.333, 0.01, (ior) => ({ ior }), glassOff)}
      {r("Thickness", o.thickness ?? 1, 0, 100, 0.5, (thickness) => ({ thickness }), glassOff)}
      {t("Attenuation", Boolean(o.attenuationEnabled), (attenuationEnabled) => ({ attenuationEnabled }), glassOff)}
      {c("Attenuation color", o.attenuationColorHex ?? "#ffffff", (attenuationColorHex) => ({ attenuationColorHex }), glassOff || !o.attenuationEnabled)}
      {r("Attenuation distance", o.attenuationDistance ?? 1, 0, 50, 0.5, (attenuationDistance) => ({ attenuationDistance }), glassOff || !o.attenuationEnabled)}
    </Panel>
    <Panel title="Physical">
      {r("Clearcoat roughness", o.clearcoatRoughness ?? 0, 0, 1, 0.01, (clearcoatRoughness) => ({ clearcoatRoughness }))}
      {r("Anisotropy", o.anisotropy ?? 0, 0, 1, 0.01, (anisotropy) => ({ anisotropy }))}
      {r("Anisotropy rotation", o.anisotropyRotation ?? 0, 0, 360, 1, (anisotropyRotation) => ({ anisotropyRotation }), false, "°")}
      {r("Sheen", o.sheen ?? 0, 0, 1, 0.01, (sheen) => ({ sheen }))}
      {c("Sheen color", o.sheenColorHex ?? "#ffffff", (sheenColorHex) => ({ sheenColorHex }))}
      {r("Sheen roughness", o.sheenRoughness ?? 0, 0, 1, 0.01, (sheenRoughness) => ({ sheenRoughness }))}
      {r("Iridescence", o.iridescence ?? 0, 0, 1, 0.01, (iridescence) => ({ iridescence }))}
      {r("Iridescence IOR", o.iridescenceIOR ?? 1.3, 1, 2.333, 0.01, (iridescenceIOR) => ({ iridescenceIOR }))}
      {r("Dispersion", o.dispersion ?? 0, 0, 1, 0.01, (dispersion) => ({ dispersion }))}
    </Panel>
    <Panel title="Texture transform">
      {t("Texture transform", Boolean(o.textureTransformEnabled), (textureTransformEnabled) => ({ textureTransformEnabled }))}
      {r("Scale X", o.mapScaleX ?? 1, 0.1, 10, 0.1, (mapScaleX) => ({ mapScaleX }), !o.textureTransformEnabled)}
      {r("Scale Y", o.mapScaleY ?? 1, 0.1, 10, 0.1, (mapScaleY) => ({ mapScaleY }), !o.textureTransformEnabled)}
      {r("Offset X", o.mapOffsetX ?? 0, -1, 1, 0.01, (mapOffsetX) => ({ mapOffsetX }), !o.textureTransformEnabled)}
      {r("Offset Y", o.mapOffsetY ?? 0, -1, 1, 0.01, (mapOffsetY) => ({ mapOffsetY }), !o.textureTransformEnabled)}
      {r("Rotation", o.mapRotation ?? 0, 0, 360, 1, (mapRotation) => ({ mapRotation }), !o.textureTransformEnabled, "°")}
    </Panel>
  </>;
}

/* ------------------------------------------------------------ Environment */

export function EnvironmentExtraPanels(props: ConfigProps) {
  const { draft, change } = props;
  const { t, r, c } = binders(props);
  const fog = draft.fogEnabled;
  const clouds = draft.cloudsEnabled;
  const water = draft.waterEnabled;
  return <>
    <Panel title="Solar controller">
      {t("Solar controller", "solarControllerEnabled")}
      <Choice label="Solar path" value={draft.solarPathMode} options={[{ value: "manual", label: "Manual" }, { value: "geographic", label: "Geographic" }]} disabled={!draft.solarControllerEnabled} onChange={(solarPathMode) => change({ solarPathMode: solarPathMode as Config["solarPathMode"] })} />
      {t("Viewer time control", "viewerTimeControlEnabled", !draft.solarControllerEnabled)}
      {r("Viewer time", "viewerTimeHours", 0, 24, 0.25, "h", !draft.solarControllerEnabled)}
      {r("Start time", "viewerTimeStartHours", 0, 24, 1, "h", !draft.solarControllerEnabled)}
      {r("End time", "viewerTimeEndHours", 0, 24, 1, "h", !draft.solarControllerEnabled)}
      {r("Time step", "viewerTimeStepMinutes", 15, 360, 15, "min", !draft.solarControllerEnabled)}
      {r("North offset", "northOffsetDeg", -180, 180, 1, "°")}
      {r("Latitude", "geoLatitude", -90, 90, 0.01, "°")}
      {r("Longitude", "geoLongitude", -180, 180, 0.01, "°")}
      <label className="block text-xs text-neutral-400"><span className="mb-1 block">Simulation date</span><input type="date" className="h-8 w-full rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" value={draft.simulationDate.slice(0, 10)} onChange={(event) => { if (event.target.value) change({ simulationDate: new Date(`${event.target.value}T00:00:00.000Z`).toISOString() }); }} /></label>
    </Panel>
    <SolarAnchorsPanel {...props} />
    <Panel title="Sun">
      {t("Sun disc", "sunDiscEnabled")}
      {t("Automatic sun color", "autoSunColorEnabled")}
      {!draft.autoSunColorEnabled ? c("Manual color", "manualSunColorHex") : null}
      {t("Environment refresh", "environmentRefreshEnabled")}
    </Panel>
    <Panel title="Sky">
      {r("Rayleigh", "skyRayleigh", 0, 4, 0.05, undefined, !draft.skyEnabled)}
      {r("Mie coefficient", "skyMieCoefficient", 0, 0.1, 0.001, undefined, !draft.skyEnabled)}
      {r("Mie directional G", "skyMieDirectionalG", 0, 1, 0.01, undefined, !draft.skyEnabled)}
    </Panel>
    <Panel title="360° backdrop">
      {t("360° backdrop", "backdropEnabled", !draft.backdropImageUrl)}
      <label className="block text-xs text-neutral-400"><span className="mb-1 block">Image address</span><input className="h-8 w-full rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" value={draft.backdropImageUrl ?? ""} placeholder="https://…" onChange={(event) => change({ backdropImageUrl: event.target.value.trim() || null })} /></label>
      {r("Rotation", "backdropRotationDeg", -180, 180, 1, "°", !draft.backdropEnabled)}
      {r("Tilt up / down", "backdropPitchDeg", -45, 45, 0.5, "°", !draft.backdropEnabled)}
      {r("Elevation", "backdropElevation", -0.5, 0.5, 0.01, undefined, !draft.backdropEnabled)}
    </Panel>
    <Panel title="Fog">
      {c("Color", "fogColor", !fog || draft.fogMatchesSky)}
      {t("Match sky", "fogMatchesSky", !fog)}
      {t("Ground fog", "groundFogEnabled", !fog)}
      {r("Ground fog radius", "groundFogRadius", 1, 2000, 5, "m", !fog || !draft.groundFogEnabled)}
      {t("Height band", "fogHeightBandEnabled", !fog)}
      {r("Base height", "fogBaseHeight", -50, 500, 1, "m", !fog)}
      {r("Top height", "fogTopHeight", -50, 500, 1, "m", !fog)}
      {t("Distance haze", "fogHazeEnabled", !fog)}
      {r("Haze", "fogHaze", 0, 1, 0.01, undefined, !fog)}
      {r("Falloff", "fogFalloff", 0.1, 6, 0.1, undefined, !fog)}
      {r("Maximum opacity", "fogMaxOpacity", 0, 1, 0.01, undefined, !fog)}
      {t("Noise / wisps", "fogNoiseEnabled", !fog)}
      {r("Noise strength", "fogNoiseStrength", 0, 1, 0.01, undefined, !fog || !draft.fogNoiseEnabled)}
      {r("Noise scale", "fogNoiseScale", 0.001, 0.5, 0.001, undefined, !fog || !draft.fogNoiseEnabled)}
      {t("Fog movement", "fogMovementEnabled", !fog || !draft.fogNoiseEnabled)}
      {r("Wind direction", "fogWindDirectionDeg", 0, 360, 1, "°", !fog || !draft.fogMovementEnabled)}
      {r("Wind speed", "fogWindSpeed", 0, 0.5, 0.005, undefined, !fog || !draft.fogMovementEnabled)}
      {t("Sun interaction", "fogSunInteractionEnabled", !fog)}
    </Panel>
    <Panel title="Clouds">
      {t("Cloud movement", "cloudMovementEnabled", !clouds)}
      {t("Sun lighting", "cloudSunLightingEnabled", !clouds)}
      {t("Cloud shadows", "cloudShadowsEnabled", !clouds)}
      {r("Coverage", "cloudCoverage", 0, 1, 0.01, undefined, !clouds)}
      {r("Density", "cloudDensity", 0, 1, 0.01, undefined, !clouds)}
      {r("Height", "cloudHeight", 20, 1500, 5, "m", !clouds)}
      {r("Thickness", "cloudThickness", 5, 400, 5, "m", !clouds)}
      {r("Threshold", "cloudThreshold", 0, 1, 0.01, undefined, !clouds)}
      {r("Opacity", "cloudOpacity", 0, 1, 0.01, undefined, !clouds)}
      {r("Softness", "cloudSoftness", 0.01, 1, 0.01, undefined, !clouds)}
      {r("Scale", "cloudScale", 0.0005, 0.05, 0.0005, undefined, !clouds)}
      {r("Wind speed", "cloudWindSpeed", 0, 0.5, 0.005, undefined, !clouds)}
      {r("Wind direction", "cloudWindDirectionDeg", 0, 360, 1, "°", !clouds)}
      {r("Raymarch steps", "cloudRaymarchSteps", 1, 24, 1, undefined, !clouds)}
      {r("Elevation", "cloudElevation", 0, 1, 0.01, undefined, !clouds)}
    </Panel>
    <Panel title="Water">
      <Choice label="Type" value={draft.waterType} disabled={!water} options={options(["sea", "lake", "pool", "decorative"])} onChange={(waterType) => change({ waterType: waterType as Config["waterType"] })} />
      {t("Waves", "waterWavesEnabled", !water)}
      {t("Movement", "waterMovementEnabled", !water)}
      {t("Sun reflection", "waterSunReflectionEnabled", !water)}
      {t("Environment reflection", "waterEnvReflectionEnabled", !water)}
      {t("Normal map", "waterNormalMapEnabled", !water)}
      {r("Water height", "waterHeight", -100, 100, 0.5, "m", !water)}
      {r("Size", "waterSize", 0.1, 10, 0.1, undefined, !water)}
      {c("Water color", "waterColor", !water)}
      {c("Deep color", "waterDeepColor", !water)}
      {r("Distortion", "waterDistortionScale", 0, 8, 0.1, undefined, !water)}
    </Panel>
    <Panel title="Ground">
      <Choice label="Style" value={draft.groundStyle} disabled={!draft.groundEnabled} options={[{ value: "disc", label: "Disc (fits content)" }, { value: "infinite", label: "Infinite plane" }]} onChange={(groundStyle) => change({ groundStyle: groundStyle as Config["groundStyle"] })} />
    </Panel>
  </>;
}

function SolarAnchorsPanel({ draft, change }: ConfigProps) {
  const anchors = draft.solarAnchors;
  type Anchor = Config["solarAnchors"][number];
  const set = (id: string, patch: Partial<Anchor>) => change({ solarAnchors: anchors.map((anchor) => (anchor.id === id ? { ...anchor, ...patch } : anchor)) });
  const add = () => change({ solarAnchors: [...anchors, { id: crypto.randomUUID(), timeHours: 12, elevationDeg: draft.sunElevationDeg, azimuthDeg: draft.sunAzimuthDeg } as Anchor].sort((a, b) => a.timeHours - b.timeHours) });
  if (!draft.solarControllerEnabled || draft.solarPathMode !== "manual") return null;
  return <Panel title="Solar anchors">
    <Button type="button" variant="secondary" size="sm" onClick={add}><Plus aria-hidden="true" />Add anchor</Button>
    {anchors.map((anchor) => <div key={anchor.id} className="space-y-2 rounded border border-neutral-800 p-2">
      <Range label="Time" value={anchor.timeHours} min={0} max={24} step={0.25} suffix="h" onChange={(timeHours) => set(anchor.id, { timeHours })} />
      <Range label="Elevation" value={anchor.elevationDeg} min={-90} max={90} step={1} suffix="°" onChange={(elevationDeg) => set(anchor.id, { elevationDeg })} />
      <Range label="Azimuth" value={anchor.azimuthDeg} min={0} max={360} step={1} suffix="°" onChange={(azimuthDeg) => set(anchor.id, { azimuthDeg })} />
      <button type="button" className="text-[11px] text-red-300" onClick={() => change({ solarAnchors: anchors.filter((item) => item.id !== anchor.id) })}>Remove</button>
    </div>)}
  </Panel>;
}

/* --------------------------------------------------------------- Lighting */

export function LightingExtraPanels(props: ConfigProps) {
  const { draft, change } = props;
  const { t, r, c } = binders(props);
  const shadows = draft.shadowsEnabled;
  const csm = shadows && draft.csmEnabled;
  const contact = shadows && draft.contactShadowsEnabled;
  const gi = draft.giEnabled;
  const vol = draft.volumetricLightingEnabled;
  return <>
    <Panel title="Sun color">
      {t("Automatic color", "autoSunColorEnabled", !draft.sunLightEnabled)}
      {!draft.autoSunColorEnabled ? c("Color", "manualSunColorHex", !draft.sunLightEnabled) : null}
    </Panel>
    <Panel title="Shadows">
      {r("Softness", "shadowSoftness", 0, 10, 0.1, undefined, !shadows || !draft.softShadowsEnabled)}
      {r("CSM cascades", "csmCascades", 1, 4, 1, undefined, !csm)}
      {r("CSM max distance", "csmMaxDistance", 10, 2000, 10, "m", !csm)}
      <Choice label="CSM resolution" value={String(draft.csmResolution)} disabled={!csm} options={["512", "1024", "2048", "4096"].map((value) => ({ value, label: value }))} onChange={(value) => change({ csmResolution: Number(value) })} />
      <Choice label="CSM split mode" value={draft.csmSplitMode} disabled={!csm} options={options(["practical", "uniform", "logarithmic"])} onChange={(csmSplitMode) => change({ csmSplitMode: csmSplitMode as Config["csmSplitMode"] })} />
      {r("CSM margin", "csmMargin", 0, 1000, 10, "m", !csm)}
      {r("Contact blur", "contactShadowBlur", 0, 2, 0.05, undefined, !contact)}
      {r("Contact darkness", "contactShadowDarkness", 0, 1, 0.01, undefined, !contact)}
      {r("Contact opacity", "contactShadowOpacity", 0, 1, 0.01, undefined, !contact)}
      {r("Contact range", "contactShadowRange", 0.02, 5, 0.02, "m", !contact)}
      {t("Transmitted shadows", "transmittedShadowsEnabled", !shadows)}
      {t("Colored shadows", "coloredShadowsEnabled", !shadows || !draft.transmittedShadowsEnabled)}
      {r("Transmitted strength", "transmittedShadowStrength", 0, 1, 0.01, undefined, !shadows || !draft.transmittedShadowsEnabled)}
    </Panel>
    <Panel title="Global illumination">
      {t("Indirect lighting", "giIndirectEnabled", !gi)}
      {t("Ambient occlusion", "giAOEnabled", !gi)}
      {t("Backface lighting", "giBackfaceLighting", !gi)}
      {t("Temporal filtering", "giTemporalFiltering", !gi)}
      {t("Screen-space sampling", "giScreenSpaceSampling", !gi)}
      {r("GI intensity", "giIntensity", 0, 50, 0.5, undefined, !gi)}
      {r("AO intensity", "giAOIntensity", 0, 4, 0.05, undefined, !gi)}
      {r("Radius", "giRadius", 0.5, 50, 0.5, undefined, !gi)}
      {r("Slice count", "giSliceCount", 1, 4, 1, undefined, !gi)}
      {r("Step count", "giStepCount", 1, 32, 1, undefined, !gi)}
      {r("Exp factor", "giExpFactor", 0.5, 6, 0.1, undefined, !gi)}
      {r("Thickness", "giThickness", 0.05, 10, 0.05, undefined, !gi)}
      {t("Linear thickness", "giLinearThickness", !gi)}
    </Panel>
    <Panel title="Volumetric lighting">
      {t("Sun shafts", "sunShaftsEnabled", !vol)}
      {t("Light volumes", "lightVolumesEnabled", !vol)}
      {r("Density", "volumetricDensity", 0, 2, 0.02, undefined, !vol)}
      {r("Maximum density", "volumetricMaxDensity", 0, 2, 0.02, undefined, !vol)}
      {r("Distance attenuation", "volumetricDistanceAtten", 0, 10, 0.1, undefined, !vol)}
      {r("Raymarch steps", "volumetricRaymarchSteps", 8, 120, 1, undefined, !vol)}
    </Panel>
    <ArtificialLightsPanel {...props} />
  </>;
}

function ArtificialLightsPanel({ draft, change }: ConfigProps) {
  const lights = draft.artificialLights;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = lights.find((light) => light.id === selectedId) ?? null;
  const set = (id: string, patch: Partial<ArtificialLight>) => change({ artificialLights: lights.map((light) => (light.id === id ? { ...light, ...patch } : light)) });
  function add(type: ArtificialLight["type"]) {
    const light: ArtificialLight = { id: crypto.randomUUID(), name: `${type === "rect" ? "Area" : type.charAt(0).toUpperCase() + type.slice(1)} light ${lights.length + 1}`, type, enabled: true, shadowsEnabled: false, volumetricEnabled: false, helperEnabled: true, position: { x: 0, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 }, colorHex: "#ffffff", temperatureK: null, intensity: 50, distance: 0, decay: 2, angleDeg: 30, penumbra: 0.3, width: 2, height: 2, iesProfileUrl: null };
    change({ artificialLights: [...lights, light] });
    setSelectedId(light.id);
  }
  const vec = (label: string, key: "position" | "target", light: ArtificialLight) => (["x", "y", "z"] as const).map((axis) => <Range key={`${key}${axis}`} label={`${label} ${axis.toUpperCase()}`} value={light[key][axis]} min={axis === "y" ? -50 : -200} max={200} step={0.5} onChange={(value) => set(light.id, { [key]: { ...light[key], [axis]: value } })} />);
  return <Panel title="Artificial lights">
    <div className="flex flex-wrap gap-1">{(["point", "spot", "rect"] as const).map((type) => <Button key={type} type="button" size="sm" variant="secondary" onClick={() => add(type)}><Plus aria-hidden="true" />{type === "rect" ? "Area" : type}</Button>)}</div>
    {lights.map((light) => <div key={light.id} className={cn("flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px]", selectedId === light.id ? "border-indigo-500" : "border-neutral-800")}>
      <button type="button" className="min-w-0 flex-1 truncate text-left text-neutral-200" onClick={() => setSelectedId(light.id)}>{light.name}</button>
      <button type="button" aria-label={`Remove ${light.name}`} className="text-red-300" onClick={() => { change({ artificialLights: lights.filter((item) => item.id !== light.id) }); if (selectedId === light.id) setSelectedId(null); }}><Trash2 className="size-3.5" aria-hidden="true" /></button>
    </div>)}
    {selected ? <div className="space-y-3 border-t border-neutral-800 pt-3">
      <label className="block text-xs text-neutral-400"><span className="mb-1 block">Name</span><input className="h-8 w-full rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" value={selected.name} onChange={(event) => set(selected.id, { name: event.target.value })} /></label>
      <Toggle label="Light" value={selected.enabled} onChange={(enabled) => set(selected.id, { enabled })} />
      <Toggle label="Shadows" value={selected.shadowsEnabled} disabled={selected.type === "rect"} onChange={(shadowsEnabled) => set(selected.id, { shadowsEnabled })} />
      <Toggle label="Volumetric contribution" value={selected.volumetricEnabled} onChange={(volumetricEnabled) => set(selected.id, { volumetricEnabled })} />
      <Toggle label="Helper" value={selected.helperEnabled} onChange={(helperEnabled) => set(selected.id, { helperEnabled })} />
      {vec("Position", "position", selected)}
      {selected.type !== "point" ? vec("Target", "target", selected) : null}
      <Color label="Color" value={selected.colorHex} onChange={(colorHex) => set(selected.id, { colorHex, temperatureK: null })} />
      <Range label="Intensity" value={selected.intensity} min={0} max={1000} step={1} onChange={(intensity) => set(selected.id, { intensity })} />
      {selected.type !== "rect" ? <><Range label="Distance" value={selected.distance} min={0} max={2000} step={1} suffix="m" onChange={(distance) => set(selected.id, { distance })} /><Range label="Decay" value={selected.decay} min={0} max={4} step={0.1} onChange={(decay) => set(selected.id, { decay })} /></> : null}
      {selected.type === "spot" ? <><Range label="Angle" value={selected.angleDeg} min={0.1} max={89} step={1} suffix="°" onChange={(angleDeg) => set(selected.id, { angleDeg })} /><Range label="Penumbra" value={selected.penumbra} min={0} max={1} step={0.01} onChange={(penumbra) => set(selected.id, { penumbra })} /></> : null}
      {selected.type === "rect" ? <><Range label="Width" value={selected.width} min={0.01} max={500} step={0.1} onChange={(width) => set(selected.id, { width })} /><Range label="Height" value={selected.height} min={0.01} max={500} step={0.1} onChange={(height) => set(selected.id, { height })} /></> : null}
    </div> : null}
  </Panel>;
}

/* -------------------------------------------------------------- Rendering */

export function RenderingExtraPanels(props: ConfigProps) {
  const { draft, change } = props;
  const { t, r } = binders(props);
  return <>
    <Panel title="Bloom">
      {r("Radius", "bloomRadius", 0, 1, 0.05, undefined, !draft.bloomEnabled)}
    </Panel>
    <Panel title="Lens flare">
      {t("Lens flare", "lensFlareEnabled")}
      {r("Intensity", "lensFlareIntensity", 0, 3, 0.05, undefined, !draft.lensFlareEnabled)}
    </Panel>
    <Panel title="Depth of field">
      {t("Auto focus", "cameraAutoFocusEnabled", !draft.depthOfFieldEnabled)}
      {r("Focal length", "depthOfFieldFocalLength", 0.1, 100, 0.1, undefined, !draft.depthOfFieldEnabled)}
      {r("Bokeh scale", "depthOfFieldBokehScale", 0, 10, 0.1, undefined, !draft.depthOfFieldEnabled)}
    </Panel>
    <Panel title="Distance blur">
      {t("Distance blur", "distanceBlurEnabled")}
      {r("Sharp until", "distanceBlurStartM", 0, 1000, 5, "m", !draft.distanceBlurEnabled)}
      {r("Fully blurred at", "distanceBlurFullM", 0, 2000, 10, "m", !draft.distanceBlurEnabled)}
      {r("Amount", "distanceBlurAmount", 0, 1, 0.05, undefined, !draft.distanceBlurEnabled)}
      {r("Radius", "distanceBlurRadius", 0, 8, 0.25, undefined, !draft.distanceBlurEnabled)}
    </Panel>
    <Panel title="Motion blur">
      {r("Intensity", "motionBlurIntensity", 0, 3, 0.05, undefined, !draft.motionBlurEnabled)}
    </Panel>
    <Panel title="Screen-space reflections">
      {r("Intensity", "ssrIntensity", 0, 3, 0.05, undefined, !draft.ssrEnabled)}
      {r("Max distance", "ssrMaxDistance", 1, 200, 1, undefined, !draft.ssrEnabled)}
      {r("Thickness", "ssrThickness", 0.01, 5, 0.01, undefined, !draft.ssrEnabled)}
      {r("Quality", "ssrQuality", 0, 1, 0.05, undefined, !draft.ssrEnabled)}
    </Panel>
    <Panel title="LUT and depth">
      <Choice label="LUT preset" value={draft.lutPreset} disabled={!draft.lutEnabled} options={LUT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))} onChange={(lutPreset) => change({ lutPreset: lutPreset as Config["lutPreset"] })} />
      <Choice label="Glass preset" value={draft.glassPreset} options={options(["performance", "standard", "premium"])} onChange={(glassPreset) => change({ glassPreset: glassPreset as Config["glassPreset"] })} />
      {t("Logarithmic depth", "logarithmicDepthEnabled")}
      {t("Loading reveal", "loadingRevealEnabled")}
    </Panel>
  </>;
}

/* ----------------------------------------------------------------- Camera */

export function CameraExtraPanels(props: ConfigProps) {
  const { draft, change } = props;
  const { t, r } = binders(props);
  const azimuthLimited = draft.cameraMinAzimuthDeg !== null || draft.cameraMaxAzimuthDeg !== null;
  const motionOff = !draft.idleDroneEnabled || !draft.idleDroneMotionEnabled;
  return <>
    <Panel title="Camera tools">
      {t("Auto focus", "cameraAutoFocusEnabled")}
      {t("Camera helper", "cameraHelperEnabled")}
      {r("Sensor / film gate", "cameraSensorWidthMm", 10, 70, 1, "mm")}
    </Panel>
    <Panel title="Distance limits">
      {r("Start distance", "cameraStartDistanceMultiplier", 0.1, 10, 0.1, "×")}
      {r("Min distance", "cameraMinDistanceMultiplier", 0.05, 10, 0.05, "×")}
      {r("Max distance", "cameraMaxDistanceMultiplier", 0.5, 20, 0.1, "×")}
    </Panel>
    <Panel title="Angle limits">
      {r("Min polar", "cameraMinPolarDeg", 0, 180, 1, "°")}
      {r("Max polar", "cameraMaxPolarDeg", 0, 180, 1, "°")}
      <Toggle label="Limit azimuth" value={azimuthLimited} onChange={(on) => change(on ? { cameraMinAzimuthDeg: -90, cameraMaxAzimuthDeg: 90 } : { cameraMinAzimuthDeg: null, cameraMaxAzimuthDeg: null })} />
      {azimuthLimited ? <>
        <Range label="Min azimuth" value={draft.cameraMinAzimuthDeg ?? -90} min={-180} max={180} step={1} suffix="°" onChange={(cameraMinAzimuthDeg) => change({ cameraMinAzimuthDeg })} />
        <Range label="Max azimuth" value={draft.cameraMaxAzimuthDeg ?? 90} min={-180} max={180} step={1} suffix="°" onChange={(cameraMaxAzimuthDeg) => change({ cameraMaxAzimuthDeg })} />
      </> : null}
    </Panel>
    <Panel title="Drone motion">
      <Choice label="Direction" value={draft.idleDroneClockwise ? "cw" : "ccw"} disabled={!draft.idleDroneEnabled} options={[{ value: "cw", label: "Clockwise" }, { value: "ccw", label: "Counter-clockwise" }]} onChange={(value) => change({ idleDroneClockwise: value === "cw" })} />
      {t("Drone motion", "idleDroneMotionEnabled", !draft.idleDroneEnabled)}
      {t("Vertical movement", "idleDroneHeightEnabled", motionOff)}
      {r("Vertical amount", "idleDroneHeightAmplitude", 0, 0.5, 0.01, undefined, motionOff)}
      {r("Vertical cycles", "idleDroneVerticalCycles", 1, 6, 1, undefined, motionOff)}
      {t("Distance movement", "idleDroneDistanceEnabled", motionOff)}
      {r("Distance amount", "idleDroneDistanceAmplitude", 0, 0.25, 0.01, undefined, motionOff)}
      {t("Target movement", "idleDroneTargetEnabled", motionOff)}
      {r("Target amount", "idleDroneTargetAmplitude", 0, 0.25, 0.01, undefined, motionOff)}
      {r("Phase offset", "idleDronePhaseOffsetDeg", 0, 360, 1, "°", motionOff)}
      {r("Smoothness", "idleDroneSmoothness", 0, 1, 0.01, undefined, motionOff)}
    </Panel>
  </>;
}

/* ------------------------------------------------------------ Performance */

export function PerformanceExtraPanels(props: ConfigProps) {
  const { draft, change } = props;
  const { t } = binders(props);
  const custom = draft.qualityPreset === "custom";
  return <Panel title="More quality">
    {t("Device detection", "deviceDetectionEnabled")}
    {t("Runtime quality reduction", "runtimeQualityReductionEnabled", !draft.adaptiveQualityEnabled)}
    <Range label="Render scale (custom)" value={draft.customRenderScale ?? 1} min={0.1} max={2} step={0.05} suffix="×" disabled={!custom} onChange={(customRenderScale) => change({ customRenderScale })} />
    <Range label="Pixel ratio limit (custom)" value={draft.customDprCap ?? 2} min={0.5} max={3} step={0.05} suffix="×" disabled={!custom} onChange={(customDprCap) => change({ customDprCap })} />
  </Panel>;
}

/* -------------------------------------------------------------------- Map */

export function MapPanels(props: ConfigProps) {
  const { draft, change } = props;
  const { t, r } = binders(props);
  const site = draft.siteEnabled;
  const coordinate = (label: string, key: "mapViewLatitude" | "mapViewLongitude") => <label className="block text-xs text-neutral-400"><span className="mb-1 block">{label}</span><input type="number" step="0.000001" className="h-8 w-full rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" value={draft[key] ?? ""} onChange={(event) => { const value = event.target.value === "" ? null : Number(event.target.value); change({ [key]: value === null || Number.isFinite(value) ? value : draft[key] }); }} /></label>;
  return <>
    <Panel title="Location">
      {coordinate("Latitude", "mapViewLatitude")}
      {coordinate("Longitude", "mapViewLongitude")}
      {r("Altitude", "mapViewAltitude", -100, 2000, 1, "m")}
    </Panel>
    <Panel title="Real-world site">
      {t("Show real-world site", "siteEnabled", draft.mapViewLatitude === null || draft.mapViewLongitude === null)}
      {r("Radius", "siteRadiusM", 100, 3000, 50, "m", !site)}
      {t("Terrain", "siteTerrainEnabled", !site)}
      {t("Aerial imagery", "siteImageryEnabled", !site)}
      {r("Imagery brightness", "siteImageryBrightness", 0, 2, 0.05, undefined, !site || !draft.siteImageryEnabled)}
      {r("Rotate", "siteRotationDeg", -180, 180, 0.5, "°", !site)}
      {r("Move east / west", "siteOffsetX", -500, 500, 0.5, "m", !site)}
      {r("Move north / south", "siteOffsetZ", -500, 500, 0.5, "m", !site)}
      {r("Height", "siteElevationOffset", -100, 100, 0.1, "m", !site)}
      {r("Scale", "siteScale", 0.5, 2, 0.01, "×", !site)}
      <Button type="button" variant="secondary" size="sm" disabled={!site} onClick={() => change({ siteRotationDeg: 0, siteOffsetX: 0, siteOffsetZ: 0, siteElevationOffset: 0, siteScale: 1 })}>Reset site alignment</Button>
    </Panel>
    <Panel title="Map view">
      {t("Map view", "mapViewEnabled")}
      {r("Heading", "mapViewHeadingDeg", -180, 180, 1, "°", !draft.mapViewEnabled)}
      {r("Scale", "mapViewScale", 0.1, 10, 0.05, "×", !draft.mapViewEnabled)}
      {r("Zoom", "mapViewZoom", 10, 22, 0.1, undefined, !draft.mapViewEnabled)}
      {r("Pitch", "mapViewPitchDeg", 0, 85, 1, "°", !draft.mapViewEnabled)}
      {r("Bearing", "mapViewBearingDeg", -180, 180, 1, "°", !draft.mapViewEnabled)}
    </Panel>
  </>;
}

/* ---------------------------------------------------------------- Presets */

type Preset = { id: string; name: string; configuration: unknown; updatedAt: string };
const PRESETS_API = `${PROJECT_3D_PLATFORM_API_ROOT}/presets`;

/**
 * Environment presets shared across the platform. Applying one changes only
 * this draft; camera, quality, ground, units, sections and shadows are kept.
 */
export function PresetsPanel({ draft, change, canEdit }: ConfigProps & { canEdit: boolean }) {
  const [presets, setPresets] = React.useState<Preset[] | null>(null);
  const [name, setName] = React.useState("");
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setPresets(await engineeringApi<Preset[]>(PRESETS_API));
    } catch (failure) {
      setError(failureMessage(failure, "The presets could not be loaded."));
      setPresets([]);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failureMessage(failure, fallback));
    } finally {
      setBusy(false);
    }
  }

  const saveNew = () => run(async () => {
    await engineeringApi(PRESETS_API, { body: { name: name.trim(), configuration: pickEnvironmentPresetConfig(draft) } });
    setName("");
  }, "The preset could not be saved.");

  return <Panel title="Environment presets">
    <p className="text-[11px] leading-4 text-neutral-500">A preset holds sun, sky, time of day, backdrop, fog, clouds, water, bloom, lens flare and color grading. Applying one changes this draft only; Save keeps it.</p>
    {canEdit ? <div className="flex gap-2">
      <input className="h-8 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" placeholder="New preset name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      <Button type="button" size="sm" variant="secondary" disabled={busy || !name.trim()} onClick={() => void saveNew()}>Save</Button>
    </div> : null}
    {presets === null ? <p className="text-xs text-neutral-500">Loading presets…</p> : presets.length === 0 ? <p className="text-xs text-neutral-500">No presets yet.</p> : null}
    {presets?.map((preset) => <div key={preset.id} className="space-y-2 rounded border border-neutral-800 p-2 text-xs">
      {renaming?.id === preset.id ? <div className="flex gap-2">
        <input className="h-7 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" value={renaming.name} maxLength={80} onChange={(event) => setRenaming({ id: preset.id, name: event.target.value })} />
        <Button type="button" size="sm" variant="secondary" disabled={busy || !renaming.name.trim()} onClick={() => void run(async () => { await engineeringApi(`${PRESETS_API}/${preset.id}`, { method: "PATCH", body: { name: renaming.name.trim() } }); setRenaming(null); }, "The preset could not be renamed.")}>OK</Button>
      </div> : <p className="truncate font-medium text-neutral-200">{preset.name}</p>}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <button type="button" className="text-indigo-300" disabled={busy} onClick={() => change(environmentPresetPatch(preset.configuration))}>Apply</button>
        {canEdit ? <>
          <button type="button" className="text-neutral-300" disabled={busy} onClick={() => void run(() => engineeringApi(`${PRESETS_API}/${preset.id}`, { method: "PATCH", body: { configuration: pickEnvironmentPresetConfig(draft) } }), "The preset could not be updated.")}>Overwrite with current</button>
          <button type="button" className="text-neutral-300" disabled={busy} onClick={() => setRenaming({ id: preset.id, name: preset.name })}>Rename</button>
          <button type="button" className="text-red-300" disabled={busy} onClick={() => void run(() => engineeringApi(`${PRESETS_API}/${preset.id}`, { method: "DELETE" }), "The preset could not be deleted.")}>Delete</button>
        </> : null}
      </div>
    </div>)}
    {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
  </Panel>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="flex items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5">
    <Search className="size-3.5 shrink-0 text-neutral-500" aria-hidden="true" />
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="w-full bg-transparent text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none" />
  </div>;
}
