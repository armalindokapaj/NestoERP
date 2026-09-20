"use client";

import * as React from "react";
import { Camera, CircleGauge, Cuboid, Layers3, Lightbulb, Mountain, Palette, RotateCcw, Save, ScanLine, Sun, Video } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { ThreeProjectViewer } from "@/components/3d/company/ThreeProjectViewer";
import type { ThreeProjectViewerHandle } from "@/components/3d/company/viewerTypes";
import { UnitBindingEditor } from "@/components/3d/platform/UnitBindingEditor";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Project3DConfig, ProjectDetailModel, Section } from "@/lib/3d/runtime/types";
import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import type { Project3DNodeOverride, Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { cn } from "@/lib/utils/cn";

type EditorUnit = {
  id: string;
  unitCode: string;
  name: string | null;
  publicationStatus: string;
  commercialProfile: { status: string } | null;
  floor: { name: string; number: number | null; building: { name: string } };
};

type EditorVersion = {
  id: string;
  version: number;
  originalFileName: string;
  status: string;
  validationStatus: string;
  validationIssues: unknown;
  triangleCount: number | null;
  meshCount: number | null;
  materialCount: number | null;
  textureCount: number | null;
  scale: number;
  rotationDeg: number;
  altitudeOffset: number;
  positionX: number;
  positionZ: number;
  rotationXDeg: number;
  rotationZDeg: number;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  selectable: boolean;
  transformLocked: boolean;
  sceneManifest: unknown;
  nodeOverrides: unknown;
  unitBindings: Array<{ meshName: string; unitId: string; unitCode: string; poiYawDeg: number; poiEnabled: boolean; poiDistanceOverride: number | null; poiHeightOverride: number | null }>;
  updatedAt: string;
  asset: { url: string; expiresAt: string; fileName: string; contentType: "model/gltf-binary" } | null;
};

type EditorSlot = {
  id: string;
  kind: "MAP" | "DETAIL";
  role: "BUILDING" | "UNITS" | "SURROUNDINGS" | "CONTEXT" | "CUSTOM";
  slotKey: string;
  displayName: string;
  sortOrder: number;
  transformParentSlotId: string | null;
  versions: EditorVersion[];
};

export type Project3DEditorWorkspace = {
  project: { id: string; code: string; name: string; company: { id: string; name: string; parentGroup: { id: string; name: string } } };
  config: { id: string; activeReleaseId: string | null; updatedAt: string; document: { schemaVersion: 1; revision: number; config: Project3DConfig } };
  slots: EditorSlot[];
  units: EditorUnit[];
};

type Tab = "scene" | "materials" | "environment" | "lighting" | "rendering" | "camera" | "shots" | "sections" | "performance" | "units";
const TABS: Array<{ id: Tab; label: string; icon: typeof Cuboid }> = [
  { id: "scene", label: "Scene", icon: Cuboid },
  { id: "materials", label: "Materials", icon: Palette },
  { id: "environment", label: "Environment", icon: Mountain },
  { id: "lighting", label: "Lighting", icon: Sun },
  { id: "rendering", label: "Rendering", icon: Layers3 },
  { id: "camera", label: "Camera", icon: Camera },
  { id: "shots", label: "Shots", icon: Video },
  { id: "sections", label: "Sections", icon: ScanLine },
  { id: "performance", label: "Performance", icon: CircleGauge },
  { id: "units", label: "Unit binding", icon: Lightbulb },
];

function manifestOf(value: unknown): Project3DSceneNode[] {
  return Array.isArray(value) ? value.filter((node): node is Project3DSceneNode => Boolean(node) && typeof node === "object" && typeof (node as { nodeId?: unknown }).nodeId === "string") : [];
}

function overridesOf(value: unknown): Project3DNodeOverride[] {
  return Array.isArray(value) ? value.filter((item): item is Project3DNodeOverride => Boolean(item) && typeof item === "object" && typeof (item as { nodeId?: unknown }).nodeId === "string") : [];
}

function statusOf(unit: EditorUnit): "available" | "reserved" | "sold" {
  if (unit.commercialProfile?.status === "SOLD") return "sold";
  if (unit.commercialProfile?.status === "RESERVED" || unit.commercialProfile?.status === "ON_HOLD") return "reserved";
  return "available";
}

function runtimeModel(version: EditorVersion): ProjectDetailModel | null {
  if (!version.asset) return null;
  return {
    glbUrl: version.asset.url,
    fileName: version.asset.fileName,
    fileSize: 0,
    scale: version.scale,
    rotationDeg: version.rotationDeg,
    altitudeOffset: version.altitudeOffset,
    positionX: version.positionX,
    positionZ: version.positionZ,
    rotationXDeg: version.rotationXDeg,
    rotationZDeg: version.rotationZDeg,
    enabled: true,
    visible: version.visible,
    castShadow: version.castShadow,
    receiveShadow: version.receiveShadow,
    selectable: version.selectable,
    transformLocked: version.transformLocked,
    updatedAt: version.updatedAt,
    unitLinks: version.unitBindings,
    sceneManifest: manifestOf(version.sceneManifest).map((node) => ({ nodeId: node.nodeId, name: node.name, meshIndex: node.meshIndex, parentNodeId: node.parentNodeId, depth: node.depth, isMesh: node.isMesh, autoClassification: node.autoClassification })),
    nodeOverrides: overridesOf(version.nodeOverrides).map((override) => ({ ...override, nodeId: override.nodeId })),
    triangleCount: version.triangleCount,
    meshCount: version.meshCount,
    materialCount: version.materialCount,
    textureCount: version.textureCount,
  };
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3"><h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">{title}</h3><div className="space-y-3">{children}</div></section>;
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className={cn("flex items-center justify-between gap-3 text-xs text-neutral-300", disabled && "opacity-40")}><span>{label}</span><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="size-4 accent-indigo-500" /></label>;
}

function Range({ label, value, min, max, step, suffix, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void; disabled?: boolean }) {
  return <label className={cn("block text-xs text-neutral-400", disabled && "opacity-40")}><span className="mb-1 flex justify-between"><span>{label}</span><span className="font-mono text-neutral-300">{value}{suffix}</span></span><input className="w-full accent-indigo-500" type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex items-center justify-between text-xs text-neutral-300"><span>{label}</span><span className="flex items-center gap-2"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><code>{value}</code></span></label>;
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="block text-xs text-neutral-400"><span className="mb-1 block">{label}</span><select className={cn(selectClass, "h-8 border-neutral-700 bg-neutral-950 text-xs text-neutral-200")} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function modelState(version: EditorVersion | null) {
  return version ? { ...version, nodeOverrides: overridesOf(version.nodeOverrides) } : null;
}

export function ExperienceEditor({ initial }: { initial: Project3DEditorWorkspace }) {
  const [activeTab, setActiveTab] = React.useState<Tab>("scene");
  const first = initial.slots.flatMap((slot) => slot.versions).find((version) => version.asset) ?? initial.slots[0]?.versions[0] ?? null;
  const [activeVersionId, setActiveVersionId] = React.useState<string | null>(first?.id ?? null);
  const sourceVersion = initial.slots.flatMap((slot) => slot.versions).find((version) => version.id === activeVersionId) ?? null;
  const [draft, setDraft] = React.useState<Project3DConfig>(() => structuredClone(initial.config.document.config));
  const [revision, setRevision] = React.useState(initial.config.document.revision);
  const [model, setModel] = React.useState<ReturnType<typeof modelState>>(() => modelState(sourceVersion));
  const [configDirty, setConfigDirty] = React.useState(false);
  const [modelDirty, setModelDirty] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [perf, setPerf] = React.useState<{ fps: number; frameTimeMs: number; drawCalls: number; triangles: number; textures: number; dpr: number } | null>(null);
  const viewerRef = React.useRef<ThreeProjectViewerHandle>(null);
  const toast = useToast();

  React.useEffect(() => {
    setModel(modelState(sourceVersion));
    setModelDirty(false);
    setSelectedNodeId(null);
  }, [activeVersionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeConfig(patch: Partial<Project3DConfig>) {
    setDraft((current) => ({ ...current, ...patch }));
    setConfigDirty(true);
  }

  function changeModel(patch: Partial<NonNullable<typeof model>>) {
    setModel((current) => current ? { ...current, ...patch } : current);
    setModelDirty(true);
  }

  const sceneManifest = manifestOf(model?.sceneManifest);
  const selectedOverride = model ? overridesOf(model.nodeOverrides).find((item) => item.nodeId === selectedNodeId) ?? null : null;
  function changeOverride(patch: Partial<Project3DNodeOverride>) {
    if (!model || !selectedNodeId) return;
    const current = overridesOf(model.nodeOverrides);
    const index = current.findIndex((item) => item.nodeId === selectedNodeId);
    const next = [...current];
    if (index < 0) next.push({ nodeId: selectedNodeId, materialOverrideEnabled: true, ...patch });
    else next[index] = { ...next[index], ...patch };
    changeModel({ nodeOverrides: next });
  }

  const models = React.useMemo(() => initial.slots.flatMap((slot) => {
    const chosen = slot.versions.find((version) => version.id === activeVersionId) ?? slot.versions.find((version) => version.asset);
    const effective = chosen?.id === model?.id ? model : chosen;
    const runtime = effective ? runtimeModel(effective as EditorVersion) : null;
    return runtime ? [{ slotId: slot.id, slotName: slot.displayName, slotRole: slot.role.toLowerCase() as "building" | "units" | "surroundings" | "context" | "custom", transformParentSlotId: slot.transformParentSlotId, model: runtime, units: initial.units.map((unit) => ({ id: unit.id, code: unit.unitCode, status: statusOf(unit) })) }] : [];
  }), [activeVersionId, initial.slots, initial.units, model]);

  async function save() {
    if (reason.trim().length < 3) { setError("Give a reason for these changes."); return; }
    setPending(true); setError(null);
    try {
      if (configDirty) {
        const result = await engineeringApi<{ document: { revision: number; config: Project3DConfig } }>(`/api/platform/3d/projects/${initial.project.id}/config`, { method: "PUT", body: { expectedRevision: revision, config: draft, reason } });
        setRevision(result.document.revision);
        setDraft(result.document.config);
        setConfigDirty(false);
      }
      if (modelDirty && model) {
        const result = await engineeringApi<{ updatedAt: string }>(`/api/platform/3d/projects/${initial.project.id}/versions/${model.id}`, { method: "PATCH", body: { expectedUpdatedAt: model.updatedAt, scale: model.scale, rotationDeg: model.rotationDeg, altitudeOffset: model.altitudeOffset, positionX: model.positionX, positionZ: model.positionZ, rotationXDeg: model.rotationXDeg, rotationZDeg: model.rotationZDeg, visible: model.visible, castShadow: model.castShadow, receiveShadow: model.receiveShadow, selectable: model.selectable, transformLocked: model.transformLocked, nodeOverrides: model.nodeOverrides, reason } });
        setModel({ ...model, updatedAt: result.updatedAt });
        setModelDirty(false);
      }
      setReason("");
      toast({ title: "3D Experience saved.", tone: "success" });
    } catch (failure) {
      setError(failureMessage(failure, "The 3D Experience could not be saved."));
    } finally { setPending(false); }
  }

  function addShot() {
    const camera = viewerRef.current?.getCameraState();
    if (!camera) return;
    changeConfig({ cameraPresets: [...draft.cameraPresets, { id: crypto.randomUUID(), label: `Shot ${draft.cameraPresets.length + 1}`, position: camera.position, target: camera.target, fov: camera.fov, durationMs: 900 }] });
  }

  function addSection() {
    const bounds = viewerRef.current?.getContentBounds();
    const section: Section = { id: crypto.randomUUID(), name: `Section ${draft.sections.length + 1}`, scope: "project", centerX: bounds?.centerX ?? 0, centerZ: bounds?.centerZ ?? 0, widthM: Math.max(bounds?.sizeX ?? 20, 1), depthM: Math.max(bounds?.sizeZ ?? 20, 1), rotationDeg: 0, heightM: Math.max((bounds?.maxY ?? 20) - (bounds?.minY ?? 0), 1), bottomEnabled: false, fillGapsEnabled: false, fillColor: "#f2f2f2" };
    changeConfig({ sections: [...draft.sections, section] });
  }

  const inspector = activeTab === "scene" ? <>
    <Panel title="Model visibility"><Toggle label="Visible" value={model?.visible ?? false} disabled={!model} onChange={(visible) => changeModel({ visible })} /><Toggle label="Cast shadows" value={model?.castShadow ?? false} disabled={!model} onChange={(castShadow) => changeModel({ castShadow })} /><Toggle label="Receive shadows" value={model?.receiveShadow ?? false} disabled={!model} onChange={(receiveShadow) => changeModel({ receiveShadow })} /><Toggle label="Selectable" value={model?.selectable ?? false} disabled={!model} onChange={(selectable) => changeModel({ selectable })} /><Toggle label="Lock transform" value={model?.transformLocked ?? false} disabled={!model} onChange={(transformLocked) => changeModel({ transformLocked })} /></Panel>
    <Panel title="Transform"><Range label="Scale" value={model?.scale ?? 1} min={0.01} max={20} step={0.01} onChange={(scale) => changeModel({ scale })} disabled={!model?.asset || model.transformLocked} /><Range label="Position X" value={model?.positionX ?? 0} min={-500} max={500} step={0.5} suffix="m" onChange={(positionX) => changeModel({ positionX })} disabled={!model || model.transformLocked} /><Range label="Position Y" value={model?.altitudeOffset ?? 0} min={-500} max={500} step={0.5} suffix="m" onChange={(altitudeOffset) => changeModel({ altitudeOffset })} disabled={!model || model.transformLocked} /><Range label="Position Z" value={model?.positionZ ?? 0} min={-500} max={500} step={0.5} suffix="m" onChange={(positionZ) => changeModel({ positionZ })} disabled={!model || model.transformLocked} /><Range label="Rotation Y" value={model?.rotationDeg ?? 0} min={-180} max={180} step={1} suffix="°" onChange={(rotationDeg) => changeModel({ rotationDeg })} disabled={!model || model.transformLocked} /></Panel>
  </> : activeTab === "materials" ? <>
    <Panel title="Scene node"><Choice label="Node" value={selectedNodeId ?? ""} options={[{ value: "", label: "Choose a mesh" }, ...sceneManifest.filter((node) => node.isMesh && node.autoClassification !== "unit_block").map((node) => ({ value: node.nodeId, label: node.name }))]} onChange={(value) => setSelectedNodeId(value || null)} /></Panel>
    {selectedNodeId ? <Panel title="Material override"><Toggle label="Override material" value={selectedOverride?.materialOverrideEnabled ?? true} onChange={(materialOverrideEnabled) => changeOverride({ materialOverrideEnabled })} /><Choice label="Preset" value={selectedOverride?.materialPreset ?? "concrete"} options={["concrete", "plaster", "stone", "wood", "aluminium", "steel", "chrome", "ceramic"].map((value) => ({ value, label: value }))} onChange={(materialPreset) => changeOverride({ materialPreset: materialPreset as Project3DNodeOverride["materialPreset"] })} /><Color label="Base color" value={selectedOverride?.colorHex ?? "#cccccc"} onChange={(colorHex) => changeOverride({ colorHex })} /><Range label="Roughness" value={selectedOverride?.roughness ?? 0.5} min={0} max={1} step={0.01} onChange={(roughness) => changeOverride({ roughness })} /><Range label="Metalness" value={selectedOverride?.metalness ?? 0} min={0} max={1} step={0.01} onChange={(metalness) => changeOverride({ metalness })} /><Range label="Opacity" value={selectedOverride?.opacity ?? 1} min={0} max={1} step={0.01} onChange={(opacity) => changeOverride({ opacity })} /><Range label="Clearcoat" value={selectedOverride?.clearcoat ?? 0} min={0} max={1} step={0.01} onChange={(clearcoat) => changeOverride({ clearcoat })} /><Toggle label="Transmission" value={selectedOverride?.transmissionEnabled ?? false} onChange={(transmissionEnabled) => changeOverride({ transmissionEnabled })} /></Panel> : null}
  </> : activeTab === "environment" ? <><Panel title="Sun and sky"><Toggle label="Sky" value={draft.skyEnabled} onChange={(skyEnabled) => changeConfig({ skyEnabled })} /><Range label="Sun azimuth" value={draft.sunAzimuthDeg} min={0} max={360} step={1} suffix="°" onChange={(sunAzimuthDeg) => changeConfig({ sunAzimuthDeg })} /><Range label="Sun elevation" value={draft.sunElevationDeg} min={-10} max={90} step={1} suffix="°" onChange={(sunElevationDeg) => changeConfig({ sunElevationDeg })} /><Range label="Environment intensity" value={draft.environmentIntensity} min={0} max={5} step={0.05} onChange={(environmentIntensity) => changeConfig({ environmentIntensity })} /><Range label="Turbidity" value={draft.skyTurbidity} min={0} max={20} step={0.1} onChange={(skyTurbidity) => changeConfig({ skyTurbidity })} /></Panel><Panel title="Atmosphere"><Toggle label="Clouds" value={draft.cloudsEnabled} onChange={(cloudsEnabled) => changeConfig({ cloudsEnabled })} /><Toggle label="Fog" value={draft.fogEnabled} onChange={(fogEnabled) => changeConfig({ fogEnabled })} /><Range label="Fog density" value={draft.fogDensity} min={0} max={0.2} step={0.001} onChange={(fogDensity) => changeConfig({ fogDensity })} /><Toggle label="Water" value={draft.waterEnabled} onChange={(waterEnabled) => changeConfig({ waterEnabled })} /><Toggle label="Ground" value={draft.groundEnabled} onChange={(groundEnabled) => changeConfig({ groundEnabled })} /><Color label="Ground color" value={draft.groundColor} onChange={(groundColor) => changeConfig({ groundColor })} /></Panel></> : activeTab === "lighting" ? <><Panel title="Sun light"><Toggle label="Sun light" value={draft.sunLightEnabled} onChange={(sunLightEnabled) => changeConfig({ sunLightEnabled })} /><Range label="Temperature" value={draft.sunTemperatureK} min={1000} max={12000} step={50} suffix="K" onChange={(sunTemperatureK) => changeConfig({ sunTemperatureK })} /><Toggle label="Automatic intensity" value={draft.autoSunIntensityEnabled} onChange={(autoSunIntensityEnabled) => changeConfig({ autoSunIntensityEnabled })} /><Range label="Manual intensity" value={draft.manualSunIntensity} min={0} max={10} step={0.05} onChange={(manualSunIntensity) => changeConfig({ manualSunIntensity })} /></Panel><Panel title="Shadows and GI"><Toggle label="Shadows" value={draft.shadowsEnabled} onChange={(shadowsEnabled) => changeConfig({ shadowsEnabled })} /><Toggle label="Soft shadows" value={draft.softShadowsEnabled} onChange={(softShadowsEnabled) => changeConfig({ softShadowsEnabled })} /><Toggle label="Cascaded shadows" value={draft.csmEnabled} onChange={(csmEnabled) => changeConfig({ csmEnabled })} /><Toggle label="Contact shadows" value={draft.contactShadowsEnabled} onChange={(contactShadowsEnabled) => changeConfig({ contactShadowsEnabled })} /><Toggle label="Global illumination" value={draft.giEnabled} onChange={(giEnabled) => changeConfig({ giEnabled })} /><Toggle label="Volumetric lighting" value={draft.volumetricLightingEnabled} onChange={(volumetricLightingEnabled) => changeConfig({ volumetricLightingEnabled })} /></Panel></> : activeTab === "rendering" ? <><Panel title="Post processing"><Toggle label="Screen-space reflections" value={draft.ssrEnabled} onChange={(ssrEnabled) => changeConfig({ ssrEnabled })} /><Toggle label="Anti-aliasing" value={draft.antialiasEnabled} onChange={(antialiasEnabled) => changeConfig({ antialiasEnabled })} /><Toggle label="Bloom" value={draft.bloomEnabled} onChange={(bloomEnabled) => changeConfig({ bloomEnabled })} /><Range label="Bloom strength" value={draft.bloomStrength} min={0} max={5} step={0.05} onChange={(bloomStrength) => changeConfig({ bloomStrength })} /><Toggle label="Depth of field" value={draft.depthOfFieldEnabled} onChange={(depthOfFieldEnabled) => changeConfig({ depthOfFieldEnabled })} /><Toggle label="Motion blur" value={draft.motionBlurEnabled} onChange={(motionBlurEnabled) => changeConfig({ motionBlurEnabled })} /></Panel><Panel title="Color"><Range label="Exposure" value={draft.exposure} min={0.1} max={5} step={0.05} onChange={(exposure) => changeConfig({ exposure })} /><Choice label="Tone mapping" value={draft.toneMapping} options={["none", "linear", "reinhard", "cineon", "aces", "agx", "neutral"].map((value) => ({ value, label: value }))} onChange={(toneMapping) => changeConfig({ toneMapping: toneMapping as Project3DConfig["toneMapping"] })} /><Toggle label="Color LUT" value={draft.lutEnabled} onChange={(lutEnabled) => changeConfig({ lutEnabled })} /><Range label="LUT intensity" value={draft.lutIntensity} min={0} max={1} step={0.01} onChange={(lutIntensity) => changeConfig({ lutIntensity })} /></Panel></> : activeTab === "camera" ? <><Panel title="Controls"><Toggle label="Orbit" value={draft.cameraOrbitEnabled} onChange={(cameraOrbitEnabled) => changeConfig({ cameraOrbitEnabled })} /><Toggle label="Pan" value={draft.cameraPanEnabled} onChange={(cameraPanEnabled) => changeConfig({ cameraPanEnabled })} /><Toggle label="Zoom" value={draft.cameraZoomEnabled} onChange={(cameraZoomEnabled) => changeConfig({ cameraZoomEnabled })} /><Toggle label="Damping" value={draft.cameraDampingEnabled} onChange={(cameraDampingEnabled) => changeConfig({ cameraDampingEnabled })} /><Toggle label="Auto rotate" value={draft.autoRotate} onChange={(autoRotate) => changeConfig({ autoRotate })} /></Panel><Panel title="Lens and limits"><Range label="Desktop FOV" value={draft.cameraFovDesktop} min={10} max={120} step={1} suffix="°" onChange={(cameraFovDesktop) => changeConfig({ cameraFovDesktop })} /><Range label="Mobile FOV" value={draft.cameraFovMobile} min={10} max={120} step={1} suffix="°" onChange={(cameraFovMobile) => changeConfig({ cameraFovMobile })} /><Range label="Near clip" value={draft.cameraNearClip} min={0.01} max={10} step={0.01} suffix="m" onChange={(cameraNearClip) => changeConfig({ cameraNearClip })} /><Range label="Far clip" value={draft.cameraFarClip} min={100} max={20000} step={50} suffix="m" onChange={(cameraFarClip) => changeConfig({ cameraFarClip })} /></Panel><Panel title="Idle camera"><Toggle label="Idle drone" value={draft.idleDroneEnabled} onChange={(idleDroneEnabled) => changeConfig({ idleDroneEnabled })} /><Range label="Start after" value={draft.idleDroneDelaySec} min={5} max={600} step={1} suffix="s" onChange={(idleDroneDelaySec) => changeConfig({ idleDroneDelaySec })} /><Range label="Orbit duration" value={draft.idleDroneOrbitDurationSec} min={20} max={300} step={1} suffix="s" onChange={(idleDroneOrbitDurationSec) => changeConfig({ idleDroneOrbitDurationSec })} /><Button type="button" variant="secondary" size="sm" onClick={() => viewerRef.current?.previewIdleDrone()}>Preview flight</Button></Panel></> : activeTab === "shots" ? <Panel title="Camera shots"><Button type="button" variant="secondary" size="sm" onClick={addShot}>Capture current view</Button>{draft.cameraPresets.map((shot, index) => <div key={shot.id} className="flex items-center justify-between gap-2 rounded border border-neutral-800 p-2 text-xs"><button type="button" className="min-w-0 flex-1 truncate text-left text-neutral-200" onClick={() => viewerRef.current?.flyToPreset(shot)}>{index === 0 ? "Opening · " : ""}{shot.label}</button><button type="button" className="text-red-300" onClick={() => changeConfig({ cameraPresets: draft.cameraPresets.filter((item) => item.id !== shot.id) })}>Remove</button></div>)}</Panel> : activeTab === "sections" ? <Panel title="Sections"><Button type="button" variant="secondary" size="sm" onClick={addSection}>Add section from model</Button>{draft.sections.map((section) => <div key={section.id} className="rounded border border-neutral-800 p-2 text-xs text-neutral-300"><button type="button" className="font-medium" onClick={() => viewerRef.current?.activateSection(section, { showIndicator: true })}>{section.name}</button><div className="mt-2 flex gap-2"><button type="button" onClick={() => viewerRef.current?.activateSection(null)}>Clear</button><button type="button" className="text-red-300" onClick={() => changeConfig({ sections: draft.sections.filter((item) => item.id !== section.id) })}>Remove</button></div></div>)}</Panel> : activeTab === "performance" ? <><Panel title="Quality"><Choice label="Profile" value={draft.qualityPreset} options={["ultra_desktop", "high_desktop", "balanced", "mobile_high", "mobile_low", "custom"].map((value) => ({ value, label: value.replaceAll("_", " ") }))} onChange={(qualityPreset) => changeConfig({ qualityPreset: qualityPreset as Project3DConfig["qualityPreset"] })} /><Choice label="Renderer" value={draft.renderingMode} options={[{ value: "auto", label: "Auto" }, { value: "webgpu", label: "WebGPU" }, { value: "webgl2", label: "WebGL 2" }]} onChange={(renderingMode) => changeConfig({ renderingMode: renderingMode as Project3DConfig["renderingMode"] })} /><Toggle label="Adaptive quality" value={draft.adaptiveQualityEnabled} onChange={(adaptiveQualityEnabled) => changeConfig({ adaptiveQualityEnabled })} /><Toggle label="Reduce quality during interaction" value={draft.interactionQualityReductionEnabled} onChange={(interactionQualityReductionEnabled) => changeConfig({ interactionQualityReductionEnabled })} /></Panel>{perf ? <Panel title="Live renderer"><p className="font-mono text-xs text-neutral-300">{Math.round(perf.fps)} fps · {perf.frameTimeMs.toFixed(1)} ms</p><p className="font-mono text-xs text-neutral-400">{perf.drawCalls} draws · {perf.triangles.toLocaleString()} triangles · DPR {perf.dpr.toFixed(2)}</p></Panel> : null}</> : null;

  if (activeTab === "units" && model) return <div className="space-y-4"><EditorHeader initial={initial} reason={reason} setReason={setReason} pending={pending} dirty={configDirty || modelDirty} error={error} save={save} reset={() => { setDraft(structuredClone(DEFAULT_PROJECT_3D_CONFIG)); setConfigDirty(true); }} /><UnitBindingEditor projectId={initial.project.id} versionId={model.id} /></div>;

  return <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-xl">
    <EditorHeader initial={initial} reason={reason} setReason={setReason} pending={pending} dirty={configDirty || modelDirty} error={error} save={save} reset={() => { setDraft(structuredClone(DEFAULT_PROJECT_3D_CONFIG)); setConfigDirty(true); }} />
    <div className="flex h-[min(76vh,820px)] min-h-[620px]">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-neutral-800 lg:block"><div className="border-b border-neutral-800 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Models</p>{initial.slots.map((slot) => <div key={slot.id} className="mt-3"><p className="text-xs font-semibold text-neutral-300">{slot.displayName}</p>{slot.versions.map((version) => <button key={version.id} type="button" onClick={() => setActiveVersionId(version.id)} className={cn("mt-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs", activeVersionId === version.id ? "bg-indigo-500/20 text-indigo-200" : "text-neutral-400 hover:bg-neutral-900")}><span>v{version.version} · {version.originalFileName}</span><span className={version.asset ? "text-emerald-400" : "text-neutral-600"}>●</span></button>)}</div>)}</div><div className="p-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Scene nodes</p>{sceneManifest.map((node) => <button key={node.nodeId} type="button" onClick={() => { setSelectedNodeId(node.nodeId); setActiveTab("materials"); }} className="block w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-900" style={{ paddingLeft: `${8 + node.depth * 10}px` }}>{node.name}</button>)}</div></aside>
      <main className="relative min-w-0 flex-1 bg-neutral-900"><ThreeProjectViewer ref={viewerRef} detailModels={models} cameraConfig={draft} qualityConfig={draft} environmentConfig={draft} lightingConfig={draft} renderingConfig={draft} unitsConfig={draft} siteConfig={{ ...draft, latitude: draft.mapViewLatitude, longitude: draft.mapViewLongitude }} className="relative h-full w-full" showPerfStats={activeTab === "performance"} onPerfStats={setPerf} /><div className="absolute left-3 top-3 flex gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => viewerRef.current?.resetView()}>Reset view</Button></div></main>
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 p-3">{inspector}</aside>
    </div>
    <nav className="flex overflow-x-auto border-t border-neutral-800 bg-neutral-950 px-2">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={cn("flex min-w-fit items-center gap-1.5 border-t-2 px-3 py-2 text-xs", activeTab === id ? "border-indigo-400 text-white" : "border-transparent text-neutral-500 hover:text-neutral-200")}><Icon className="size-3.5" />{label}</button>)}</nav>
  </div>;
}

function EditorHeader({ initial, reason, setReason, pending, dirty, error, save, reset }: { initial: Project3DEditorWorkspace; reason: string; setReason: (value: string) => void; pending: boolean; dirty: boolean; error: string | null; save: () => Promise<void>; reset: () => void }) {
  return <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-3"><div className="mr-auto"><p className="text-sm font-semibold">{initial.project.name} · 3D Experience</p><p className="text-[11px] text-neutral-500">{initial.project.company.name} · {initial.project.code}</p></div><Badge tone={dirty ? "warning" : "success"}>{dirty ? "UNSAVED" : "SAVED"}</Badge><Input aria-label="Change reason" className="h-8 w-64 border-neutral-700 bg-neutral-900 text-xs text-neutral-100" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for this change" disabled={pending} /><Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}><RotateCcw /> Reset defaults</Button><Button type="button" size="sm" onClick={() => void save()} disabled={pending || !dirty}><Save />{pending ? "Saving…" : "Save"}</Button>{error ? <p role="alert" className="w-full text-right text-xs text-red-300">{error}</p> : null}</div>;
}
