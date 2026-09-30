"use client";

import * as React from "react";
import { Play, RotateCcw, Square } from "lucide-react";

import type { ThreeProjectViewerHandle } from "@/components/3d/company/viewerTypes";
import type { Project3DConfig } from "@/lib/3d/runtime/types";
import { cn } from "@/lib/utils/cn";
import { GroupCard, SectionHeading, ToggleRow } from "./rozaris-fields";

/* The Rozaris Web3D Camera panel's "Editor Tools" (panels/CameraPanel.tsx). */

const IDLE_DRONE_DEFAULTS = {
  idleDroneEnabled: true,
  idleDroneDelaySec: 60,
  idleDroneOrbitDurationSec: 80,
  idleDroneClockwise: true,
  idleDroneMotionEnabled: true,
  idleDroneHeightEnabled: true,
  idleDroneHeightAmplitude: 0.18,
  idleDroneDistanceEnabled: true,
  idleDroneDistanceAmplitude: 0.05,
  idleDroneTargetEnabled: true,
  idleDroneTargetAmplitude: 0.06,
  idleDroneVerticalCycles: 2,
  idleDronePhaseOffsetDeg: 0,
  idleDroneSmoothness: 0.88,
} satisfies Partial<Project3DConfig>;

export function CameraEditorTools({ change, viewerRef, canEdit }: { change: (patch: Partial<Project3DConfig>) => void; viewerRef: React.RefObject<ThreeProjectViewerHandle | null>; canEdit: boolean }) {
  const [previewing, setPreviewing] = React.useState(false);
  const [showPath, setShowPath] = React.useState(false);

  // Leaving the Camera tool stops a running preview and hides the path.
  React.useEffect(() => () => {
    viewerRef.current?.stopIdleDronePreview();
    viewerRef.current?.setShowDronePath(false);
  }, [viewerRef]);

  function togglePreview() {
    if (previewing) viewerRef.current?.stopIdleDronePreview();
    else viewerRef.current?.previewIdleDrone();
    setPreviewing((v) => !v);
  }

  function toggleShowPath(v: boolean) {
    setShowPath(v);
    viewerRef.current?.setShowDronePath(v);
  }

  return (
    <div className="space-y-3">
      <SectionHeading>Editor Tools</SectionHeading>
      <GroupCard>
        <button
          type="button"
          onClick={togglePreview}
          className={cn("flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-neutral-800", previewing ? "text-indigo-400" : "text-neutral-300")}
        >
          {previewing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {previewing ? "Stop Preview" : "Preview Drone"}
        </button>
        <ToggleRow label="Show Drone Path" checked={showPath} onChange={toggleShowPath} />
        <button
          type="button"
          onClick={() => change(IDLE_DRONE_DEFAULTS)}
          disabled={!canEdit}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset Drone Settings
        </button>
      </GroupCard>
    </div>
  );
}
