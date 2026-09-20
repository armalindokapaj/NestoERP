"use client";

import Link from "next/link";
import * as React from "react";
import { Box, Expand, Home, RefreshCw, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { project3DBootstrapSchema, type Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import type { Project3DConfig, ProjectDetailModel } from "@/lib/3d/runtime/types";
import type { ModelLoadStatus } from "@/lib/3d/runtime/render-engine/RenderEngine";
import { cn } from "@/lib/utils/cn";
import { ThreeProjectViewer } from "./ThreeProjectViewer";
import type { ThreeProjectViewerHandle } from "./viewerTypes";

type ApiEnvelope = { data?: unknown; error?: { message?: string } };

function modelForRuntime(model: Project3DBootstrap["models"][number], publishedAt: string): ProjectDetailModel {
  return {
    glbUrl: model.asset.url,
    fileName: model.asset.fileName,
    fileSize: 0,
    ...model.transform,
    enabled: true,
    visible: model.visible,
    castShadow: model.castShadow,
    receiveShadow: model.receiveShadow,
    selectable: model.selectable,
    transformLocked: true,
    updatedAt: publishedAt,
    unitLinks: model.unitBindings,
    sceneManifest: model.sceneManifest.map((node) => ({
      rzNodeId: node.nodeId,
      name: node.name,
      meshIndex: node.meshIndex,
      parentRzNodeId: node.parentNodeId,
      depth: node.depth,
      isMesh: node.isMesh,
      autoClassification: node.autoClassification,
    })),
    nodeOverrides: model.nodeOverrides.map(({ nodeId, ...override }) => ({ ...override, rzNodeId: nodeId })),
    triangleCount: null,
    meshCount: null,
    materialCount: null,
    textureCount: null,
  };
}
function unitStatusLabel(status: Project3DBootstrap["units"][number]["status"]): string {
  if (status === "sold") return "Sold";
  if (status === "reserved") return "Reserved";
  return "Available";
}

function ViewerLoading({ message }: { message: string }) {
  return (
    <div className="grid min-h-[560px] place-items-center rounded-xl border border-line bg-surface-muted">
      <div className="text-center">
        <Box className="mx-auto size-10 animate-pulse text-fg-subtle" aria-hidden="true" />
        <p className="mt-3 text-body text-fg-muted">{message}</p>
      </div>
    </div>
  );
}

export function Project3DViewer({ projectId }: { projectId: string }) {
  const [bootstrap, setBootstrap] = React.useState<Project3DBootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [modelStatus, setModelStatus] = React.useState<ModelLoadStatus>({ state: "loading" });
  const [selectedUnitId, setSelectedUnitId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const viewerRef = React.useRef<ThreeProjectViewerHandle>(null);
  const shellRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setBootstrapError(null);
    setModelStatus({ state: "loading" });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/3d/bootstrap`, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      const json = await response.json() as ApiEnvelope;
      if (!response.ok) throw new Error(json.error?.message ?? "Could not open the 3D viewer.");
      const parsed = project3DBootstrapSchema.safeParse(json.data);
      if (!parsed.success) throw new Error("The published 3D release could not be read.");
      setBootstrap(parsed.data);
      setSelectedUnitId(null);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setBootstrap(null);
      setBootstrapError(failure instanceof Error ? failure.message : "Could not open the 3D viewer.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selectedUnit = bootstrap?.units.find((unit) => unit.id === selectedUnitId) ?? null;
  const filteredUnits = React.useMemo(() => {
    if (!bootstrap) return [];
    const term = search.trim().toLocaleLowerCase();
    return term ? bootstrap.units.filter((unit) => unit.code.toLocaleLowerCase().includes(term)) : bootstrap.units;
  }, [bootstrap, search]);

  if (loading && !bootstrap) return <ViewerLoading message="Opening the published 3D experience…" />;
  if (bootstrapError || !bootstrap) {
    return (
      <div className="grid min-h-[460px] place-items-center rounded-xl border border-line bg-surface-muted p-6">
        <div className="max-w-md text-center">
          <p className="text-body font-medium text-fg">{bootstrapError ?? "No published 3D experience is available."}</p>
          <Button className="mt-4" variant="secondary" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" /> Try again
          </Button>
        </div>
      </div>
    );
  }

  const authored = bootstrap.experience as unknown as Project3DConfig;
  const config: Project3DConfig = bootstrap.capabilities.mapbox ? authored : {
    ...authored,
    mapViewEnabled: false,
    siteEnabled: false,
  };
  const detailModels = bootstrap.models.map((entry) => ({
    slotId: entry.slotId,
    slotName: entry.slotName,
    slotRole: entry.slotRole.toLocaleLowerCase() as "building" | "units" | "surroundings" | "context" | "custom",
    transformParentSlotId: entry.transformParentSlotId,
    model: modelForRuntime(entry, bootstrap.release.publishedAt),
    units: bootstrap.units,
    statusPreviewEnabled: true,
  }));

  function selectUnit(unitId: string | null) {
    setSelectedUnitId(unitId);
    viewerRef.current?.setSelectedUnit(unitId);
  }

  async function enterFullscreen() {
    await shellRef.current?.requestFullscreen?.();
  }

  return (
    <div ref={shellRef} className="overflow-hidden rounded-xl border border-line bg-neutral-950 text-white shadow-sm" data-testid="project-3d-viewer">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-3">
        <div className="mr-auto min-w-0">
          <p className="truncate text-sm font-semibold">Published experience · Release {bootstrap.release.number}</p>
          <p className="text-[11px] text-neutral-500">
            {bootstrap.models.length} {bootstrap.models.length === 1 ? "model" : "models"} · Published {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(bootstrap.release.publishedAt))}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="text-neutral-300 hover:text-white" onClick={() => viewerRef.current?.resetView()}>
          <Home aria-hidden="true" /> Reset view
        </Button>
        <Button size="sm" variant="ghost" className="text-neutral-300 hover:text-white" onClick={() => void enterFullscreen()}>
          <Expand aria-hidden="true" /> Full screen
        </Button>
        <Button size="sm" variant="ghost" className="text-neutral-300 hover:text-white" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn(loading && "animate-spin")} aria-hidden="true" /> Refresh access
        </Button>
      </div>

      <div className="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="relative min-h-[520px] bg-neutral-900">
          <ThreeProjectViewer
            key={`${bootstrap.release.id}:${bootstrap.models.map((model) => model.asset.expiresAt).join(":")}`}
            ref={viewerRef}
            detailModels={detailModels}
            cameraConfig={config}
            qualityConfig={config}
            environmentConfig={config}
            lightingConfig={config}
            renderingConfig={config}
            unitsConfig={config}
            siteConfig={{ ...config, latitude: config.mapViewLatitude, longitude: config.mapViewLongitude }}
            onModelLoadStatus={setModelStatus}
            onUnitClick={selectUnit}
            className="absolute inset-0 h-full w-full"
          />
          {modelStatus.state === "loading" ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
              <span className="rounded-full bg-neutral-950/85 px-3 py-1.5 text-xs text-neutral-300 shadow">Loading published models…</span>
            </div>
          ) : null}
          {modelStatus.state === "failed" ? (
            <div className="absolute inset-x-4 bottom-4 rounded-lg border border-red-400/30 bg-neutral-950/95 p-4 shadow-xl">
              <p className="text-sm font-medium text-red-200">One or more published models could not be loaded.</p>
              <p className="mt-1 text-xs text-neutral-400">
                {modelStatus.forbidden ? "The signed model access may have expired." : `Affected: ${modelStatus.models.join(", ")}`}
              </p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => void load()}>
                <RefreshCw aria-hidden="true" /> Refresh signed access
              </Button>
            </div>
          ) : null}
          {selectedUnit ? (
            <div className="absolute bottom-4 left-4 right-4 max-w-sm rounded-lg border border-white/10 bg-neutral-950/95 p-4 shadow-xl">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Selected unit</p>
                  <p className="mt-1 truncate text-lg font-semibold">{selectedUnit.code}</p>
                  <p className="mt-1 text-xs text-neutral-400">{unitStatusLabel(selectedUnit.status)}</p>
                </div>
                <button type="button" aria-label="Clear selected unit" className="rounded p-1 text-neutral-500 hover:bg-white/10 hover:text-white" onClick={() => selectUnit(null)}>
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              {bootstrap.capabilities.unitDetails ? (
                <Button asChild size="sm" className="mt-3 w-full">
                  <Link href={`/projects/${bootstrap.project.id}/units/${selectedUnit.id}`}>Open canonical unit</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="border-t border-neutral-800 bg-neutral-950 p-3 lg:border-l lg:border-t-0" aria-label="Mapped units">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-neutral-600" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a unit"
              aria-label="Find a mapped unit"
              className="border-neutral-800 bg-neutral-900 pl-8 text-neutral-100 placeholder:text-neutral-600"
            />
          </div>
          <div className="mt-3 max-h-[550px] space-y-1 overflow-y-auto">
            {filteredUnits.map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => {
                  selectUnit(unit.id);
                  viewerRef.current?.revealUnit(unit.id, -0.1);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                  selectedUnitId === unit.id ? "bg-indigo-500/20 text-indigo-100" : "text-neutral-300 hover:bg-white/5 hover:text-white",
                )}
              >
                <span className={cn("size-2 shrink-0 rounded-full", unit.status === "sold" ? "bg-red-500" : unit.status === "reserved" ? "bg-amber-400" : "bg-emerald-500")} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium">{unit.code}</span>
                <span className="text-[10px] text-neutral-600">{unitStatusLabel(unit.status)}</span>
              </button>
            ))}
            {filteredUnits.length === 0 ? <p className="px-2 py-6 text-center text-xs text-neutral-600">No mapped units found.</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
