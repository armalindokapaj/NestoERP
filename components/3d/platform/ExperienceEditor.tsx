"use client";

import { SectionsPanel } from "./editor/sections-panel";
import { ShotsPanel } from "./editor/shots-panel";
import { StatusBar } from "./editor/status-bar";
import { CameraEditorTools } from "./editor/camera-tools";
import { SlotAnchorPanel, SlotName } from "./editor/slot-controls";
import { PublishPanel } from "./editor/publish-panel";
import { platformEnvironmentBase, resolveEnvironmentRefs } from "@/lib/3d/shared/environment-refs";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { unsaved } from "@/lib/unsaved/coordinator";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Blocks, BookMarked, Camera, CircleGauge, Cuboid, ExternalLink, Layers3, Lightbulb, LoaderCircle, Map as MapIcon, MousePointerClick, Mountain, Palette, PanelLeftClose,
  PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw, Rocket, RotateCcw, Ruler, Search, Expand, Minimize, ScanLine, Sun, Trash2, Video, X,
} from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import type { ThreeProjectViewerHandle } from "@/components/3d/company/viewerTypes";
import { UnitBindingEditor } from "@/components/3d/platform/UnitBindingEditor";
import { ModelIngestionPanel, versionIssues, versionStateLabel } from "@/components/3d/platform/ModelIngestionPanel";
import { RemoveModelDialog } from "@/components/3d/platform/RemoveModelDialog";
import { useModelProcessingPoll } from "@/components/3d/platform/use-model-processing-poll";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { PROJECT_3D_PLATFORM_API_ROOT } from "@/lib/3d/platform";
import { publishExperienceEditorSaved, subscribeExperienceEditorSaved } from "@/lib/3d/platform/editor-sync";
import type { ModelLoadStatus } from "@/lib/3d/runtime/render-engine/RenderEngine";
import type { Project3DConfig, ProjectDetailModel, Section } from "@/lib/3d/runtime/types";
import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import type { Project3DNodeOverride, Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { cn } from "@/lib/utils/cn";
import { Choice, Color, Panel, PanelBoundary, Range, Toggle } from "./editor/controls";
import { EditorTopbar } from "./editor/EditorTopbar";
import {
  CameraExtraPanels, EnvironmentExtraPanels, InteractionPanels, LightingExtraPanels, MapPanels, MaterialExtraPanels, MaterialNodeList,
  PerformanceExtraPanels, PresetsPanel, RenderingExtraPanels, UnitListPanel, UnitStylePanels,
  type SiteStatus,
} from "./editor/extended-panels";
import { ResizeHandle } from "./editor/ResizeHandle";
import { classifySaveFailure, editorSaveStatus, noticeForStateCheck, PANEL_LIMITS, type EditorNotice } from "./editor/save-state";
import { useEditorLayout } from "./editor/use-editor-layout";

/*
 * The renderer, three.js and its post-processing are the heaviest part of the
 * editor. Loaded on their own after the editor chrome is interactive, so the
 * top bar, panels and tools answer while the 3D engine is still arriving
 * (3D Editor PRD §80, §81, §204, §208).
 */
const ThreeProjectViewer = dynamic(
  () => import("@/components/3d/company/ThreeProjectViewer").then((module) => module.ThreeProjectViewer),
  { ssr: false, loading: () => <ViewportMessage busy>Starting the 3D renderer…</ViewportMessage> },
);

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
  /** Still PROCESSING long after anything could be preparing it: it can be put back in line. */
  stalled?: boolean;
  retryable?: boolean;
  /** Ready, but its prepared file is no longer in storage. */
  assetMissing?: boolean;
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
  config: {
    id: string;
    experienceName: string;
    activeReleaseId: string | null;
    activeRelease: { id: string; releaseNumber: number } | null;
    updatedAt: string;
    document: { schemaVersion: 1; revision: number; config: Project3DConfig };
  };
  permissions: { configure: boolean; manageModels: boolean; manageBindings: boolean };
  /** The largest GLB this deployment's storage accepts. */
  uploadLimitBytes: number;
  slots: EditorSlot[];
  units: EditorUnit[];
};

type Tool = "scene" | "materials" | "environment" | "lighting" | "rendering" | "camera" | "shots" | "sections" | "performance" | "units" | "unitStyle" | "interaction" | "map" | "presets" | "publish";
const TOOLS: Array<{ id: Tool; label: string; icon: typeof Cuboid }> = [
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
  { id: "unitStyle", label: "Units", icon: Blocks },
  { id: "interaction", label: "Interaction", icon: MousePointerClick },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "presets", label: "Presets", icon: BookMarked },
  { id: "publish", label: "Publish", icon: Rocket },
];
/** Tools added from the Rozaris editor: their whole panel comes from extended-panels. */
const EXTENDED_TOOLS: Tool[] = ["unitStyle", "interaction", "map", "presets", "publish"];
const TOOL_IDS = TOOLS.map((tool) => tool.id);

/** A model version's authored settings: what Save sends for it, and the `updatedAt` it was read at. */
type ModelSettings = Pick<EditorVersion, "scale" | "rotationDeg" | "altitudeOffset" | "positionX" | "positionZ" | "rotationXDeg" | "rotationZDeg" | "visible" | "castShadow" | "receiveShadow" | "selectable" | "transformLocked" | "updatedAt"> & { nodeOverrides: Project3DNodeOverride[] };

const API = PROJECT_3D_PLATFORM_API_ROOT;
const MIN_WIDTH = 1280;
const MIN_HEIGHT = 720;

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

function settingsOf(version: EditorVersion): ModelSettings {
  return {
    scale: version.scale, rotationDeg: version.rotationDeg, altitudeOffset: version.altitudeOffset, positionX: version.positionX, positionZ: version.positionZ,
    rotationXDeg: version.rotationXDeg, rotationZDeg: version.rotationZDeg, visible: version.visible, castShadow: version.castShadow, receiveShadow: version.receiveShadow,
    selectable: version.selectable, transformLocked: version.transformLocked, nodeOverrides: overridesOf(version.nodeOverrides), updatedAt: version.updatedAt,
  };
}

function isReady(version: Pick<EditorVersion, "status">): boolean {
  return version.status === "READY" || version.status === "PUBLISHED";
}

/**
 * `pinned` keeps the first signed address each version was given: a refresh
 * signs new ones, and a changed address would make the renderer download a
 * model it already shows. A failed load clears it (Retry).
 */
function runtimeModel(version: EditorVersion, settings: ModelSettings, pinned: Map<string, string>): ProjectDetailModel | null {
  if (!version.asset) return null;
  const glbUrl = pinned.get(version.id) ?? version.asset.url;
  pinned.set(version.id, glbUrl);
  return {
    glbUrl,
    fileName: version.asset.fileName,
    fileSize: 0,
    scale: settings.scale,
    rotationDeg: settings.rotationDeg,
    altitudeOffset: settings.altitudeOffset,
    positionX: settings.positionX,
    positionZ: settings.positionZ,
    rotationXDeg: settings.rotationXDeg,
    rotationZDeg: settings.rotationZDeg,
    enabled: true,
    visible: settings.visible,
    castShadow: settings.castShadow,
    receiveShadow: settings.receiveShadow,
    selectable: settings.selectable,
    transformLocked: settings.transformLocked,
    updatedAt: settings.updatedAt,
    unitLinks: version.unitBindings,
    sceneManifest: manifestOf(version.sceneManifest).map((node) => ({ nodeId: node.nodeId, name: node.name, meshIndex: node.meshIndex, parentNodeId: node.parentNodeId, depth: node.depth, isMesh: node.isMesh, autoClassification: node.autoClassification })),
    nodeOverrides: settings.nodeOverrides,
    triangleCount: version.triangleCount,
    meshCount: version.meshCount,
    materialCount: version.materialCount,
    textureCount: version.textureCount,
  };
}

/** True once `value` has held for `delayMs`: a quick transform re-sync does not flash "Loading". */
function useSettled(value: boolean, delayMs: number): boolean {
  const [settled, setSettled] = React.useState(false);
  React.useEffect(() => {
    if (!value) { setSettled(false); return; }
    const timer = window.setTimeout(() => setSettled(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * The one Experience Editor (3D Editor PRD §16-§18, §246).
 *
 * Rendered only by the dedicated editor tab, and sized to whatever holds it:
 * the tab's layout gives it the whole window. Save persists the draft through
 * the canonical Experience and model APIs with their optimistic revision
 * checks; publishing stays in Releases, so nothing here changes what tenants
 * see (§90-§96).
 */
export function ExperienceEditor({ initial }: { initial: Project3DEditorWorkspace }) {
  const router = useRouter();
  const toast = useToast();
  const projectId = initial.project.id;
  const { permissions } = initial;
  const managementHref = `/admin/3d/projects/${projectId}`;
  const versions = React.useMemo(() => initial.slots.flatMap((slot) => slot.versions), [initial.slots]);
  const [layout, updateLayout] = useEditorLayout(TOOL_IDS, "scene");
  const tool = layout.tool;

  const [activeVersionId, setActiveVersionId] = React.useState<string | null>(() => (versions.find((version) => version.asset) ?? versions[0] ?? null)?.id ?? null);
  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? null;

  const [draft, setDraft] = React.useState<Project3DConfig>(() => structuredClone(initial.config.document.config));
  const [revision, setRevision] = React.useState(initial.config.document.revision);
  const [configDirty, setConfigDirty] = React.useState(false);
  // The last saved settings of every model version, and this tab's unsaved edits to any of them.
  const [savedSettings, setSavedSettings] = React.useState<Record<string, ModelSettings>>(() => Object.fromEntries(versions.map((version) => [version.id, settingsOf(version)])));
  const [modelEdits, setModelEdits] = React.useState<Record<string, ModelSettings>>({});
  const [bindingsDirty, setBindingsDirty] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  /** A version uploaded in this tab, selected once it is ready. */
  const [autoSelectId, setAutoSelectId] = React.useState<string | null>(null);
  const [removingSlot, setRemovingSlot] = React.useState<EditorSlot | null>(null);
  const [retryingId, setRetryingId] = React.useState<string | null>(null);
  const assetUrls = React.useRef(new Map<string, string>());
  const [bindingsOpened, setBindingsOpened] = React.useState(tool === "units");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<EditorNotice | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [pendingVersionId, setPendingVersionId] = React.useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  /** Editor-only: shows the unit blocks in the viewport on the unit tools (Rozaris "Status Preview"). */
  const [statusPreview, setStatusPreview] = React.useState(true);
  const [selectedUnitId, setSelectedUnitId] = React.useState<string | null>(null);
  const [modelStatus, setModelStatus] = React.useState<ModelLoadStatus>({ state: "loading" });
  const [renderScale, setRenderScale] = React.useState<number | null>(null);
  const [sceneSearch, setSceneSearch] = React.useState("");
  // Rozaris EditorViewport: the viewport alone can go fullscreen.
  const viewportRef = React.useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === viewportRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void viewportRef.current?.requestFullscreen();
  }
  const [siteStatus, setSiteStatus] = React.useState<SiteStatus>(null);
  const [perf, setPerf] = React.useState<{ fps: number; frameTimeMs: number; drawCalls: number; triangles: number; textures: number; dpr: number } | null>(null);
  const [smallScreen, setSmallScreen] = React.useState(false);
  const [smallScreenDismissed, setSmallScreenDismissed] = React.useState(false);
  const viewerRef = React.useRef<ThreeProjectViewerHandle>(null);
  /** The unsaved draft came from "Reset defaults", so its save is audited as a reset (§16). */
  const resetPendingRef = React.useRef(false);
  /** Set just before a reload the author asked for, so it is not stopped as an accidental close. */
  const leavingRef = React.useRef(false);
  const revisionRef = React.useRef(revision);
  revisionRef.current = revision;
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const dirty = configDirty || Object.keys(modelEdits).length > 0;
  const status = editorSaveStatus({ dirty, saving, failed });
  const loadingShown = useSettled(modelStatus.state === "loading", 250);

  React.useEffect(() => {
    if (tool === "units") setBindingsOpened(true);
  }, [tool]);

  // Models being prepared are watched; the page data refreshes when one is ready or failed.
  useModelProcessingPoll(projectId, initial.slots, autoSelectId);

  // Server truth for every version this tab has not saved since: after a refresh (a model finished
  // preparing, another tab saved it) the next Save must carry the row's current `updatedAt`.
  React.useEffect(() => {
    setSavedSettings((current) => {
      let changed = false;
      const next = { ...current };
      for (const version of versions) {
        const known = current[version.id];
        if (!known || Date.parse(version.updatedAt) > Date.parse(known.updatedAt)) {
          next[version.id] = settingsOf(version);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [versions]);

  // A model uploaded here is selected once it is ready; with nothing selected, the first model is.
  React.useEffect(() => {
    if (autoSelectId && versions.some((version) => version.id === autoSelectId && version.asset)) {
      setAutoSelectId(null);
      if (!bindingsDirty) {
        setActiveVersionId(autoSelectId);
        setSelectedNodeId(null);
      }
      return;
    }
    if (activeVersionId && versions.some((version) => version.id === activeVersionId)) return;
    const first = versions.find((version) => version.asset) ?? versions[0] ?? null;
    if ((first?.id ?? null) !== activeVersionId) {
      setActiveVersionId(first?.id ?? null);
      setSelectedNodeId(null);
    }
  }, [versions, autoSelectId, activeVersionId, bindingsDirty]);

  function setTool(next: Tool) {
    updateLayout({ tool: next });
  }

  function changeConfig(patch: Partial<Project3DConfig>) {
    if (!permissions.configure) return;
    setDraft((current) => ({ ...current, ...patch }));
    setConfigDirty(true);
  }

  const model = activeVersion ? { ...activeVersion, ...(modelEdits[activeVersion.id] ?? savedSettings[activeVersion.id] ?? settingsOf(activeVersion)) } : null;

  /** Rozaris "Ground Align": lifts or lowers the active model so its lowest point sits at ground level. */
  function groundAlign() {
    const slot = initial.slots.find((candidate) => candidate.versions.some((version) => version.id === activeVersionId));
    const offset = slot ? viewerRef.current?.computeGroundAlignOffset(slot.id) : null;
    if (offset != null) changeModel({ altitudeOffset: offset });
  }

  function changeModel(patch: Partial<ModelSettings>) {
    if (!activeVersion || !permissions.manageModels) return;
    const id = activeVersion.id;
    const base = savedSettings[id] ?? settingsOf(activeVersion);
    setModelEdits((current) => ({ ...current, [id]: { ...(current[id] ?? base), ...patch } }));
  }

  const sceneManifest = manifestOf(model?.sceneManifest);
  const selectedOverride = model?.nodeOverrides.find((item) => item.nodeId === selectedNodeId) ?? null;
  function changeOverride(patch: Partial<Project3DNodeOverride>) {
    if (!model || !selectedNodeId) return;
    const current = model.nodeOverrides;
    const index = current.findIndex((item) => item.nodeId === selectedNodeId);
    const next = [...current];
    if (index < 0) next.push({ nodeId: selectedNodeId, materialOverrideEnabled: true, ...patch });
    else next[index] = { ...next[index], ...patch };
    changeModel({ nodeOverrides: next });
  }

  function chooseVersion(id: string) {
    if (id === activeVersionId) return;
    // Model settings are kept per version; only unsaved unit links belong to the version on screen.
    if (bindingsDirty) { setPendingVersionId(id); return; }
    setActiveVersionId(id);
    setSelectedNodeId(null);
  }

  const units = React.useMemo(() => initial.units.map((unit) => ({ id: unit.id, code: unit.unitCode, status: statusOf(unit) })), [initial.units]);
  // Stored backdrop photos and IES profiles are references; the viewport reads them through the editor's route.
  const viewerDraft = React.useMemo(() => resolveEnvironmentRefs(draft, platformEnvironmentBase(projectId)), [draft, projectId]);
  const siteConfig = React.useMemo(() => ({ ...draft, latitude: draft.mapViewLatitude, longitude: draft.mapViewLongitude }), [draft]);
  const models = React.useMemo(() => initial.slots.flatMap((slot) => {
    // The selected version when it is this model's and is ready; otherwise the model's newest ready one.
    const chosen = slot.versions.find((version) => version.id === activeVersionId && version.asset) ?? slot.versions.find((version) => version.asset);
    if (!chosen) return [];
    const runtime = runtimeModel(chosen, modelEdits[chosen.id] ?? savedSettings[chosen.id] ?? settingsOf(chosen), assetUrls.current);
    return runtime ? [{ slotId: slot.id, slotName: slot.displayName, slotRole: slot.role.toLowerCase() as "building" | "units" | "surroundings" | "context" | "custom", transformParentSlotId: slot.transformParentSlotId, versionId: chosen.id, model: runtime, units }] : [];
  }), [activeVersionId, initial.slots, units, modelEdits, savedSettings]);

  async function save() {
    if (saving || !dirty) return;
    if (!permissions.configure) return;
    setSaving(true);
    setError(null);
    const sentDraft = draft;
    const sentEdits = modelEdits;
    const sentReset = resetPendingRef.current;
    let savedSomething = false;
    try {
      if (configDirty) {
        const result = await engineeringApi<{ document: { revision: number; config: Project3DConfig } }>(`${API}/projects/${projectId}/config`, { method: "PUT", body: { expectedRevision: revision, config: sentDraft, ...(sentReset ? { resetToDefaults: true } : {}) } });
        if (sentReset) resetPendingRef.current = false;
        savedSomething = true;
        revisionRef.current = result.document.revision;
        setRevision(result.document.revision);
        // A change made while the save was in flight stays unsaved.
        if (draftRef.current === sentDraft) {
          setDraft(result.document.config);
          setConfigDirty(false);
        }
      }
      for (const [versionId, settings] of Object.entries(sentEdits)) {
        const { updatedAt, ...body } = settings;
        const result = await engineeringApi<{ updatedAt: string }>(`${API}/projects/${projectId}/versions/${versionId}`, { method: "PATCH", body: { ...body, expectedUpdatedAt: updatedAt } });
        savedSomething = true;
        setSavedSettings((current) => ({ ...current, [versionId]: { ...settings, updatedAt: result.updatedAt } }));
        setModelEdits((current) => {
          const edit = current[versionId];
          if (!edit) return current;
          if (edit === settings) {
            const rest = { ...current };
            delete rest[versionId];
            return rest;
          }
          return { ...current, [versionId]: { ...edit, updatedAt: result.updatedAt } };
        });
      }
      setFailed(false);
      setNotice((current) => (current?.kind === "conflict" ? current : null));
      // Saving publishes too: the viewers show a release, so a save makes a new one
      // from the saved settings and the model versions this editor is showing.
      try {
        await engineeringApi(`${API}/projects/${projectId}/releases`, { body: { versionIds: models.map((model) => model.versionId) } });
        toast({ title: "Saved and published.", description: "The Company and public viewers now show these changes.", tone: "success" });
      } catch (failure) {
        toast({ title: "Saved, but not published.", description: failureMessage(failure, "The viewers still show the previous release."), tone: "danger" });
      }
    } catch (failure) {
      setFailed(true);
      const kind = classifySaveFailure(failure);
      if (kind === "conflict") setNotice({ kind: "conflict", revision: null });
      else if (kind === "session") setNotice({ kind: "session" });
      else if (kind === "access") setNotice({ kind: "access" });
      else setError(failureMessage(failure, "The draft could not be saved. Your changes are still here."));
    } finally {
      setSaving(false);
      if (savedSomething) publishExperienceEditorSaved(projectId, revisionRef.current);
    }
  }
  const saveRef = React.useRef(save);
  saveRef.current = save;

  // Unsaved work is protected against closing, reloading and leaving the tab (§46-§48).
  const guarded = dirty || bindingsDirty || uploading;
  const { setDirty: setSessionDirty, setPendingUploads: setSessionUploads } = useUnsavedEditor({ module: "project_3d", saveKind: "none", label: "3D Experience" });
  React.useEffect(() => {
    setSessionDirty(guarded);
    setSessionUploads(uploading);
  }, [guarded, uploading, setSessionDirty, setSessionUploads]);
  React.useEffect(() => {
    if (!guarded) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current || unsaved.isLeaving()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [guarded]);

  // Ctrl/Cmd+S saves directly from anywhere in the editor (§122; no-reason PRD
  // §23), and never opens the browser's own dialog.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Another tab saved this Experience: this draft is now behind (§137).
  React.useEffect(() => subscribeExperienceEditorSaved(projectId, (remote) => {
    if (remote > revisionRef.current) setNotice({ kind: "conflict", revision: remote });
  }), [projectId]);

  // Returning to the tab re-checks the session, the access and the saved revision (§44, §151-§155).
  React.useEffect(() => {
    let inFlight = false;
    async function check() {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`${API}/projects/${projectId}/config`, { cache: "no-store" });
        const result = response.ok
          ? { ok: true as const, revision: Number(((await response.json()) as { data?: { revision?: number } })?.data?.revision) }
          : { ok: false as const, status: response.status };
        const next = noticeForStateCheck(result, revisionRef.current);
        setNotice((current) => next ?? (result.ok && current?.kind !== "conflict" ? null : current));
      } catch {
        // Offline: the next save says so.
      } finally {
        inFlight = false;
      }
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [projectId]);

  React.useEffect(() => {
    const measure = () => setSmallScreen(window.innerWidth < MIN_WIDTH || window.innerHeight < MIN_HEIGHT);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function reloadLatest() {
    leavingRef.current = true;
    window.location.reload();
  }

  function retryModels() {
    // A refresh signs fresh model addresses; the draft in this tab is untouched.
    assetUrls.current.clear();
    setModelStatus({ state: "loading" });
    router.refresh();
  }

  async function retryProcessing(versionId: string) {
    setRetryingId(versionId);
    setError(null);
    try {
      await engineeringApi(`${API}/projects/${projectId}/versions/${versionId}/process`, { body: {} });
      toast({ title: "Preparing the model again.", tone: "success" });
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, "The model could not be put back in line."));
    } finally {
      setRetryingId(null);
    }
  }

  function modelRemoved(slotId: string) {
    const removed = initial.slots.find((slot) => slot.id === slotId);
    const ids = new Set(removed?.versions.map((version) => version.id) ?? []);
    // Unsaved settings of the removed model's versions have nothing left to apply to.
    setModelEdits((current) => Object.fromEntries(Object.entries(current).filter(([versionId]) => !ids.has(versionId))));
    if (activeVersionId && ids.has(activeVersionId)) {
      setActiveVersionId(null);
      setSelectedNodeId(null);
    }
    toast({ title: `${removed?.displayName ?? "Model"} removed.`, description: "The published viewer changes only when a release is published.", tone: "success" });
    router.refresh();
  }



  const unitBlocksShown = statusPreview && (tool === "unitStyle" || tool === "units" || tool === "interaction");
  const applyUnitsMode = React.useCallback(() => viewerRef.current?.setUnitsMode(unitBlocksShown), [unitBlocksShown]);
  React.useEffect(() => { applyUnitsMode(); }, [applyUnitsMode, models]);

  function selectUnit(unitId: string | null) {
    setSelectedUnitId(unitId);
    viewerRef.current?.setSelectedUnit(unitId);
  }

  function restoreOriginal() {
    if (!model || !selectedNodeId) return;
    changeModel({ nodeOverrides: model.nodeOverrides.filter((item) => item.nodeId !== selectedNodeId) });
  }

  const modelLocked = !model || !permissions.manageModels || !isReady(model);
  const modelState = model && (!isReady(model) || model.assetMissing) ? <Panel title="Model state">
    <p className="text-xs text-neutral-200">{versionStateLabel(model)}</p>
    <p className="text-xs leading-5 text-neutral-400">{model.assetMissing ? "Its prepared file is no longer in storage. Upload the GLB again as a new version of this model." : model.retryable ? "Preparing it failed on the server. Retry it, or upload a corrected GLB as a new version." : model.status === "FAILED" ? "Upload a corrected GLB as a new version of this model." : model.status === "UPLOADED" ? "Its file never finished uploading. Upload it again." : model.stalled ? "Nothing has worked on it for several minutes." : "It appears in the scene when it is ready. Its settings can be edited then."}</p>
    {versionIssues(model).map((issue, index) => <p key={index} className="text-xs leading-5 text-amber-200">{issue}</p>)}
    {(model.stalled || model.retryable) && permissions.manageModels ? <Button type="button" size="sm" variant="secondary" disabled={retryingId === model.id} onClick={() => void retryProcessing(model.id)}><RefreshCw aria-hidden="true" />{retryingId === model.id ? "Retrying…" : "Retry preparation"}</Button> : null}
  </Panel> : null;
  const inspector = tool === "scene" ? <>
    {modelState}
    <Panel title="Model visibility"><Toggle label="Visible" value={model?.visible ?? false} disabled={modelLocked} onChange={(visible) => changeModel({ visible })} /><Toggle label="Cast shadows" value={model?.castShadow ?? false} disabled={modelLocked} onChange={(castShadow) => changeModel({ castShadow })} /><Toggle label="Receive shadows" value={model?.receiveShadow ?? false} disabled={modelLocked} onChange={(receiveShadow) => changeModel({ receiveShadow })} /><Toggle label="Selectable" value={model?.selectable ?? false} disabled={modelLocked} onChange={(selectable) => changeModel({ selectable })} /><Toggle label="Lock transform" value={model?.transformLocked ?? false} disabled={modelLocked} onChange={(transformLocked) => changeModel({ transformLocked })} /></Panel>
    <Panel title="Transform"><Range label="Scale" value={model?.scale ?? 1} min={0.01} max={20} step={0.01} onChange={(scale) => changeModel({ scale })} disabled={modelLocked || !model?.asset || model?.transformLocked} /><Range label="Position X" value={model?.positionX ?? 0} min={-500} max={500} step={0.5} suffix="m" onChange={(positionX) => changeModel({ positionX })} disabled={modelLocked || model?.transformLocked} /><Range label="Position Y" value={model?.altitudeOffset ?? 0} min={-500} max={500} step={0.5} suffix="m" onChange={(altitudeOffset) => changeModel({ altitudeOffset })} disabled={modelLocked || model?.transformLocked} /><Range label="Position Z" value={model?.positionZ ?? 0} min={-500} max={500} step={0.5} suffix="m" onChange={(positionZ) => changeModel({ positionZ })} disabled={modelLocked || model?.transformLocked} /><Range label="Rotation X" value={model?.rotationXDeg ?? 0} min={-180} max={180} step={1} suffix="°" onChange={(rotationXDeg) => changeModel({ rotationXDeg })} disabled={modelLocked || model?.transformLocked} /><Range label="Rotation Y" value={model?.rotationDeg ?? 0} min={-180} max={180} step={1} suffix="°" onChange={(rotationDeg) => changeModel({ rotationDeg })} disabled={modelLocked || model?.transformLocked} /><Range label="Rotation Z" value={model?.rotationZDeg ?? 0} min={-180} max={180} step={1} suffix="°" onChange={(rotationZDeg) => changeModel({ rotationZDeg })} disabled={modelLocked || model?.transformLocked} />
      {/* Rozaris ModelPanel: rest the model on the ground, or put every transform back to its origin. */}
      <div className="flex gap-2"><button type="button" onClick={groundAlign} disabled={modelLocked || !model?.asset || model?.transformLocked} className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"><Ruler className="h-3.5 w-3.5" /> Ground Align</button><button type="button" onClick={() => changeModel({ scale: 1, positionX: 0, altitudeOffset: 0, positionZ: 0, rotationXDeg: 0, rotationDeg: 0, rotationZDeg: 0 })} disabled={modelLocked || !model || model.transformLocked} className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Reset Transform</button></div></Panel>
  </> : tool === "materials" ? <>
    {modelState}
    <Panel title="Scene node"><Choice label="Node" value={selectedNodeId ?? ""} options={[{ value: "", label: "Choose a mesh" }, ...sceneManifest.filter((node) => node.isMesh && node.autoClassification !== "unit_block").map((node) => ({ value: node.nodeId, label: node.name }))]} onChange={(value) => setSelectedNodeId(value || null)} /></Panel>
    {selectedNodeId ? <Panel title="Material override"><Toggle label="Override material" value={selectedOverride?.materialOverrideEnabled ?? true} disabled={modelLocked} onChange={(materialOverrideEnabled) => changeOverride({ materialOverrideEnabled })} /><Choice label="Preset" value={selectedOverride?.materialPreset ?? "concrete"} disabled={modelLocked} options={["concrete", "plaster", "stone", "wood", "aluminium", "steel", "chrome", "ceramic"].map((value) => ({ value, label: value }))} onChange={(materialPreset) => changeOverride({ materialPreset: materialPreset as Project3DNodeOverride["materialPreset"] })} /><Color label="Base color" value={selectedOverride?.colorHex ?? "#cccccc"} disabled={modelLocked} onChange={(colorHex) => changeOverride({ colorHex })} /><Range label="Roughness" value={selectedOverride?.roughness ?? 0.5} min={0} max={1} step={0.01} disabled={modelLocked} onChange={(roughness) => changeOverride({ roughness })} /><Range label="Metalness" value={selectedOverride?.metalness ?? 0} min={0} max={1} step={0.01} disabled={modelLocked} onChange={(metalness) => changeOverride({ metalness })} /><Range label="Opacity" value={selectedOverride?.opacity ?? 1} min={0} max={1} step={0.01} disabled={modelLocked} onChange={(opacity) => changeOverride({ opacity })} /><Range label="Clearcoat" value={selectedOverride?.clearcoat ?? 0} min={0} max={1} step={0.01} disabled={modelLocked} onChange={(clearcoat) => changeOverride({ clearcoat })} /><Toggle label="Transmission" value={selectedOverride?.transmissionEnabled ?? false} disabled={modelLocked} onChange={(transmissionEnabled) => changeOverride({ transmissionEnabled })} /></Panel> : null}
  </> : tool === "environment" ? <><Panel title="Sun and sky"><Toggle label="Sky" value={draft.skyEnabled} onChange={(skyEnabled) => changeConfig({ skyEnabled })} /><Range label="Sun azimuth" value={draft.sunAzimuthDeg} min={0} max={360} step={1} suffix="°" onChange={(sunAzimuthDeg) => changeConfig({ sunAzimuthDeg })} /><Range label="Sun elevation" value={draft.sunElevationDeg} min={-10} max={90} step={1} suffix="°" onChange={(sunElevationDeg) => changeConfig({ sunElevationDeg })} /><Range label="Environment intensity" value={draft.environmentIntensity} min={0} max={0.5} step={0.005} onChange={(environmentIntensity) => changeConfig({ environmentIntensity })} /><Range label="Turbidity" value={draft.skyTurbidity} min={0} max={20} step={0.1} onChange={(skyTurbidity) => changeConfig({ skyTurbidity })} /></Panel><Panel title="Atmosphere"><Toggle label="Clouds" value={draft.cloudsEnabled} onChange={(cloudsEnabled) => changeConfig({ cloudsEnabled })} /><Toggle label="Fog" value={draft.fogEnabled} onChange={(fogEnabled) => changeConfig({ fogEnabled })} /><Range label="Fog density" value={draft.fogDensity} min={0} max={0.2} step={0.001} onChange={(fogDensity) => changeConfig({ fogDensity })} /><Toggle label="Water" value={draft.waterEnabled} onChange={(waterEnabled) => changeConfig({ waterEnabled })} /><Toggle label="Ground" value={draft.groundEnabled} onChange={(groundEnabled) => changeConfig({ groundEnabled })} /><Color label="Ground color" value={draft.groundColor} onChange={(groundColor) => changeConfig({ groundColor })} /></Panel></> : tool === "lighting" ? <><Panel title="Sun light"><Toggle label="Sun light" value={draft.sunLightEnabled} onChange={(sunLightEnabled) => changeConfig({ sunLightEnabled })} /><Range label="Temperature" value={draft.sunTemperatureK} min={1000} max={12000} step={50} suffix="K" onChange={(sunTemperatureK) => changeConfig({ sunTemperatureK })} /><Toggle label="Automatic intensity" value={draft.autoSunIntensityEnabled} onChange={(autoSunIntensityEnabled) => changeConfig({ autoSunIntensityEnabled })} /><Range label="Manual intensity" value={draft.manualSunIntensity} min={0} max={10} step={0.05} onChange={(manualSunIntensity) => changeConfig({ manualSunIntensity })} /></Panel><Panel title="Shadows and GI"><Toggle label="Shadows" value={draft.shadowsEnabled} onChange={(shadowsEnabled) => changeConfig({ shadowsEnabled })} /><Toggle label="Soft shadows" value={draft.softShadowsEnabled} onChange={(softShadowsEnabled) => changeConfig({ softShadowsEnabled })} /><Toggle label="Cascaded shadows" value={draft.csmEnabled} onChange={(csmEnabled) => changeConfig({ csmEnabled })} /><Toggle label="Contact shadows" value={draft.contactShadowsEnabled} onChange={(contactShadowsEnabled) => changeConfig({ contactShadowsEnabled })} /><Toggle label="Global illumination" value={draft.giEnabled} onChange={(giEnabled) => changeConfig({ giEnabled })} /><Toggle label="Volumetric lighting" value={draft.volumetricLightingEnabled} onChange={(volumetricLightingEnabled) => changeConfig({ volumetricLightingEnabled })} /></Panel></> : tool === "rendering" ? <><Panel title="Post processing"><Toggle label="Screen-space reflections" value={draft.ssrEnabled} onChange={(ssrEnabled) => changeConfig({ ssrEnabled })} /><Toggle label="Anti-aliasing" value={draft.antialiasEnabled} onChange={(antialiasEnabled) => changeConfig({ antialiasEnabled })} /><Toggle label="Bloom" value={draft.bloomEnabled} onChange={(bloomEnabled) => changeConfig({ bloomEnabled })} /><Range label="Bloom strength" value={draft.bloomStrength} min={0} max={5} step={0.05} onChange={(bloomStrength) => changeConfig({ bloomStrength })} /><Toggle label="Depth of field" value={draft.depthOfFieldEnabled} onChange={(depthOfFieldEnabled) => changeConfig({ depthOfFieldEnabled })} /><Toggle label="Motion blur" value={draft.motionBlurEnabled} onChange={(motionBlurEnabled) => changeConfig({ motionBlurEnabled })} /></Panel><Panel title="Color"><Range label="Exposure" value={draft.exposure} min={0.1} max={5} step={0.05} onChange={(exposure) => changeConfig({ exposure })} /><Choice label="Tone mapping" value={draft.toneMapping} options={["none", "linear", "reinhard", "cineon", "aces", "agx", "neutral"].map((value) => ({ value, label: value }))} onChange={(toneMapping) => changeConfig({ toneMapping: toneMapping as Project3DConfig["toneMapping"] })} /><Toggle label="Color LUT" value={draft.lutEnabled} onChange={(lutEnabled) => changeConfig({ lutEnabled })} /><Range label="LUT intensity" value={draft.lutIntensity} min={0} max={1} step={0.01} onChange={(lutIntensity) => changeConfig({ lutIntensity })} /></Panel></> : tool === "camera" ? <><Panel title="Controls"><Toggle label="Orbit" value={draft.cameraOrbitEnabled} onChange={(cameraOrbitEnabled) => changeConfig({ cameraOrbitEnabled })} /><Toggle label="Pan" value={draft.cameraPanEnabled} onChange={(cameraPanEnabled) => changeConfig({ cameraPanEnabled })} /><Toggle label="Zoom" value={draft.cameraZoomEnabled} onChange={(cameraZoomEnabled) => changeConfig({ cameraZoomEnabled })} /><Toggle label="Damping" value={draft.cameraDampingEnabled} onChange={(cameraDampingEnabled) => changeConfig({ cameraDampingEnabled })} /><Toggle label="Auto rotate" value={draft.autoRotate} onChange={(autoRotate) => changeConfig({ autoRotate })} /></Panel><Panel title="Lens and limits"><Range label="Desktop FOV" value={draft.cameraFovDesktop} min={10} max={120} step={1} suffix="°" onChange={(cameraFovDesktop) => changeConfig({ cameraFovDesktop })} /><Range label="Mobile FOV" value={draft.cameraFovMobile} min={10} max={120} step={1} suffix="°" onChange={(cameraFovMobile) => changeConfig({ cameraFovMobile })} /><Range label="Near clip" value={draft.cameraNearClip} min={0.01} max={10} step={0.01} suffix="m" onChange={(cameraNearClip) => changeConfig({ cameraNearClip })} /><Range label="Far clip" value={draft.cameraFarClip} min={100} max={20000} step={50} suffix="m" onChange={(cameraFarClip) => changeConfig({ cameraFarClip })} /></Panel><Panel title="Idle camera"><Toggle label="Idle drone" value={draft.idleDroneEnabled} onChange={(idleDroneEnabled) => changeConfig({ idleDroneEnabled })} /><Range label="Start after" value={draft.idleDroneDelaySec} min={5} max={600} step={1} suffix="s" onChange={(idleDroneDelaySec) => changeConfig({ idleDroneDelaySec })} /><Range label="Orbit duration" value={draft.idleDroneOrbitDurationSec} min={20} max={300} step={1} suffix="s" onChange={(idleDroneOrbitDurationSec) => changeConfig({ idleDroneOrbitDurationSec })} /></Panel><CameraEditorTools change={changeConfig} viewerRef={viewerRef} canEdit={permissions.configure} /></> : tool === "shots" ? <ShotsPanel draft={draft} change={changeConfig} viewerRef={viewerRef} canEdit={permissions.configure} /> : tool === "sections" ? <SectionsPanel draft={draft} change={changeConfig} viewerRef={viewerRef} canEdit={permissions.configure} /> : tool === "performance" ? <><Panel title="Quality"><Choice label="Profile" value={draft.qualityPreset} options={[{ value: "ultra_desktop", label: "Ultra (Desktop)" }, { value: "high_desktop", label: "High (Desktop)" }, { value: "balanced", label: "Balanced" }, { value: "mobile_high", label: "Mobile — High" }, { value: "mobile_low", label: "Mobile — Low" }, { value: "custom", label: "Custom" }]} onChange={(qualityPreset) => changeConfig({ qualityPreset: qualityPreset as Project3DConfig["qualityPreset"] })} /><Choice label="Renderer" value={draft.renderingMode} options={[{ value: "auto", label: "Auto (WebGPU → WebGL2)" }, { value: "webgpu", label: "WebGPU" }, { value: "webgl2", label: "Force WebGL2" }]} onChange={(renderingMode) => changeConfig({ renderingMode: renderingMode as Project3DConfig["renderingMode"] })} /><Toggle label="Adaptive quality" value={draft.adaptiveQualityEnabled} onChange={(adaptiveQualityEnabled) => changeConfig({ adaptiveQualityEnabled })} /><Toggle label="Reduce quality during interaction" value={draft.interactionQualityReductionEnabled} onChange={(interactionQualityReductionEnabled) => changeConfig({ interactionQualityReductionEnabled })} /></Panel>{perf ? <Panel title="Live renderer"><p className="font-mono text-xs text-neutral-300">{Math.round(perf.fps)} fps · {perf.frameTimeMs.toFixed(1)} ms</p><p className="font-mono text-xs text-neutral-400">{perf.drawCalls} draws · {perf.triangles.toLocaleString()} triangles · DPR {perf.dpr.toFixed(2)}</p></Panel> : null}</> : <Panel title="Unit binding"><p className="text-xs leading-5 text-neutral-400">Link named scene nodes of the selected model to canonical NESTO units. Unit links save on their own and reach the published viewer only through a release.</p><p className="text-xs text-neutral-500">{initial.units.length} active units in this project.</p></Panel>;

  const materialNodes = sceneManifest.filter((node) => node.isMesh && node.autoClassification !== "unit_block");
  const linkedUnitIds = new Set(models.flatMap((entry) => entry.model.unitLinks?.map((link) => link.unitId) ?? []));
  const configProps = { draft, change: changeConfig };
  const extended = tool === "unitStyle" ? <>
    <SlotAnchorPanel projectId={projectId} slots={initial.slots} canEdit={permissions.manageModels} />
    <UnitStylePanels {...configProps} statusPreview={statusPreview} onStatusPreview={setStatusPreview} />
    <UnitListPanel units={units.map((unit) => ({ ...unit, linked: linkedUnitIds.has(unit.id) }))} selectedUnitId={selectedUnitId} onSelect={selectUnit} onTestCamera={(unitId) => { selectUnit(unitId); viewerRef.current?.focusUnit(unitId); }} />
  </> : tool === "interaction" ? <InteractionPanels {...configProps} />
    : tool === "map" ? <MapPanels {...configProps} siteStatus={siteStatus} />
    : tool === "presets" ? <PresetsPanel {...configProps} canEdit={permissions.configure} />
    : tool === "publish" ? <PublishPanel slots={initial.slots} units={initial.units} draft={draft} managementHref={managementHref} />
    : tool === "materials" ? <>
      {materialNodes.length > 0 ? <MaterialNodeList nodes={materialNodes} selectedNodeId={selectedNodeId} overriddenIds={new Set(model?.nodeOverrides.map((item) => item.nodeId) ?? [])} onSelect={setSelectedNodeId} /> : null}
      {selectedNodeId ? <MaterialExtraPanels override={selectedOverride} change={changeOverride} onRestore={restoreOriginal} disabled={modelLocked} /> : null}
    </>
    : tool === "environment" ? <EnvironmentExtraPanels {...configProps} projectId={projectId} />
    : tool === "lighting" ? <LightingExtraPanels {...configProps} projectId={projectId} />
    : tool === "rendering" ? <RenderingExtraPanels {...configProps} />
    : tool === "camera" ? <CameraExtraPanels {...configProps} />
    : tool === "performance" ? <PerformanceExtraPanels {...configProps} />
    : tool === "units" ? <Panel title="Unit blocks preview"><Toggle label="Show unit blocks in the viewport" value={statusPreview} onChange={setStatusPreview} /></Panel>
    : null;

  const toolLabel = TOOLS.find((item) => item.id === tool)?.label ?? "";
  const bindingVersion = model && ["READY", "PUBLISHED"].includes(model.status) ? model : null;

  return (
    <div className="flex h-full w-full flex-col">
      <EditorTopbar
        experienceName={initial.config.experienceName}
        context={`${initial.project.company.parentGroup.name} · ${initial.project.company.name} · ${initial.project.code}`}
        activeRelease={initial.config.activeRelease}
        status={status}
        canEdit={permissions.configure}
        onSave={() => void save()}
        onReset={() => setConfirmReset(true)}
        managementHref={managementHref}
      />

      <nav aria-label="Editor tools" className="flex h-10 shrink-0 overflow-x-auto border-b border-neutral-800 bg-neutral-950 px-2">
        {TOOLS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)} className={cn("flex min-w-fit items-center gap-1.5 border-b-2 px-3 text-xs", tool === id ? "border-indigo-400 text-white" : "border-transparent text-neutral-500 hover:text-neutral-200")}><Icon className="size-3.5" aria-hidden="true" />{label}</button>)}
      </nav>

      {notice?.kind === "conflict" ? (
        <Banner tone="warning" title={`This Experience was updated in another session${notice.revision ? ` (draft revision ${notice.revision})` : ""}.`} actions={<><Button type="button" size="sm" onClick={reloadLatest}><RefreshCw aria-hidden="true" />Reload latest</Button><Button type="button" size="sm" variant="ghost" className="text-neutral-300" onClick={() => setNotice(null)}>Keep editing</Button></>}>
          {dirty ? "Saving this tab's changes would overwrite it, so the save is refused. Reload the latest draft to continue; the unsaved changes in this tab are discarded." : "Reload the latest draft to continue from it."}
        </Banner>
      ) : notice?.kind === "session" ? (
        <Banner tone="danger" title="Your session has ended." actions={<Button asChild size="sm"><a href={`/login?callbackUrl=${encodeURIComponent(managementHref)}`} target="_blank" rel="noopener noreferrer">Sign in again<ExternalLink aria-hidden="true" /></a></Button>}>
          Nothing more can be saved until you sign in. Your changes are still in this tab: sign in again in a new tab, then come back and Save.
        </Banner>
      ) : notice?.kind === "access" ? (
        <Banner tone="danger" title="Your access to this Experience has changed." actions={<Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>Reload editor</Button>}>
          Reload, or contact a Platform Administrator.
        </Banner>
      ) : null}
      {error ? <Banner tone="danger" title={error} actions={<Button type="button" size="icon-sm" variant="ghost" className="text-neutral-400" aria-label="Dismiss" onClick={() => setError(null)}><X aria-hidden="true" /></Button>} /> : null}
      {smallScreen && !smallScreenDismissed ? <Banner tone="neutral" title="This editor works best on a larger screen." actions={<Button type="button" size="icon-sm" variant="ghost" className="text-neutral-400" aria-label="Dismiss" onClick={() => setSmallScreenDismissed(true)}><X aria-hidden="true" /></Button>}>Use a window of at least {MIN_WIDTH} × {MIN_HEIGHT} for authoring.</Banner> : null}

      <div className="flex min-h-0 flex-1">
        {layout.leftCollapsed ? (
          <Rail side="left" label="Show scene panel" onExpand={() => updateLayout({ leftCollapsed: false })} />
        ) : <>
          <aside aria-label="Scene" style={{ width: layout.leftWidth }} className="flex shrink-0 flex-col bg-neutral-950">
            <PanelHeader title="Scene" action={<Button type="button" size="icon-sm" variant="ghost" disabled={uploading} className="text-neutral-500 hover:text-white" aria-label="Hide scene panel" onClick={() => updateLayout({ leftCollapsed: true })}><PanelLeftClose aria-hidden="true" /></Button>} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-neutral-800 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Models</p>
                {initial.slots.length === 0 ? <p className="mt-2 text-xs text-neutral-500">No models yet.</p> : null}
                {initial.slots.map((slot) => <div key={slot.id} className="mt-3">
                  <div className="flex items-center justify-between gap-1">
                    <SlotName projectId={projectId} slot={slot} canEdit={permissions.manageModels && !uploading} />
                    {permissions.manageModels ? <Button type="button" size="icon-sm" variant="ghost" className="shrink-0 text-neutral-500 hover:text-red-300" aria-label={`Remove ${slot.displayName}`} title="Remove model" disabled={uploading} onClick={() => setRemovingSlot(slot)}><Trash2 aria-hidden="true" /></Button> : null}
                  </div>
                  {slot.versions.length === 0 ? <p className="text-[11px] text-neutral-600">No version uploaded yet.</p> : null}
                  {slot.versions.map((version) => <button key={version.id} type="button" aria-pressed={activeVersionId === version.id} onClick={() => chooseVersion(version.id)} className={cn("mt-1 flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs", activeVersionId === version.id ? "bg-indigo-500/20 text-indigo-200" : "text-neutral-400 hover:bg-neutral-900")}><span className="min-w-0 truncate">v{version.version} · {version.originalFileName}{modelEdits[version.id] ? " •" : ""}</span><VersionStateMark version={version} /></button>)}
                </div>)}
              </div>
              {permissions.manageModels ? <ModelIngestionPanel compact projectId={projectId} slots={initial.slots} uploadLimitBytes={initial.uploadLimitBytes} onBusyChange={setUploading} onQueued={setAutoSelectId} /> : null}
              <div className="p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Scene nodes</p>
                {sceneManifest.length === 0 ? <p className="text-xs text-neutral-500">The selected model has no scene nodes.</p> : <div className="mb-2 flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5"><Search className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden="true" /><input value={sceneSearch} onChange={(event) => setSceneSearch(event.target.value)} placeholder="Search scene..." aria-label="Search scene" className="w-full bg-transparent text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none" /></div>}
                {sceneManifest.filter((node) => !sceneSearch.trim() || node.name.toLowerCase().includes(sceneSearch.trim().toLowerCase())).map((node) => <button key={node.nodeId} type="button" onClick={() => { setSelectedNodeId(node.nodeId); setTool("materials"); }} className={cn("block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-neutral-900", selectedNodeId === node.nodeId ? "text-indigo-200" : "text-neutral-400")} style={{ paddingLeft: `${8 + node.depth * 10}px` }}>{node.name}</button>)}
              </div>
            </div>
          </aside>
          <ResizeHandle label="Resize scene panel" edge="right" width={layout.leftWidth} min={PANEL_LIMITS.left.min} max={PANEL_LIMITS.left.max} onResize={(leftWidth) => updateLayout({ leftWidth })} />
        </>}

        <main ref={viewportRef} aria-label="3D viewport" className="relative min-w-0 flex-1 overflow-hidden bg-neutral-900">
          <ThreeProjectViewer ref={viewerRef} detailModels={models} cameraConfig={viewerDraft} qualityConfig={viewerDraft} environmentConfig={viewerDraft} lightingConfig={viewerDraft} renderingConfig={viewerDraft} unitsConfig={viewerDraft} siteConfig={siteConfig} className="absolute inset-0 h-full w-full" showPerfStats onPerfStats={(stats) => { setPerf(stats); setRenderScale(viewerRef.current?.getEffectiveRenderScale() ?? null); }} onModelLoadStatus={setModelStatus} onSiteStatus={setSiteStatus} onReady={applyUnitsMode} onUnitClick={unitBlocksShown ? selectUnit : undefined} />
          <div className="absolute left-3 top-3 flex gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => viewerRef.current?.resetView()}>Reset view</Button><Button type="button" variant="secondary" size="icon-sm" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title="Fullscreen" onClick={toggleFullscreen}>{fullscreen ? <Minimize aria-hidden="true" /> : <Expand aria-hidden="true" />}</Button></div>
          {models.length === 0 ? <EmptyViewport versions={versions} canUpload={permissions.manageModels} /> : null}
          {loadingShown && modelStatus.state === "loading" ? (
            <div role="status" className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <span className="flex items-center gap-2 rounded-full bg-neutral-950/85 px-3 py-1.5 text-xs text-neutral-300 shadow"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />Loading models…</span>
            </div>
          ) : null}
          {modelStatus.state === "failed" ? (
            <div role="alert" className="absolute inset-x-4 bottom-4 max-w-md rounded-lg border border-red-400/30 bg-neutral-950/95 p-4 shadow-xl">
              <p className="text-sm font-medium text-red-200">{modelStatus.models.length === 1 ? "A model failed to load." : "Some models failed to load."}</p>
              <p className="mt-1 text-xs text-neutral-400">{modelStatus.forbidden ? "Its signed address may have expired." : `Affected: ${modelStatus.models.join(", ")}`} The rest of the editor keeps working.</p>
              <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={retryModels}><RefreshCw aria-hidden="true" />Retry</Button>
            </div>
          ) : null}
          {bindingsOpened && bindingVersion ? (
            <div hidden={tool !== "units"} className="absolute inset-0 z-10 overflow-y-auto bg-neutral-950/95 p-4">
              <PanelBoundary label="Unit binding">
                <UnitBindingEditor key={bindingVersion.id} projectId={projectId} versionId={bindingVersion.id} onDirtyChange={setBindingsDirty} />
              </PanelBoundary>
            </div>
          ) : null}
          {tool === "units" && !bindingVersion ? <ViewportMessage>Choose a processed model to link its scene nodes to units.</ViewportMessage> : null}
        </main>

        {layout.rightCollapsed ? (
          <Rail side="right" label="Show properties panel" onExpand={() => updateLayout({ rightCollapsed: false })} />
        ) : <>
          <ResizeHandle label="Resize properties panel" edge="left" width={layout.rightWidth} min={PANEL_LIMITS.right.min} max={PANEL_LIMITS.right.max} onResize={(rightWidth) => updateLayout({ rightWidth })} />
          <aside aria-label="Properties" style={{ width: layout.rightWidth }} className="flex shrink-0 flex-col bg-neutral-950">
            <PanelHeader title={`Properties · ${toolLabel}`} action={<Button type="button" size="icon-sm" variant="ghost" className="text-neutral-500 hover:text-white" aria-label="Hide properties panel" onClick={() => updateLayout({ rightCollapsed: true })}><PanelRightClose aria-hidden="true" /></Button>} />
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <PanelBoundary key={tool} label={`${toolLabel} properties`}>{EXTENDED_TOOLS.includes(tool) ? null : inspector}{extended}</PanelBoundary>
            </div>
          </aside>
        </>}
      </div>
      <StatusBar stats={perf} qualityPreset={draft.qualityPreset} effectiveRenderScale={renderScale} warnings={modelStatus.state === "failed" ? modelStatus.models.length : 0} />


      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset editor settings to defaults?"
        description="Your current unsaved editor settings will be replaced. Environment, lighting, rendering, camera, shots and sections go back to their defaults in this tab; nothing is saved until you choose Save, and nothing is published."
        confirmLabel="Reset"
        onConfirm={() => {
          setDraft(structuredClone(DEFAULT_PROJECT_3D_CONFIG));
          setConfigDirty(true);
          resetPendingRef.current = true;
          setConfirmReset(false);
        }}
      />
      <RemoveModelDialog projectId={projectId} slot={removingSlot} onOpenChange={(open) => { if (!open) setRemovingSlot(null); }} onRemoved={modelRemoved} />
      <ConfirmDialog
        open={pendingVersionId !== null}
        onOpenChange={(open) => { if (!open) setPendingVersionId(null); }}
        title="Discard unsaved unit links?"
        description="The unit links changed for this model have not been saved. Switching models discards them."
        confirmLabel="Discard"
        onConfirm={() => {
          setBindingsDirty(false);
          setActiveVersionId(pendingVersionId);
          setSelectedNodeId(null);
          setPendingVersionId(null);
        }}
      />
    </div>
  );
}

function PanelHeader({ title, action }: { title: string; action: React.ReactNode }) {
  return <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-neutral-800 pl-3 pr-1"><h2 className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">{title}</h2>{action}</div>;
}

function Rail({ side, label, onExpand }: { side: "left" | "right"; label: string; onExpand: () => void }) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return <div className={cn("flex w-9 shrink-0 flex-col items-center bg-neutral-950 py-1", side === "left" ? "border-r border-neutral-800" : "border-l border-neutral-800")}><Button type="button" size="icon-sm" variant="ghost" className="text-neutral-500 hover:text-white" aria-label={label} onClick={onExpand}><Icon aria-hidden="true" /></Button></div>;
}

/** What the viewport says while it has no model to show, from the models' own state. */
function EmptyViewport({ versions, canUpload }: { versions: EditorVersion[]; canUpload: boolean }) {
  const preparing = versions.find((version) => version.status === "PROCESSING" && !version.stalled);
  const stalled = versions.find((version) => version.stalled);
  const failed = versions.find((version) => version.status === "FAILED");
  if (preparing) return <ViewportMessage busy>Preparing {preparing.originalFileName}. It appears here when it is ready; you can keep editing.</ViewportMessage>;
  if (stalled) return <ViewportMessage>Preparing {stalled.originalFileName} stalled. Select it in the Scene panel to retry.</ViewportMessage>;
  if (failed) return <ViewportMessage>{failed.originalFileName} could not be prepared. Select it in the Scene panel to see why{canUpload ? ", then upload a corrected GLB" : ""}.</ViewportMessage>;
  return <ViewportMessage>{canUpload ? "No model yet. Upload a GLB from the Scene panel; the settings on the right still save." : "No model yet. Ask a Platform Administrator to upload one."}</ViewportMessage>;
}

/** Ready, preparing, stalled, failed or unfinished, as a mark with its name for assistive technology. */
function VersionStateMark({ version }: { version: EditorVersion }) {
  const label = versionStateLabel(version);
  if (version.status === "PROCESSING" && !version.stalled) return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-indigo-300" aria-label={label} role="img" />;
  const tone = version.assetMissing || version.status === "FAILED" ? "text-red-400" : isReady(version) ? (version.validationStatus === "WARNING" ? "text-amber-300" : "text-emerald-400") : version.stalled ? "text-amber-300" : "text-neutral-600";
  return <span className={cn("shrink-0", tone)} role="img" aria-label={label} title={label}>●</span>;
}

function ViewportMessage({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return <div className="absolute inset-0 flex items-center justify-center p-6"><p className="flex max-w-sm items-center gap-2 rounded-lg bg-neutral-950/85 px-4 py-3 text-center text-xs leading-5 text-neutral-400">{busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : null}<span>{children}</span></p></div>;
}

const BANNER_TONE = {
  warning: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  danger: "border-red-400/30 bg-red-500/10 text-red-100",
  neutral: "border-neutral-700 bg-neutral-900 text-neutral-200",
} as const;

function Banner({ tone, title, children, actions }: { tone: keyof typeof BANNER_TONE; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div role={tone === "neutral" ? "status" : "alert"} className={cn("flex shrink-0 items-center gap-3 border-b px-3 py-2", BANNER_TONE[tone])}>
      <div className="min-w-0 flex-1 text-xs leading-5"><p className="font-medium">{title}</p>{children ? <p className="opacity-80">{children}</p> : null}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
