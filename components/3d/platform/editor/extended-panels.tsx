"use client";

import * as React from "react";
import { Compass, LoaderCircle, MapPin, Plus, RotateCcw, ScanSearch, Search, Trash2, TriangleAlert, Upload, UploadCloud } from "@/components/icons";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { Button } from "@/components/ui/button";
import { PROJECT_3D_PLATFORM_API_ROOT } from "@/lib/3d/platform";
import { LUT_PRESETS, pickDefaultQualityTier, QUALITY_TIERS } from "@/lib/3d/runtime/viewerPresets";
import type { ArtificialLight, Project3DConfig, ViewerUIToggles } from "@/lib/3d/runtime/types";
import { ENVIRONMENT_PRESET_KEYS, environmentPresetPatch, pickEnvironmentPresetConfig } from "@/lib/3d/shared/environment-presets";
import type { Project3DNodeOverride, Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { cn } from "@/lib/utils/cn";
import { platformEnvironmentBase, resolveEnvironmentRefs } from "@/lib/3d/shared/environment-refs";
import { uploadEnvironmentAsset } from "./environment-upload";
import { Choice, Color, Panel, Range, Toggle } from "./controls";
import { useEditorNodeWord, useEditorWord } from "./editor-text";

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

function options(values: string[], text: (label: string) => string) {
  return values.map((value) => ({ value, label: text(value.charAt(0).toUpperCase() + value.slice(1)) }));
}

/* ------------------------------------------------------------------ Units */

export function UnitStylePanels({ draft, change, statusPreview, onStatusPreview }: ConfigProps & { statusPreview: boolean; onStatusPreview: (value: boolean) => void }) {
  const editorServerText = useEditorWord();
  const { t, r, c } = binders({ draft, change });
  const blocks = draft.unitBlocksEnabled;
  return <>
    <Panel title={editorServerText("Unit blocks")}>
      {t(editorServerText("Unit blocks"), "unitBlocksEnabled")}
      <Toggle label={editorServerText("Status preview (editor only)")} value={statusPreview} onChange={onStatusPreview} />
      <p className="text-[11px] leading-4 text-fg-subtle">{editorServerText("Status preview shows the unit blocks in this viewport. Click a block to see its selected style.")}</p>
    </Panel>
    <Panel title={editorServerText("Appearance")}>
      {t(editorServerText("Status colors"), "unitBlocksStatusColorsEnabled", !blocks)}
      {t("X-Ray", "unitBlocksXrayEnabled", !blocks)}
      {r(editorServerText("Default opacity"), "unitBlocksDefaultOpacity", 0, 1, 0.01, undefined, !blocks)}
      {r(editorServerText("Hover opacity"), "unitBlocksHoverOpacity", 0, 1, 0.01, undefined, !blocks)}
      {r(editorServerText("Selected opacity"), "unitBlocksSelectedOpacity", 0, 1, 0.01, undefined, !blocks)}
    </Panel>
    <Panel title={editorServerText("Selected unit")}>
      {t(editorServerText("Outline"), "unitBlocksSelectedOutlineEnabled", !blocks)}
      {draft.unitBlocksSelectedOutlineEnabled ? r(editorServerText("Outline width"), "unitBlocksSelectedOutlineWidth", 0.5, 20, 0.5, "px", !blocks) : null}
      {t(editorServerText("Enlarge"), "unitBlocksSelectedScaleEnabled", !blocks)}
      {draft.unitBlocksSelectedScaleEnabled ? r(editorServerText("Enlarge scale"), "unitBlocksSelectedScale", 1, 1.5, 0.01, "×", !blocks) : null}
      {t(editorServerText("Fill"), "unitBlocksSelectedFillEnabled", !blocks)}
      {t("X-Ray", "unitBlocksSelectedXrayEnabled", !blocks)}
    </Panel>
    <Panel title={editorServerText("Colors")}>
      {c(editorServerText("Available"), "unitColorAvailable")}
      {c(editorServerText("Reserved"), "unitColorReserved")}
      {c(editorServerText("Sold"), "unitColorSold")}
      {c(editorServerText("Selected outline"), "unitColorSelected")}
      {c(editorServerText("Selected fill"), "unitColorSelectedFill")}
    </Panel>
    <Panel title={editorServerText("Unit camera")}>
      {t(editorServerText("Unit camera"), "unitPoiCameraEnabled")}
      {r("FOV", "unitPoiCameraFov", 10, 90, 1, "°", !draft.unitPoiCameraEnabled)}
      {r(editorServerText("Distance"), "unitPoiCameraDistanceMultiplier", 0.5, 10, 0.1, "×", !draft.unitPoiCameraEnabled)}
      {r(editorServerText("Height"), "unitPoiCameraHeightOffset", -10, 10, 0.1, "m", !draft.unitPoiCameraEnabled)}
      {r(editorServerText("Transition"), "unitPoiTransitionMs", 0, 3000, 50, "ms", !draft.unitPoiCameraEnabled)}
      {t(editorServerText("Auto occlusion correction"), "unitPoiAutoOcclusionCorrection", !draft.unitPoiCameraEnabled)}
    </Panel>
    <Panel title={editorServerText("Caustics")}>
      {t(editorServerText("Caustics"), "causticsEnabled")}
      {r(editorServerText("Scale"), "causticsScale", 0.05, 5, 0.05, undefined, !draft.causticsEnabled)}
      {r(editorServerText("Speed"), "causticsSpeed", 0, 2, 0.01, undefined, !draft.causticsEnabled)}
      {r(editorServerText("Available intensity"), "causticsIntensityAvailable", 0, 3, 0.05, undefined, !draft.causticsEnabled)}
      {r(editorServerText("Reserved intensity"), "causticsIntensityReserved", 0, 3, 0.05, undefined, !draft.causticsEnabled)}
      {r(editorServerText("Sold intensity"), "causticsIntensitySold", 0, 3, 0.05, undefined, !draft.causticsEnabled)}
    </Panel>
  </>;
}

export type EditorUnitRow = { id: string; code: string; status: "available" | "reserved" | "sold"; linked: boolean };

/** Every project unit with its status; Select previews the selected style, Test camera flies the unit camera. */
export function UnitListPanel({ units, selectedUnitId, onSelect, onTestCamera }: { units: EditorUnitRow[]; selectedUnitId: string | null; onSelect: (unitId: string | null) => void; onTestCamera: (unitId: string) => void }) {
  const editorServerText = useEditorWord();
  const [query, setQuery] = React.useState("");
  const shown = units.filter((unit) => unit.code.toLowerCase().includes(query.trim().toLowerCase()));
  const tone = { available: "text-success-strong", reserved: "text-warning-strong", sold: "text-danger-strong" } as const;
  return <Panel title={editorServerText("Units ({0})", units.length)}>
    <SearchBox value={query} onChange={setQuery} placeholder={editorServerText("Search units…")} />
    <div className="max-h-72 space-y-1 overflow-y-auto">
      {shown.map((unit) => <div key={unit.id} className={cn("flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-[11px]", selectedUnitId === unit.id ? "border-accent bg-accent-soft" : "border-line")}>
        <button type="button" className="min-w-0 flex-1 truncate text-left text-fg" onClick={() => onSelect(selectedUnitId === unit.id ? null : unit.id)}>{unit.code}</button>
        <span className={cn("capitalize", tone[unit.status])}>{editorServerText(unit.status)}</span>
        {unit.linked ? <button type="button" className="rounded border border-line-strong px-1.5 py-0.5 text-fg-muted hover:bg-surface-muted" onClick={() => onTestCamera(unit.id)}>{editorServerText("Test camera")}</button> : <span className="text-fg-subtle">{editorServerText("not linked")}</span>}
      </div>)}
    </div>
  </Panel>;
}

/* ------------------------------------------------------------ Interaction */

export function InteractionPanels({ draft, change }: ConfigProps) {
  const editorServerText = useEditorWord();
  const ui = draft.viewerUI;
  const set = (patch: Partial<ViewerUIToggles>) => change({ viewerUI: { ...ui, ...patch } });
  const toggle = (label: string, key: keyof ViewerUIToggles, disabled?: boolean) => <Toggle key={key} label={label} value={ui[key] !== false} disabled={disabled} onChange={(value) => set({ [key]: value })} />;
  const filtersOff = ui.filtersEnabled === false;
  return <>
    <Panel title={editorServerText("Units")}>
      {toggle(editorServerText("Unit interaction"), "unitInteractionEnabled")}
      {toggle(editorServerText("Hover"), "hoverEnabled")}
      {toggle(editorServerText("Select"), "selectEnabled")}
      {toggle(editorServerText("Highlight"), "highlightEnabled")}
      {toggle(editorServerText("Status colors"), "statusColorsEnabled")}
      {toggle(editorServerText("Isolation"), "isolationEnabled")}
      {toggle(editorServerText("Floor isolation"), "floorIsolationEnabled")}
      {toggle(editorServerText("Information card"), "showUnitInfo")}
      {toggle(editorServerText("Unit page link"), "unitPageLinkEnabled")}
    </Panel>
    <Panel title={editorServerText("Filters")}>
      {toggle(editorServerText("Filters"), "filtersEnabled")}
      {toggle(editorServerText("Floor"), "filterFloorEnabled", filtersOff)}
      {toggle(editorServerText("Availability"), "filterAvailabilityEnabled", filtersOff)}
      {toggle(editorServerText("Bedrooms"), "filterBedroomsEnabled", filtersOff)}
      {toggle(editorServerText("Type"), "filterTypeEnabled", filtersOff)}
      {toggle(editorServerText("Price"), "filterPriceEnabled", filtersOff)}
    </Panel>
    <Panel title={editorServerText("Viewer controls")}>
      {toggle(editorServerText("Home"), "home")}
      {toggle(editorServerText("Unit search"), "unitSearch")}
      {toggle(editorServerText("Reset"), "resetEnabled")}
      {toggle(editorServerText("Fullscreen"), "fullscreenEnabled")}
      {toggle(editorServerText("Shots menu"), "shotsMenuEnabled")}
      {toggle(editorServerText("Sections"), "sectionsEnabled")}
      {toggle(editorServerText("Sun presets"), "sunPresetEnabled")}
      {toggle(editorServerText("Screenshot"), "screenshotEnabled")}
      {toggle(editorServerText("Share"), "shareEnabled")}
    </Panel>
  </>;
}

/* -------------------------------------------------------------- Materials */

export function MaterialNodeList({ nodes, selectedNodeId, overriddenIds, onSelect }: { nodes: Project3DSceneNode[]; selectedNodeId: string | null; overriddenIds: Set<string>; onSelect: (nodeId: string) => void }) {
  const editorServerText = useEditorWord();
  const [query, setQuery] = React.useState("");
  const shown = nodes.filter((node) => node.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <Panel title={editorServerText("Mesh search")}>
    <SearchBox value={query} onChange={setQuery} placeholder={editorServerText("Search meshes…")} />
    <div className="max-h-40 overflow-y-auto rounded border border-line">
      {shown.map((node) => <button key={node.nodeId} type="button" onClick={() => onSelect(node.nodeId)} className={cn("flex w-full items-center gap-1.5 border-b border-line px-2 py-1.5 text-left text-[11px] last:border-b-0", selectedNodeId === node.nodeId ? "bg-accent/15 text-fg" : "text-fg-muted hover:bg-surface")}>
        <span className={cn("size-1.5 shrink-0 rounded-full", overriddenIds.has(node.nodeId) ? "bg-accent" : "bg-transparent")} />
        <span className="truncate">{node.name}</span>
      </button>)}
      {shown.length === 0 ? <p className="p-2 text-[11px] text-fg-subtle">{editorServerText("No meshes match.")}</p> : null}
    </div>
  </Panel>;
}

export function MaterialExtraPanels({ override, change, onRestore, disabled }: { override: Project3DNodeOverride | null; change: (patch: Partial<Project3DNodeOverride>) => void; onRestore: () => void; disabled: boolean }) {
  const editorServerText = useEditorWord();
  const o = override ?? ({} as Partial<Project3DNodeOverride>);
  const off = disabled || o.materialOverrideEnabled === false;
  const t = (label: string, value: boolean, patch: (value: boolean) => Partial<Project3DNodeOverride>, extraOff?: boolean) => <Toggle label={label} value={value} disabled={off || extraOff} onChange={(next) => change(patch(next))} />;
  const r = (label: string, value: number, min: number, max: number, step: number, patch: (value: number) => Partial<Project3DNodeOverride>, extraOff?: boolean, suffix?: string) => <Range label={label} value={value} min={min} max={max} step={step} suffix={suffix} disabled={off || extraOff} onChange={(next) => change(patch(next))} />;
  const c = (label: string, value: string, patch: (value: string) => Partial<Project3DNodeOverride>, extraOff?: boolean) => <Color label={label} value={value} disabled={off || extraOff} onChange={(next) => change(patch(next))} />;
  const glassOff = !o.transmissionEnabled;
  return <>
    <Button type="button" variant="secondary" size="sm" disabled={disabled || !override} onClick={onRestore}><RotateCcw aria-hidden="true" />{editorServerText("Restore original")}</Button>
    <Panel title={editorServerText("Texture maps")}>
      {t(editorServerText("Base texture"), o.baseTextureEnabled !== false, (baseTextureEnabled) => ({ baseTextureEnabled }))}
      {t(editorServerText("Roughness map"), o.roughnessMapEnabled !== false, (roughnessMapEnabled) => ({ roughnessMapEnabled }))}
      {t(editorServerText("Metalness map"), o.metalnessMapEnabled !== false, (metalnessMapEnabled) => ({ metalnessMapEnabled }))}
      {t(editorServerText("Normal map"), o.normalMapEnabled !== false, (normalMapEnabled) => ({ normalMapEnabled }))}
      {r(editorServerText("Normal strength"), o.normalStrength ?? 1, 0, 4, 0.05, (normalStrength) => ({ normalStrength }))}
      {t(editorServerText("AO map"), o.aoMapEnabled !== false, (aoMapEnabled) => ({ aoMapEnabled }))}
    </Panel>
    <Panel title={editorServerText("Emissive")}>
      {t(editorServerText("Emissive"), Boolean(o.emissiveEnabled), (emissiveEnabled) => ({ emissiveEnabled }))}
      {t(editorServerText("Emissive map"), o.emissiveMapEnabled !== false, (emissiveMapEnabled) => ({ emissiveMapEnabled }), !o.emissiveEnabled)}
      {c(editorServerText("Color"), o.emissiveColorHex ?? "#ffffff", (emissiveColorHex) => ({ emissiveColorHex }), !o.emissiveEnabled)}
      {r(editorServerText("Intensity"), o.emissiveIntensity ?? 1, 0, 20, 0.1, (emissiveIntensity) => ({ emissiveIntensity }), !o.emissiveEnabled)}
    </Panel>
    <Panel title={editorServerText("Glass")}>
      {r(editorServerText("Transmission"), o.transmission ?? 1, 0, 1, 0.01, (transmission) => ({ transmission }), glassOff)}
      {r("IOR", o.ior ?? 1.5, 1, 2.333, 0.01, (ior) => ({ ior }), glassOff)}
      {r(editorServerText("Thickness"), o.thickness ?? 1, 0, 100, 0.5, (thickness) => ({ thickness }), glassOff)}
      {t(editorServerText("Attenuation"), Boolean(o.attenuationEnabled), (attenuationEnabled) => ({ attenuationEnabled }), glassOff)}
      {c(editorServerText("Attenuation color"), o.attenuationColorHex ?? "#ffffff", (attenuationColorHex) => ({ attenuationColorHex }), glassOff || !o.attenuationEnabled)}
      {r(editorServerText("Attenuation distance"), o.attenuationDistance ?? 1, 0, 50, 0.5, (attenuationDistance) => ({ attenuationDistance }), glassOff || !o.attenuationEnabled)}
    </Panel>
    <Panel title={editorServerText("Physical")}>
      {r(editorServerText("Clearcoat roughness"), o.clearcoatRoughness ?? 0, 0, 1, 0.01, (clearcoatRoughness) => ({ clearcoatRoughness }))}
      {r(editorServerText("Anisotropy"), o.anisotropy ?? 0, 0, 1, 0.01, (anisotropy) => ({ anisotropy }))}
      {r(editorServerText("Anisotropy rotation"), o.anisotropyRotation ?? 0, 0, 360, 1, (anisotropyRotation) => ({ anisotropyRotation }), false, "°")}
      {r(editorServerText("Sheen"), o.sheen ?? 0, 0, 1, 0.01, (sheen) => ({ sheen }))}
      {c(editorServerText("Sheen color"), o.sheenColorHex ?? "#ffffff", (sheenColorHex) => ({ sheenColorHex }))}
      {r(editorServerText("Sheen roughness"), o.sheenRoughness ?? 0, 0, 1, 0.01, (sheenRoughness) => ({ sheenRoughness }))}
      {r(editorServerText("Iridescence"), o.iridescence ?? 0, 0, 1, 0.01, (iridescence) => ({ iridescence }))}
      {r(editorServerText("Iridescence IOR"), o.iridescenceIOR ?? 1.3, 1, 2.333, 0.01, (iridescenceIOR) => ({ iridescenceIOR }))}
      {r(editorServerText("Dispersion"), o.dispersion ?? 0, 0, 1, 0.01, (dispersion) => ({ dispersion }))}
    </Panel>
    <Panel title={editorServerText("Texture transform")}>
      {t(editorServerText("Texture transform"), Boolean(o.textureTransformEnabled), (textureTransformEnabled) => ({ textureTransformEnabled }))}
      {r(editorServerText("Scale X"), o.mapScaleX ?? 1, 0.1, 10, 0.1, (mapScaleX) => ({ mapScaleX }), !o.textureTransformEnabled)}
      {r(editorServerText("Scale Y"), o.mapScaleY ?? 1, 0.1, 10, 0.1, (mapScaleY) => ({ mapScaleY }), !o.textureTransformEnabled)}
      {r(editorServerText("Offset X"), o.mapOffsetX ?? 0, -1, 1, 0.01, (mapOffsetX) => ({ mapOffsetX }), !o.textureTransformEnabled)}
      {r(editorServerText("Offset Y"), o.mapOffsetY ?? 0, -1, 1, 0.01, (mapOffsetY) => ({ mapOffsetY }), !o.textureTransformEnabled)}
      {r(editorServerText("Rotation"), o.mapRotation ?? 0, 0, 360, 1, (mapRotation) => ({ mapRotation }), !o.textureTransformEnabled, "°")}
    </Panel>
  </>;
}

/* ------------------------------------------------------------ Environment */

/** The Rozaris Sun & Sky "360° Backdrop Photo" group, uploading to the Project's private 3D storage. */
function BackdropPanel({ draft, change, projectId }: ConfigProps & { projectId: string }) {
  const editorServerText = useEditorWord();
  const input = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const preview = resolveEnvironmentRefs({ backdropImageUrl: draft.backdropImageUrl }, platformEnvironmentBase(projectId)).backdropImageUrl;

  async function handleFile(file: File) {
    if (file.type !== "image/png") return setError(editorServerText("Must be a PNG (the transparent-sky technique needs a real alpha channel)."));
    setError(null);
    setUploading(0);
    try {
      const ref = await uploadEnvironmentAsset(projectId, "backdrop", file, setUploading);
      change({ backdropImageUrl: ref, backdropEnabled: true });
    } catch (failure) {
      setError(failureMessage(failure, editorServerText("Upload failed.")));
    } finally {
      setUploading(null);
    }
  }

  return <Panel title={editorServerText("360° backdrop photo")}>
    <p className="text-[10px] leading-snug text-fg-subtle">{editorServerText("An equirectangular (2:1) 360° photo of the real site surroundings, exported as a PNG with the sky area made transparent — the physical Sky above keeps showing through the transparent pixels, so the real sun/time-of-day still drive the lighting.")}</p>
    {error ? <p role="alert" className="rounded bg-danger-soft px-2 py-1 text-[10px] font-medium text-danger-strong">{error}</p> : null}
    {/* eslint-disable-next-line @next/next/no-img-element -- a private, authenticated editor asset */}
    {preview ? <img src={preview} alt="" className="h-20 w-full rounded-md border border-line object-cover" /> : null}
    <input ref={input} type="file" accept="image/png" className="hidden" aria-label={editorServerText("360° backdrop photo")} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ""; }} />
    <button type="button" disabled={uploading !== null} onClick={() => input.current?.click()} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong py-1.5 text-[11px] font-semibold text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-50">
      <Upload className="h-3.5 w-3.5" />
      {uploading !== null ? editorServerText("Uploading… {0}%", uploading) : draft.backdropImageUrl ? editorServerText("Replace Photo") : editorServerText("Upload Photo")}
    </button>
    {draft.backdropImageUrl ? <>
      <Toggle label={editorServerText("360° Backdrop")} value={draft.backdropEnabled} onChange={(backdropEnabled) => change({ backdropEnabled })} />
      <Range label={editorServerText("Move Left / Right")} value={draft.backdropRotationDeg} min={-180} max={180} step={1} suffix="°" disabled={!draft.backdropEnabled} onChange={(backdropRotationDeg) => change({ backdropRotationDeg })} />
      <Range label={editorServerText("Tilt Up / Down")} value={draft.backdropPitchDeg} min={-90} max={90} step={1} suffix="°" disabled={!draft.backdropEnabled} onChange={(backdropPitchDeg) => change({ backdropPitchDeg })} />
      <Range label={editorServerText("Elevation")} value={draft.backdropElevation} min={-500} max={500} step={1} disabled={!draft.backdropEnabled} onChange={(backdropElevation) => change({ backdropElevation })} />
      <p className="text-[10px] leading-snug text-fg-subtle">{editorServerText("Tilt rotates the photo (fixes a level-but-wrong-angle horizon). Elevation raises/lowers it instead — use when the horizon is already level but the photo was shot from a different height than the model's own ground.")}</p>
      {draft.backdropRotationDeg !== 0 || draft.backdropPitchDeg !== 0 || draft.backdropElevation !== 0 ? <button type="button" onClick={() => change({ backdropRotationDeg: 0, backdropPitchDeg: 0, backdropElevation: 0 })} className="w-full py-1 text-center text-[10px] font-semibold text-fg-subtle hover:text-fg-muted">{editorServerText("Reset position")}</button> : null}
      <button type="button" onClick={() => change({ backdropImageUrl: null, backdropEnabled: false, backdropRotationDeg: 0, backdropPitchDeg: 0, backdropElevation: 0 })} className="flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[10px] font-semibold text-danger-strong hover:bg-danger-soft"><Trash2 className="h-3 w-3" /> {editorServerText("Remove Photo")}</button>
    </> : null}
  </Panel>;
}

export function EnvironmentExtraPanels(props: ConfigProps & { projectId: string }) {
  const editorServerText = useEditorWord();
  const { draft, change } = props;
  const { t, r, c } = binders(props);
  const fog = draft.fogEnabled;
  const clouds = draft.cloudsEnabled;
  const water = draft.waterEnabled;
  return <>
    <Panel title={editorServerText("Solar controller")}>
      {t(editorServerText("Solar controller"), "solarControllerEnabled")}
      <Choice label={editorServerText("Solar path")} value={draft.solarPathMode} options={[{ value: "manual", label: editorServerText("Manual") }, { value: "geographic", label: editorServerText("Geographic") }]} disabled={!draft.solarControllerEnabled} onChange={(solarPathMode) => change({ solarPathMode: solarPathMode as Config["solarPathMode"] })} />
      {t(editorServerText("Viewer time control"), "viewerTimeControlEnabled", !draft.solarControllerEnabled)}
      {r(editorServerText("Viewer time"), "viewerTimeHours", 0, 24, 0.25, "h", !draft.solarControllerEnabled)}
      {r(editorServerText("Start time"), "viewerTimeStartHours", 0, 24, 1, "h", !draft.solarControllerEnabled)}
      {r(editorServerText("End time"), "viewerTimeEndHours", 0, 24, 1, "h", !draft.solarControllerEnabled)}
      {r(editorServerText("Time step"), "viewerTimeStepMinutes", 15, 360, 15, "min", !draft.solarControllerEnabled)}
      {r(editorServerText("North offset"), "northOffsetDeg", -180, 180, 1, "°")}
      {r(editorServerText("Latitude"), "geoLatitude", -90, 90, 0.01, "°")}
      {r(editorServerText("Longitude"), "geoLongitude", -180, 180, 0.01, "°")}
      <label className="block text-xs text-fg-muted"><span className="mb-1 block">{editorServerText("Simulation date")}</span><input type="date" className="h-8 w-full rounded border border-line-strong bg-canvas px-2 text-xs text-fg" value={draft.simulationDate.slice(0, 10)} onChange={(event) => { if (event.target.value) change({ simulationDate: new Date(`${event.target.value}T00:00:00.000Z`).toISOString() }); }} /></label>
    </Panel>
    <SolarAnchorsPanel {...props} />
    <Panel title={editorServerText("Sun")}>
      {t(editorServerText("Sun disc"), "sunDiscEnabled")}
      {t(editorServerText("Automatic sun color"), "autoSunColorEnabled")}
      {!draft.autoSunColorEnabled ? c(editorServerText("Manual color"), "manualSunColorHex") : null}
      {t(editorServerText("Environment refresh"), "environmentRefreshEnabled")}
    </Panel>
    <Panel title={editorServerText("Sky")}>
      {r(editorServerText("Rayleigh"), "skyRayleigh", 0, 4, 0.05, undefined, !draft.skyEnabled)}
      {r(editorServerText("Mie coefficient"), "skyMieCoefficient", 0, 0.1, 0.001, undefined, !draft.skyEnabled)}
      {r(editorServerText("Mie directional G"), "skyMieDirectionalG", 0, 1, 0.01, undefined, !draft.skyEnabled)}
    </Panel>
    <BackdropPanel {...props} />
    <Panel title={editorServerText("Fog")}>
      {c(editorServerText("Color"), "fogColor", !fog || draft.fogMatchesSky)}
      {t(editorServerText("Match sky"), "fogMatchesSky", !fog)}
      {t(editorServerText("Ground fog"), "groundFogEnabled", !fog)}
      {r(editorServerText("Ground fog radius"), "groundFogRadius", 1, 2000, 5, "m", !fog || !draft.groundFogEnabled)}
      {t(editorServerText("Height band"), "fogHeightBandEnabled", !fog)}
      {r(editorServerText("Base height"), "fogBaseHeight", -50, 500, 1, "m", !fog)}
      {r(editorServerText("Top height"), "fogTopHeight", -50, 500, 1, "m", !fog)}
      {t(editorServerText("Distance haze"), "fogHazeEnabled", !fog)}
      {r(editorServerText("Haze"), "fogHaze", 0, 1, 0.01, undefined, !fog)}
      {r(editorServerText("Falloff"), "fogFalloff", 0.1, 6, 0.1, undefined, !fog)}
      {r(editorServerText("Maximum opacity"), "fogMaxOpacity", 0, 1, 0.01, undefined, !fog)}
      {t(editorServerText("Noise / wisps"), "fogNoiseEnabled", !fog)}
      {r(editorServerText("Noise strength"), "fogNoiseStrength", 0, 1, 0.01, undefined, !fog || !draft.fogNoiseEnabled)}
      {r(editorServerText("Noise scale"), "fogNoiseScale", 0.001, 0.5, 0.001, undefined, !fog || !draft.fogNoiseEnabled)}
      {t(editorServerText("Fog movement"), "fogMovementEnabled", !fog || !draft.fogNoiseEnabled)}
      {r(editorServerText("Wind direction"), "fogWindDirectionDeg", 0, 360, 1, "°", !fog || !draft.fogMovementEnabled)}
      {r(editorServerText("Wind speed"), "fogWindSpeed", 0, 0.5, 0.005, undefined, !fog || !draft.fogMovementEnabled)}
      {t(editorServerText("Sun interaction"), "fogSunInteractionEnabled", !fog)}
    </Panel>
    <Panel title={editorServerText("Clouds")}>
      {t(editorServerText("Cloud movement"), "cloudMovementEnabled", !clouds)}
      {t(editorServerText("Sun lighting"), "cloudSunLightingEnabled", !clouds)}
      {t(editorServerText("Cloud shadows"), "cloudShadowsEnabled", !clouds)}
      {r(editorServerText("Coverage"), "cloudCoverage", 0, 1, 0.01, undefined, !clouds)}
      {r(editorServerText("Density"), "cloudDensity", 0, 1, 0.01, undefined, !clouds)}
      {r(editorServerText("Height"), "cloudHeight", 20, 1500, 5, "m", !clouds)}
      {r(editorServerText("Thickness"), "cloudThickness", 5, 400, 5, "m", !clouds)}
      {r(editorServerText("Threshold"), "cloudThreshold", 0, 1, 0.01, undefined, !clouds)}
      {r(editorServerText("Opacity"), "cloudOpacity", 0, 1, 0.01, undefined, !clouds)}
      {r(editorServerText("Softness"), "cloudSoftness", 0.01, 1, 0.01, undefined, !clouds)}
      {r(editorServerText("Scale"), "cloudScale", 0.0005, 0.05, 0.0005, undefined, !clouds)}
      {r(editorServerText("Wind speed"), "cloudWindSpeed", 0, 0.5, 0.005, undefined, !clouds)}
      {r(editorServerText("Wind direction"), "cloudWindDirectionDeg", 0, 360, 1, "°", !clouds)}
      {r(editorServerText("Raymarch steps"), "cloudRaymarchSteps", 1, 24, 1, undefined, !clouds)}
      {r(editorServerText("Elevation"), "cloudElevation", 0, 1, 0.01, undefined, !clouds)}
    </Panel>
    <Panel title={editorServerText("Water")}>
      <Choice label={editorServerText("Type")} value={draft.waterType} disabled={!water} options={options(["sea", "lake", "pool", "decorative"], editorServerText)} onChange={(waterType) => change({ waterType: waterType as Config["waterType"] })} />
      {t(editorServerText("Waves"), "waterWavesEnabled", !water)}
      {t(editorServerText("Movement"), "waterMovementEnabled", !water)}
      {t(editorServerText("Sun reflection"), "waterSunReflectionEnabled", !water)}
      {t(editorServerText("Environment reflection"), "waterEnvReflectionEnabled", !water)}
      {t(editorServerText("Normal map"), "waterNormalMapEnabled", !water)}
      {r(editorServerText("Water height"), "waterHeight", -100, 100, 0.5, "m", !water)}
      {r(editorServerText("Size"), "waterSize", 0.1, 10, 0.1, undefined, !water)}
      {c(editorServerText("Water color"), "waterColor", !water)}
      {c(editorServerText("Deep color"), "waterDeepColor", !water)}
      {r(editorServerText("Distortion"), "waterDistortionScale", 0, 8, 0.1, undefined, !water)}
    </Panel>
    <Panel title={editorServerText("Ground")}>
      <Choice label={editorServerText("Style")} value={draft.groundStyle} disabled={!draft.groundEnabled} options={[{ value: "disc", label: editorServerText("Disc (fits content)") }, { value: "infinite", label: editorServerText("Infinite plane") }]} onChange={(groundStyle) => change({ groundStyle: groundStyle as Config["groundStyle"] })} />
    </Panel>
  </>;
}

function SolarAnchorsPanel({ draft, change }: ConfigProps) {
  const editorServerText = useEditorWord();
  const anchors = draft.solarAnchors;
  type Anchor = Config["solarAnchors"][number];
  const set = (id: string, patch: Partial<Anchor>) => change({ solarAnchors: anchors.map((anchor) => (anchor.id === id ? { ...anchor, ...patch } : anchor)) });
  const add = () => change({ solarAnchors: [...anchors, { id: crypto.randomUUID(), timeHours: 12, elevationDeg: draft.sunElevationDeg, azimuthDeg: draft.sunAzimuthDeg } as Anchor].sort((a, b) => a.timeHours - b.timeHours) });
  if (!draft.solarControllerEnabled || draft.solarPathMode !== "manual") return null;
  return <Panel title={editorServerText("Solar anchors")}>
    <Button type="button" variant="secondary" size="sm" onClick={add}><Plus aria-hidden="true" />{editorServerText("Add anchor")}</Button>
    {anchors.map((anchor) => <div key={anchor.id} className="space-y-2 rounded border border-line p-2">
      <Range label={editorServerText("Time")} value={anchor.timeHours} min={0} max={24} step={0.25} suffix="h" onChange={(timeHours) => set(anchor.id, { timeHours })} />
      <Range label={editorServerText("Elevation")} value={anchor.elevationDeg} min={-90} max={90} step={1} suffix="°" onChange={(elevationDeg) => set(anchor.id, { elevationDeg })} />
      <Range label={editorServerText("Azimuth")} value={anchor.azimuthDeg} min={0} max={360} step={1} suffix="°" onChange={(azimuthDeg) => set(anchor.id, { azimuthDeg })} />
      <button type="button" className="text-[11px] text-danger-strong" onClick={() => change({ solarAnchors: anchors.filter((item) => item.id !== anchor.id) })}>{editorServerText("Remove")}</button>
    </div>)}
  </Panel>;
}

/* --------------------------------------------------------------- Lighting */

export function LightingExtraPanels(props: ConfigProps & { projectId: string }) {
  const editorServerText = useEditorWord();
  const { draft, change } = props;
  const { t, r, c } = binders(props);
  const shadows = draft.shadowsEnabled;
  const csm = shadows && draft.csmEnabled;
  const contact = shadows && draft.contactShadowsEnabled;
  const gi = draft.giEnabled;
  const vol = draft.volumetricLightingEnabled;
  return <>
    <Panel title={editorServerText("Sun color")}>
      {t(editorServerText("Automatic color"), "autoSunColorEnabled", !draft.sunLightEnabled)}
      {!draft.autoSunColorEnabled ? c(editorServerText("Color"), "manualSunColorHex", !draft.sunLightEnabled) : null}
    </Panel>
    <Panel title={editorServerText("Shadows")}>
      {r(editorServerText("Softness"), "shadowSoftness", 0, 10, 0.1, undefined, !shadows || !draft.softShadowsEnabled)}
      {r(editorServerText("CSM cascades"), "csmCascades", 1, 4, 1, undefined, !csm)}
      {r(editorServerText("CSM max distance"), "csmMaxDistance", 10, 2000, 10, "m", !csm)}
      <Choice label={editorServerText("CSM resolution")} value={String(draft.csmResolution)} disabled={!csm} options={["512", "1024", "2048", "4096"].map((value) => ({ value, label: value }))} onChange={(value) => change({ csmResolution: Number(value) })} />
      <Choice label={editorServerText("CSM split mode")} value={draft.csmSplitMode} disabled={!csm} options={options(["practical", "uniform", "logarithmic"], editorServerText)} onChange={(csmSplitMode) => change({ csmSplitMode: csmSplitMode as Config["csmSplitMode"] })} />
      {r(editorServerText("CSM margin"), "csmMargin", 0, 1000, 10, "m", !csm)}
      {r(editorServerText("Contact blur"), "contactShadowBlur", 0, 2, 0.05, undefined, !contact)}
      {r(editorServerText("Contact darkness"), "contactShadowDarkness", 0, 1, 0.01, undefined, !contact)}
      {r(editorServerText("Contact opacity"), "contactShadowOpacity", 0, 1, 0.01, undefined, !contact)}
      {r(editorServerText("Contact range"), "contactShadowRange", 0.02, 5, 0.02, "m", !contact)}
      {t(editorServerText("Transmitted shadows"), "transmittedShadowsEnabled", !shadows)}
      {t(editorServerText("Colored shadows"), "coloredShadowsEnabled", !shadows || !draft.transmittedShadowsEnabled)}
      {r(editorServerText("Transmitted strength"), "transmittedShadowStrength", 0, 1, 0.01, undefined, !shadows || !draft.transmittedShadowsEnabled)}
    </Panel>
    <Panel title={editorServerText("Global illumination")}>
      {t(editorServerText("Indirect lighting"), "giIndirectEnabled", !gi)}
      {t(editorServerText("Ambient occlusion"), "giAOEnabled", !gi)}
      {t(editorServerText("Backface lighting"), "giBackfaceLighting", !gi)}
      {t(editorServerText("Temporal filtering"), "giTemporalFiltering", !gi)}
      {t(editorServerText("Screen-space sampling"), "giScreenSpaceSampling", !gi)}
      {r(editorServerText("GI intensity"), "giIntensity", 0, 50, 0.5, undefined, !gi)}
      {r(editorServerText("AO intensity"), "giAOIntensity", 0, 4, 0.05, undefined, !gi)}
      {r(editorServerText("Radius"), "giRadius", 0.5, 50, 0.5, undefined, !gi)}
      {r(editorServerText("Slice count"), "giSliceCount", 1, 4, 1, undefined, !gi)}
      {r(editorServerText("Step count"), "giStepCount", 1, 32, 1, undefined, !gi)}
      {r(editorServerText("Exp factor"), "giExpFactor", 0.5, 6, 0.1, undefined, !gi)}
      {r(editorServerText("Thickness"), "giThickness", 0.05, 10, 0.05, undefined, !gi)}
      {t(editorServerText("Linear thickness"), "giLinearThickness", !gi)}
    </Panel>
    <Panel title={editorServerText("Volumetric lighting")}>
      {t(editorServerText("Sun shafts"), "sunShaftsEnabled", !vol)}
      {t(editorServerText("Light volumes"), "lightVolumesEnabled", !vol)}
      {r(editorServerText("Density"), "volumetricDensity", 0, 2, 0.02, undefined, !vol)}
      {r(editorServerText("Maximum density"), "volumetricMaxDensity", 0, 2, 0.02, undefined, !vol)}
      {r(editorServerText("Distance attenuation"), "volumetricDistanceAtten", 0, 10, 0.1, undefined, !vol)}
      {r(editorServerText("Raymarch steps"), "volumetricRaymarchSteps", 8, 120, 1, undefined, !vol)}
    </Panel>
    <ArtificialLightsPanel {...props} />
  </>;
}

function ArtificialLightsPanel({ draft, change, projectId }: ConfigProps & { projectId: string }) {
  const editorServerText = useEditorWord();
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const lights = draft.artificialLights;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = lights.find((light) => light.id === selectedId) ?? null;
  const set = (id: string, patch: Partial<ArtificialLight>) => change({ artificialLights: lights.map((light) => (light.id === id ? { ...light, ...patch } : light)) });
  function add(type: ArtificialLight["type"]) {
    const light: ArtificialLight = { id: crypto.randomUUID(), name: `${type === "rect" ? "Area" : type === "ies" ? "IES" : type.charAt(0).toUpperCase() + type.slice(1)} light ${lights.length + 1}`, type, enabled: true, shadowsEnabled: false, volumetricEnabled: false, helperEnabled: true, position: { x: 0, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 }, colorHex: "#ffffff", temperatureK: null, intensity: 50, distance: 0, decay: 2, angleDeg: 30, penumbra: 0.3, width: 2, height: 2, iesProfileUrl: null };
    change({ artificialLights: [...lights, light] });
    setSelectedId(light.id);
  }
  const vec = (label: string, key: "position" | "target", light: ArtificialLight) => (["x", "y", "z"] as const).map((axis) => <Range key={`${key}${axis}`} label={`${label} ${axis.toUpperCase()}`} value={light[key][axis]} min={axis === "y" ? -50 : -200} max={200} step={0.5} onChange={(value) => set(light.id, { [key]: { ...light[key], [axis]: value } })} />);
  return <Panel title={editorServerText("Artificial lights")}>
    <div className="flex flex-wrap gap-1">{(["point", "spot", "ies", "rect"] as const).map((type) => <Button key={type} type="button" size="sm" variant="secondary" onClick={() => add(type)}><Plus aria-hidden="true" />{type === "rect" ? editorServerText("Area") : type === "ies" ? "IES" : editorServerText(type)}</Button>)}</div>
    {lights.map((light) => <div key={light.id} className={cn("flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px]", selectedId === light.id ? "border-accent" : "border-line")}>
      <button type="button" className="min-w-0 flex-1 truncate text-left text-fg" onClick={() => setSelectedId(light.id)}>{light.name}</button>
      <button type="button" aria-label={editorServerText("Remove {0}", light.name)} className="text-danger-strong" onClick={() => { change({ artificialLights: lights.filter((item) => item.id !== light.id) }); if (selectedId === light.id) setSelectedId(null); }}><Trash2 className="size-3.5" aria-hidden="true" /></button>
    </div>)}
    {selected ? <div className="space-y-3 border-t border-line pt-3">
      <label className="block text-xs text-fg-muted"><span className="mb-1 block">{editorServerText("Name")}</span><input className="h-8 w-full rounded border border-line-strong bg-canvas px-2 text-xs text-fg" value={selected.name} onChange={(event) => set(selected.id, { name: event.target.value })} /></label>
      <Toggle label={editorServerText("Light")} value={selected.enabled} onChange={(enabled) => set(selected.id, { enabled })} />
      <Toggle label={editorServerText("Shadows")} value={selected.shadowsEnabled} disabled={selected.type === "rect"} onChange={(shadowsEnabled) => set(selected.id, { shadowsEnabled })} />
      <Toggle label={editorServerText("Volumetric contribution")} value={selected.volumetricEnabled} onChange={(volumetricEnabled) => set(selected.id, { volumetricEnabled })} />
      <Toggle label={editorServerText("Helper")} value={selected.helperEnabled} onChange={(helperEnabled) => set(selected.id, { helperEnabled })} />
      {vec(editorServerText("Position"), "position", selected)}
      {selected.type !== "point" ? vec(editorServerText("Target"), "target", selected) : null}
      <Color label={editorServerText("Color")} value={selected.colorHex} onChange={(colorHex) => set(selected.id, { colorHex, temperatureK: null })} />
      <Range label={editorServerText("Intensity")} value={selected.intensity} min={0} max={1000} step={1} onChange={(intensity) => set(selected.id, { intensity })} />
      {selected.type !== "rect" ? <><Range label={editorServerText("Distance")} value={selected.distance} min={0} max={2000} step={1} suffix="m" onChange={(distance) => set(selected.id, { distance })} /><Range label={editorServerText("Decay")} value={selected.decay} min={0} max={4} step={0.1} onChange={(decay) => set(selected.id, { decay })} /></> : null}
      {selected.type === "spot" || selected.type === "ies" ? <><Range label={editorServerText("Angle")} value={selected.angleDeg} min={0.1} max={89} step={1} suffix="°" onChange={(angleDeg) => set(selected.id, { angleDeg })} /><Range label={editorServerText("Penumbra")} value={selected.penumbra} min={0} max={1} step={0.01} onChange={(penumbra) => set(selected.id, { penumbra })} /></> : null}
      {selected.type === "rect" ? <><Range label={editorServerText("Width")} value={selected.width} min={0.01} max={500} step={0.1} onChange={(width) => set(selected.id, { width })} /><Range label={editorServerText("Height")} value={selected.height} min={0.01} max={500} step={0.1} onChange={(height) => set(selected.id, { height })} /></> : null}
      {selected.type === "ies" ? <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">{editorServerText("IES Profile")}</p>
        <label className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-fg-muted hover:bg-surface-muted">
          <UploadCloud className="h-3.5 w-3.5" /> {uploading ? editorServerText("Uploading…") : selected.iesProfileUrl ? editorServerText("Replace .ies profile") : editorServerText("Upload .ies profile")}
          <input type="file" accept=".ies" className="hidden" disabled={uploading} aria-label={editorServerText("IES profile")} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const lightId = selected.id;
            setUploading(true);
            setUploadError(null);
            uploadEnvironmentAsset(projectId, "ies", file).then((iesProfileUrl) => set(lightId, { iesProfileUrl }), (failure) => setUploadError(failureMessage(failure, editorServerText("The IES profile could not be uploaded.")))).finally(() => setUploading(false));
          }} />
        </label>
        {selected.iesProfileUrl ? <p className="truncate px-1 text-[10px] text-fg-subtle">{selected.iesProfileUrl.startsWith("nesto-env:") ? editorServerText("Profile uploaded") : selected.iesProfileUrl}</p> : null}
        {uploadError ? <p role="alert" className="text-[10px] text-danger-strong">{uploadError}</p> : null}
      </div> : null}
    </div> : null}
  </Panel>;
}

/* -------------------------------------------------------------- Rendering */

export function RenderingExtraPanels(props: ConfigProps) {
  const editorServerText = useEditorWord();
  const { draft, change } = props;
  const { t, r } = binders(props);
  return <>
    <Panel title={editorServerText("Bloom")}>
      {r(editorServerText("Radius"), "bloomRadius", 0, 1, 0.05, undefined, !draft.bloomEnabled)}
    </Panel>
    <Panel title={editorServerText("Lens flare")}>
      {t(editorServerText("Lens flare"), "lensFlareEnabled")}
      {r(editorServerText("Intensity"), "lensFlareIntensity", 0, 3, 0.05, undefined, !draft.lensFlareEnabled)}
    </Panel>
    <Panel title={editorServerText("Depth of field")}>
      {t(editorServerText("Auto focus"), "cameraAutoFocusEnabled", !draft.depthOfFieldEnabled)}
      {r(editorServerText("Focal length"), "depthOfFieldFocalLength", 0.1, 100, 0.1, undefined, !draft.depthOfFieldEnabled)}
      {r(editorServerText("Bokeh scale"), "depthOfFieldBokehScale", 0, 10, 0.1, undefined, !draft.depthOfFieldEnabled)}
    </Panel>
    <Panel title={editorServerText("Distance blur")}>
      {t(editorServerText("Distance blur"), "distanceBlurEnabled")}
      {r(editorServerText("Sharp until"), "distanceBlurStartM", 0, 1000, 5, "m", !draft.distanceBlurEnabled)}
      {r(editorServerText("Fully blurred at"), "distanceBlurFullM", 0, 2000, 10, "m", !draft.distanceBlurEnabled)}
      {r(editorServerText("Amount"), "distanceBlurAmount", 0, 1, 0.05, undefined, !draft.distanceBlurEnabled)}
      {r(editorServerText("Radius"), "distanceBlurRadius", 0, 8, 0.25, undefined, !draft.distanceBlurEnabled)}
    </Panel>
    <Panel title={editorServerText("Motion blur")}>
      {r(editorServerText("Intensity"), "motionBlurIntensity", 0, 3, 0.05, undefined, !draft.motionBlurEnabled)}
    </Panel>
    <Panel title={editorServerText("Screen-space reflections")}>
      {r(editorServerText("Intensity"), "ssrIntensity", 0, 3, 0.05, undefined, !draft.ssrEnabled)}
      {r(editorServerText("Max distance"), "ssrMaxDistance", 1, 200, 1, undefined, !draft.ssrEnabled)}
      {r(editorServerText("Thickness"), "ssrThickness", 0.01, 5, 0.01, undefined, !draft.ssrEnabled)}
      {r(editorServerText("Quality"), "ssrQuality", 0, 1, 0.05, undefined, !draft.ssrEnabled)}
    </Panel>
    <Panel title={editorServerText("LUT and depth")}>
      <Choice label={editorServerText("LUT preset")} value={draft.lutPreset} disabled={!draft.lutEnabled} options={LUT_PRESETS.map((preset) => ({ value: preset.id, label: editorServerText(preset.label) }))} onChange={(lutPreset) => change({ lutPreset: lutPreset as Config["lutPreset"] })} />
      <Choice label={editorServerText("Glass preset")} value={draft.glassPreset} options={options(["performance", "standard", "premium"], editorServerText)} onChange={(glassPreset) => change({ glassPreset: glassPreset as Config["glassPreset"] })} />
      {t(editorServerText("Logarithmic depth"), "logarithmicDepthEnabled")}
      {t(editorServerText("Loading reveal"), "loadingRevealEnabled")}
    </Panel>
  </>;
}

/* ----------------------------------------------------------------- Camera */

export function CameraExtraPanels(props: ConfigProps) {
  const editorServerText = useEditorWord();
  const { draft, change } = props;
  const { t, r } = binders(props);
  const azimuthLimited = draft.cameraMinAzimuthDeg !== null || draft.cameraMaxAzimuthDeg !== null;
  const motionOff = !draft.idleDroneEnabled || !draft.idleDroneMotionEnabled;
  return <>
    <Panel title={editorServerText("Camera tools")}>
      {t(editorServerText("Auto focus"), "cameraAutoFocusEnabled")}
      {t(editorServerText("Camera helper"), "cameraHelperEnabled")}
      {r(editorServerText("Sensor / film gate"), "cameraSensorWidthMm", 10, 70, 1, "mm")}
    </Panel>
    <Panel title={editorServerText("Distance limits")}>
      {r(editorServerText("Start distance"), "cameraStartDistanceMultiplier", 0.1, 10, 0.1, "×")}
      {r(editorServerText("Min distance"), "cameraMinDistanceMultiplier", 0.05, 10, 0.05, "×")}
      {r(editorServerText("Max distance"), "cameraMaxDistanceMultiplier", 0.5, 20, 0.1, "×")}
    </Panel>
    <Panel title={editorServerText("Angle limits")}>
      {r(editorServerText("Min polar"), "cameraMinPolarDeg", 0, 180, 1, "°")}
      {r(editorServerText("Max polar"), "cameraMaxPolarDeg", 0, 180, 1, "°")}
      <Toggle label={editorServerText("Limit azimuth")} value={azimuthLimited} onChange={(on) => change(on ? { cameraMinAzimuthDeg: -90, cameraMaxAzimuthDeg: 90 } : { cameraMinAzimuthDeg: null, cameraMaxAzimuthDeg: null })} />
      {azimuthLimited ? <>
        <Range label={editorServerText("Min azimuth")} value={draft.cameraMinAzimuthDeg ?? -90} min={-180} max={180} step={1} suffix="°" onChange={(cameraMinAzimuthDeg) => change({ cameraMinAzimuthDeg })} />
        <Range label={editorServerText("Max azimuth")} value={draft.cameraMaxAzimuthDeg ?? 90} min={-180} max={180} step={1} suffix="°" onChange={(cameraMaxAzimuthDeg) => change({ cameraMaxAzimuthDeg })} />
      </> : null}
    </Panel>
    <Panel title={editorServerText("Drone motion")}>
      <Choice label={editorServerText("Direction")} value={draft.idleDroneClockwise ? "cw" : "ccw"} disabled={!draft.idleDroneEnabled} options={[{ value: "cw", label: editorServerText("Clockwise") }, { value: "ccw", label: editorServerText("Counter-clockwise") }]} onChange={(value) => change({ idleDroneClockwise: value === "cw" })} />
      {t(editorServerText("Drone motion"), "idleDroneMotionEnabled", !draft.idleDroneEnabled)}
      {t(editorServerText("Vertical movement"), "idleDroneHeightEnabled", motionOff)}
      {r(editorServerText("Vertical amount"), "idleDroneHeightAmplitude", 0, 0.5, 0.01, undefined, motionOff)}
      {r(editorServerText("Vertical cycles"), "idleDroneVerticalCycles", 1, 6, 1, undefined, motionOff)}
      {t(editorServerText("Distance movement"), "idleDroneDistanceEnabled", motionOff)}
      {r(editorServerText("Distance amount"), "idleDroneDistanceAmplitude", 0, 0.25, 0.01, undefined, motionOff)}
      {t(editorServerText("Target movement"), "idleDroneTargetEnabled", motionOff)}
      {r(editorServerText("Target amount"), "idleDroneTargetAmplitude", 0, 0.25, 0.01, undefined, motionOff)}
      {r(editorServerText("Phase offset"), "idleDronePhaseOffsetDeg", 0, 360, 1, "°", motionOff)}
      {r(editorServerText("Smoothness"), "idleDroneSmoothness", 0, 1, 0.01, undefined, motionOff)}
    </Panel>
  </>;
}

/* ------------------------------------------------------------ Performance */

export function PerformanceExtraPanels(props: ConfigProps) {
  const editorServerText = useEditorWord();
  const { draft, change } = props;
  const { t } = binders(props);
  const custom = draft.qualityPreset === "custom";
  // Rozaris: the custom sliders start from the chosen tier's own values.
  const tier = QUALITY_TIERS[draft.qualityPreset];
  return <Panel title={editorServerText("More quality")}>
    {t(editorServerText("Device detection"), "deviceDetectionEnabled")}
    {draft.deviceDetectionEnabled ? <button type="button" onClick={() => change({ qualityPreset: pickDefaultQualityTier() })} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-fg-muted hover:bg-surface-muted"><ScanSearch className="h-3.5 w-3.5" /> {editorServerText("Detect This Device")}</button> : null}
    {t(editorServerText("Runtime quality reduction"), "runtimeQualityReductionEnabled", !draft.adaptiveQualityEnabled)}
    <Range label={editorServerText("Render scale (custom)")} value={draft.customRenderScale ?? tier.renderScale} min={0.1} max={2} step={0.05} suffix="×" disabled={!custom} onChange={(customRenderScale) => change({ customRenderScale })} />
    <Range label={editorServerText("Pixel ratio limit (custom)")} value={draft.customDprCap ?? tier.dprCap} min={0.5} max={3} step={0.05} suffix="×" disabled={!custom} onChange={(customDprCap) => change({ customDprCap })} />
  </Panel>;
}

/* -------------------------------------------------------------------- Map */

/** What the viewer reports while it builds the real-world site (Rozaris MapPanel). */
export type SiteStatus =
  | null
  | { state: "loading" }
  | { state: "failed"; reason?: string }
  | { state: "ready"; centreElevationM: number; reliefM: { min: number; max: number } };

/** Rozaris "Reset site": turns the site off and clears every site field. */
const SITE_DEFAULTS = {
  siteEnabled: false,
  siteRadiusM: 600,
  siteTerrainEnabled: true,
  siteImageryEnabled: true,
  siteImageryBrightness: 0.85,
  siteOffsetX: 0,
  siteOffsetZ: 0,
  siteElevationOffset: 0,
  siteRotationDeg: 0,
  siteScale: 1,
} satisfies Partial<Config>;

const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;
const hint = (text: React.ReactNode) => <p className="text-[11px] leading-relaxed text-fg-subtle">{text}</p>;

function SiteStatusRow({ status }: { status: SiteStatus }) {
  const editorServerText = useEditorWord();
  if (!status) return null;
  if (status.state === "loading") {
    return <p className="flex items-center gap-1.5 text-[11px] text-fg-muted"><LoaderCircle className="h-3 w-3 animate-spin" /> {editorServerText("Building site from Mapbox terrain and imagery…")}</p>;
  }
  if (status.state === "failed") {
    return <p className="flex items-start gap-1.5 text-[11px] text-danger-strong"><TriangleAlert className="mt-px h-3 w-3 shrink-0" />{editorServerText("Could not build the site. Check the Mapbox token and this project's coordinates.")}</p>;
  }
  const relief = status.reliefM.max - status.reliefM.min;
  return <p className="text-[11px] text-success-strong">{editorServerText("Site ready — ground sits {0} m above sea level, with {1} m of relief across it. The building's own ground plane stays at zero.", Math.round(status.centreElevationM), relief.toFixed(1))}</p>;
}

export function MapPanels(props: ConfigProps & { siteStatus?: SiteStatus }) {
  const editorServerText = useEditorWord();
  const editorNodesServerText = useEditorNodeWord();
  const { draft, change, siteStatus = null } = props;
  const { t, r } = binders(props);
  const site = draft.siteEnabled;
  const coordinate = (label: string, key: "mapViewLatitude" | "mapViewLongitude") => <label className="block text-xs text-fg-muted"><span className="mb-1 block">{label}</span><input type="number" step="0.000001" className="h-8 w-full rounded border border-line-strong bg-canvas px-2 text-xs text-fg" value={draft[key] ?? ""} onChange={(event) => { const value = event.target.value === "" ? null : Number(event.target.value); change({ [key]: value === null || Number.isFinite(value) ? value : draft[key] }); }} /></label>;
  return <>
    <Panel title={editorServerText("Location")}>
      {coordinate(editorServerText("Latitude"), "mapViewLatitude")}
      {coordinate(editorServerText("Longitude"), "mapViewLongitude")}
      {r(editorServerText("Altitude"), "mapViewAltitude", -100, 2000, 1, "m")}
    </Panel>
    <Panel title={editorServerText("Real-world site")}>
      {t(editorServerText("Show real-world site"), "siteEnabled", draft.mapViewLatitude === null || draft.mapViewLongitude === null)}
      {draft.mapViewLatitude === null || draft.mapViewLongitude === null ? <p className="flex items-start gap-1.5 text-[11px] text-warning-strong"><MapPin className="mt-px h-3 w-3 shrink-0" />{editorServerText("This Experience has no location set. Enter the latitude and longitude above — the site is built from these coordinates.")}</p> : null}
      {site ? <SiteStatusRow status={siteStatus} /> : null}
      {site ? hint(editorServerText("The Ground platform (Environment → Ground) is hidden automatically while this is on — both sit at ground level and would otherwise flicker against each other.")) : null}
    </Panel>
    <Panel title={editorServerText("Extent & layers")}>
      {r(editorServerText("Radius"), "siteRadiusM", 100, 3000, 50, "m", !site)}
      {hint(editorServerText("How far the real world extends around the project. Larger sites automatically fetch sharper imagery rather than stretching one texture thinner, so a 2 km site downloads more and costs more GPU memory — 600–800 m reads well for most projects."))}
      {t(editorServerText("Terrain"), "siteTerrainEnabled", !site)}
      {t(editorServerText("Aerial imagery"), "siteImageryEnabled", !site)}
      {r(editorServerText("Imagery brightness"), "siteImageryBrightness", 0, 2, 0.05, undefined, !site || !draft.siteImageryEnabled)}
      {hint(editorServerText("Aerial photos already have the sun of the day they were shot baked into them, which fights this project's own movable sun. Pulling this down is the honest fix — it will never match perfectly at every time of day."))}
    </Panel>
    <Panel title={editorServerText("Alignment")}>
      {hint(editorNodesServerText("The {0} moves — the building never does. Line the real world up with your model; every uploaded GLB stays exactly where it was authored.", <span className="text-fg-muted">{editorServerText("site")}</span>))}
      {r(editorServerText("Rotate"), "siteRotationDeg", -180, 180, 0.5, "°", !site)}
      <p className="flex items-start gap-1.5 text-[11px] text-info-strong"><Compass className="mt-px h-3 w-3 shrink-0" />{editorServerText("Rotating the site tells the engine where north really is, so the sun rotates with it. Shadows stay correct for the real location as you align.")}</p>
      {r(editorServerText("Move east / west"), "siteOffsetX", -500, 500, 0.5, "m", !site)}
      {r(editorServerText("Move north / south"), "siteOffsetZ", -500, 500, 0.5, "m", !site)}
      {r(editorServerText("Height"), "siteElevationOffset", -100, 100, 0.1, "m", !site)}
      {r(editorServerText("Scale"), "siteScale", 0.5, 2, 0.01, "×", !site)}
      {hint(editorServerText("Scale should stay at 1× — both the site and your models are in real metres. It exists only for a model that was authored at the wrong scale and cannot be re-exported."))}
      <Button type="button" variant="secondary" size="sm" disabled={!site} onClick={() => change({ siteRotationDeg: 0, siteOffsetX: 0, siteOffsetZ: 0, siteElevationOffset: 0, siteScale: 1 })}>{editorServerText("Reset site alignment")}</Button>
    </Panel>
    <Panel title={editorServerText("Sun & North")}>
      <p className="text-[11px] text-fg-subtle">{editorNodesServerText("North offset is currently {0} — your Sun & Sky north ({1}°) plus this site's rotation ({2}°). They are the same quantity and simply add.", <span className="text-fg-muted">{normalizeDeg(draft.northOffsetDeg + draft.siteRotationDeg)}°</span>, draft.northOffsetDeg, draft.siteRotationDeg)}</p>
      <button type="button" onClick={() => change({ northOffsetDeg: normalizeDeg(draft.northOffsetDeg + 180) })} disabled={!site} className="w-full rounded-md border border-line-strong bg-surface-muted/60 px-2.5 py-1.5 text-[11px] font-semibold text-fg hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40">{editorServerText("Flip sun 180°")}</button>
      {hint(editorServerText("The site is laid out with true north away from the camera's default forward, which is half a turn from the engine's own sun-azimuth reference. If shadows fall on the wrong side of the building at midday, this is the fix. It is not applied automatically because it would move the sun on every existing project."))}
    </Panel>
    <button type="button" onClick={() => change(SITE_DEFAULTS)} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-[11px] font-semibold text-danger-strong hover:bg-danger-soft">{editorServerText("Reset site")}</button>
    {hint(editorServerText("Turns the site off and clears every field above. Your uploaded models and the Map view below are untouched."))}
    <Panel title={editorServerText("Map view")}>
      {t(editorServerText("Map view"), "mapViewEnabled")}
      {r(editorServerText("Heading"), "mapViewHeadingDeg", -180, 180, 1, "°", !draft.mapViewEnabled)}
      {r(editorServerText("Scale"), "mapViewScale", 0.1, 10, 0.05, "×", !draft.mapViewEnabled)}
      {r(editorServerText("Zoom"), "mapViewZoom", 10, 22, 0.1, undefined, !draft.mapViewEnabled)}
      {r(editorServerText("Pitch"), "mapViewPitchDeg", 0, 85, 1, "°", !draft.mapViewEnabled)}
      {r(editorServerText("Bearing"), "mapViewBearingDeg", -180, 180, 1, "°", !draft.mapViewEnabled)}
    </Panel>
  </>;
}

/* ---------------------------------------------------------------- Presets */

type Preset = { id: string; name: string; configuration: unknown; updatedAt: string };

/** The Rozaris preset groups (environmentPresetFields.ts), over NESTO's preset keys. */
const PRESET_GROUPS = [
  { label: "Sun & Sky", match: /^(sun|solar|viewerTime|geo|simulationDate|northOffset|sky|environment|autoSun|manualSun|backdrop)/ },
  { label: "Fog & Haze", match: /^fog/ },
  { label: "Clouds", match: /^cloud/ },
  { label: "Water", match: /^water/ },
  { label: "Lens Flare & Bloom", match: /^(lensFlare|bloom)/ },
  { label: "Tone Mapping & Color", match: /^(exposure|toneMapping|lut)/ },
];
const PRESETS_API = `${PROJECT_3D_PLATFORM_API_ROOT}/presets`;

/**
 * Environment presets shared across the platform. Applying one changes only
 * this draft; camera, quality, ground, units, sections and shadows are kept.
 */
export function PresetsPanel({ draft, change, canEdit }: ConfigProps & { canEdit: boolean }) {
  const editorServerText = useEditorWord();
  const [presets, setPresets] = React.useState<Preset[] | null>(null);
  const [name, setName] = React.useState("");
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setPresets(await engineeringApi<Preset[]>(PRESETS_API));
    } catch (failure) {
      setError(failureMessage(failure, editorServerText("The presets could not be loaded.")));
      setPresets([]);
    }
  }, [editorServerText]);
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

  function apply(preset: Preset) {
    if (!window.confirm(editorServerText("Apply \"{0}\"? This overwrites this project's Sun & Sky, Fog & Haze, Clouds, Water, Lens Flare/Bloom, and Tone Mapping/LUT settings with the preset's values — Save to keep it, Publish to go live.", preset.name))) return;
    change(environmentPresetPatch(preset.configuration));
  }

  function overwrite(preset: Preset) {
    if (!window.confirm(editorServerText("Update \"{0}\" to match this project's current settings? This overwrites the saved preset for every project that loads it.", preset.name))) return;
    void run(() => engineeringApi(`${PRESETS_API}/${preset.id}`, { method: "PATCH", body: { configuration: pickEnvironmentPresetConfig(draft) } }), editorServerText("The preset could not be updated."));
  }

  const saveNew = () => run(async () => {
    await engineeringApi(PRESETS_API, { body: { name: name.trim(), configuration: pickEnvironmentPresetConfig(draft) } });
    setName("");
  }, editorServerText("The preset could not be saved."));

  return <Panel title={editorServerText("Environment presets")}>
    <p className="text-[11px] leading-4 text-fg-subtle">{editorServerText("A preset holds sun, sky, time of day, backdrop, fog, clouds, water, bloom, lens flare and color grading. Applying one changes this draft only; Save keeps it.")}</p>
    {canEdit ? <div className="flex gap-2">
      <input className="h-8 min-w-0 flex-1 rounded border border-line-strong bg-canvas px-2 text-xs text-fg" placeholder={editorServerText("New preset name")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      <Button type="button" size="sm" variant="secondary" disabled={busy || !name.trim()} onClick={() => void saveNew()}>{editorServerText("Save")}</Button>
    </div> : null}
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-fg-subtle">{editorServerText("Included Settings")}</p>
      <div className="flex flex-wrap gap-1">
        {PRESET_GROUPS.map((group) => <span key={group.label} title={editorServerText("{0} fields", ENVIRONMENT_PRESET_KEYS.filter((key) => group.match.test(key)).length)} className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted">{editorServerText(group.label)}</span>)}
      </div>
      <p className="mt-1.5 text-[10px] text-fg-subtle">{editorServerText("Camera, Quality/Performance, Ground, Unit Colors, Sections, and Shadows/GI stay per-project — not included.")}</p>
    </div>
    {presets === null ? <p className="text-xs text-fg-subtle">{editorServerText("Loading presets…")}</p> : presets.length === 0 ? <p className="text-xs text-fg-subtle">{editorServerText("No presets yet.")}</p> : null}
    {presets?.map((preset) => <div key={preset.id} className="space-y-2 rounded border border-line p-2 text-xs">
      {renaming?.id === preset.id ? <div className="flex gap-2">
        <input className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-canvas px-2 text-xs text-fg" value={renaming.name} maxLength={80} onChange={(event) => setRenaming({ id: preset.id, name: event.target.value })} />
        <Button type="button" size="sm" variant="secondary" disabled={busy || !renaming.name.trim()} onClick={() => void run(async () => { await engineeringApi(`${PRESETS_API}/${preset.id}`, { method: "PATCH", body: { name: renaming.name.trim() } }); setRenaming(null); }, editorServerText("The preset could not be renamed."))}>OK</Button>
      </div> : <p className="truncate font-medium text-fg">{preset.name}</p>}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <button type="button" className="text-accent-strong" disabled={busy} onClick={() => apply(preset)}>{editorServerText("Apply")}</button>
        {canEdit ? <>
          <button type="button" className="text-fg-muted" disabled={busy} onClick={() => overwrite(preset)}>{editorServerText("Overwrite with current")}</button>
          <button type="button" className="text-fg-muted" disabled={busy} onClick={() => setRenaming({ id: preset.id, name: preset.name })}>{editorServerText("Rename")}</button>
          <button type="button" className="text-danger-strong" disabled={busy} onClick={() => void run(() => engineeringApi(`${PRESETS_API}/${preset.id}`, { method: "DELETE" }), editorServerText("The preset could not be deleted."))}>{editorServerText("Delete")}</button>
        </> : null}
      </div>
    </div>)}
    {error ? <p role="alert" className="text-xs text-danger-strong">{error}</p> : null}
  </Panel>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="flex items-center gap-1.5 rounded border border-line bg-surface px-2 py-1.5">
    <Search className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="w-full bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none" />
  </div>;
}
