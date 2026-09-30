"use client";

import * as React from "react";
import { Camera, ChevronDown, ChevronUp, Copy, Play, Star, Trash2 } from "lucide-react";

import type { ThreeProjectViewerHandle } from "@/components/3d/company/viewerTypes";
import type { CameraPreset, Project3DConfig } from "@/lib/3d/runtime/types";
import { cn } from "@/lib/utils/cn";
import { GroupCard, SectionHeading, SliderRow } from "./rozaris-fields";

/*
 * The Shots tool, ported as it is in the Rozaris Web3D Experience Editor
 * (panels/ShotsPanel.tsx + the shot actions of useProjectConfigEditor): capture,
 * the Opening Shot star, rename, preview, duplicate, reorder, delete and each
 * shot's transition time. The first shot is the one the viewer opens on.
 */

type Props = {
  draft: Project3DConfig;
  change: (patch: Partial<Project3DConfig>) => void;
  viewerRef: React.RefObject<ThreeProjectViewerHandle | null>;
  canEdit: boolean;
};

export function ShotsPanel({ draft, change, viewerRef, canEdit }: Props) {
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [previewingId, setPreviewingId] = React.useState<string | null>(null);
  const shots = draft.cameraPresets;
  const set = (cameraPresets: CameraPreset[]) => change({ cameraPresets });

  function capture() {
    const state = viewerRef.current?.getCameraState();
    if (!state) return;
    set([...shots, { id: `shot-${Date.now()}`, label: `Shot ${shots.length + 1}`, position: state.position, target: state.target, fov: state.fov, durationMs: 1500 }]);
  }

  function preview(shot: CameraPreset) {
    viewerRef.current?.flyToPreset(shot);
    setPreviewingId(shot.id);
    viewerRef.current?.showCameraHelperFor(draft.cameraHelperEnabled ? shot : null);
    window.setTimeout(() => setPreviewingId(null), shot.durationMs);
  }

  function rename(id: string, label: string) {
    set(shots.map((p) => (p.id === id ? { ...p, label } : p)));
  }

  function duplicate(id: string) {
    const index = shots.findIndex((p) => p.id === id);
    if (index === -1) return;
    const next = [...shots];
    next.splice(index + 1, 0, { ...shots[index], id: `shot-${Date.now()}`, label: `${shots[index].label} copy` });
    set(next);
  }

  function reorder(id: string, direction: "up" | "down") {
    const index = shots.findIndex((p) => p.id === id);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= shots.length) return;
    const next = [...shots];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    set(next);
  }

  function makeOpening(id: string) {
    const index = shots.findIndex((p) => p.id === id);
    if (index <= 0) return;
    const next = [...shots];
    const [shot] = next.splice(index, 1);
    next.unshift(shot);
    set(next);
  }

  return (
    <div className="space-y-3">
      <SectionHeading>Shots</SectionHeading>
      <button
        type="button"
        onClick={capture}
        disabled={!canEdit}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Camera className="h-3.5 w-3.5" /> Capture Shot
      </button>

      {shots.length === 0 && <p className="p-3 text-center text-xs text-neutral-600">No shots saved yet — orbit the viewport and Capture one.</p>}

      <div className="space-y-1.5">
        {shots.map((shot, i) => (
          <GroupCard key={shot.id}>
            <div className="flex items-center gap-1.5">
              {i === 0 ? (
                <span title="Opening Shot" className="shrink-0">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                </span>
              ) : (
                <button type="button" onClick={() => makeOpening(shot.id)} disabled={!canEdit} title="Set as Opening Shot" aria-label={`Set ${shot.label} as Opening Shot`} className="shrink-0 text-neutral-600 hover:text-amber-400 disabled:opacity-40">
                  <Star className="h-3.5 w-3.5" />
                </button>
              )}
              {renamingId === shot.id ? (
                <input
                  autoFocus
                  aria-label="Shot name"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim()) rename(shot.id, renameValue.trim());
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="w-full min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-100"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(shot.id);
                    setRenameValue(shot.label);
                  }}
                  disabled={!canEdit}
                  className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-neutral-200"
                >
                  {shot.label}
                </button>
              )}
              <button type="button" onClick={() => preview(shot)} title="Preview" aria-label={`Preview ${shot.label}`} className={cn("shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white", previewingId === shot.id && "text-indigo-400")}>
                <Play className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => duplicate(shot.id)} disabled={!canEdit} title="Duplicate" aria-label={`Duplicate ${shot.label}`} className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-40">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => reorder(shot.id, "up")} disabled={!canEdit || i === 0} title="Move up" aria-label={`Move ${shot.label} up`} className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-20">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => reorder(shot.id, "down")} disabled={!canEdit || i === shots.length - 1} title="Move down" aria-label={`Move ${shot.label} down`} className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-20">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => set(shots.filter((p) => p.id !== shot.id))} disabled={!canEdit} title="Delete" aria-label={`Delete ${shot.label}`} className="shrink-0 rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2">
              <SliderRow label="Transition" value={shot.durationMs} min={0} max={8000} step={100} suffix="ms" disabled={!canEdit} onChange={(v) => set(shots.map((s) => (s.id === shot.id ? { ...s, durationMs: v } : s)))} />
            </div>
          </GroupCard>
        ))}
      </div>
    </div>
  );
}
