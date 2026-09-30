"use client";

/*
 * The Rozaris Web3D editor's status bar (experience-editor/StatusBar.tsx): the
 * renderer's live figures under the viewport on every tool, with the quality
 * profile and the effective render scale.
 */

type PerfStats = { fps: number; frameTimeMs: number; drawCalls: number; triangles: number; textures: number; dpr: number };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-neutral-600">{label}</span>
      <span className="font-mono text-neutral-300">{value}</span>
    </span>
  );
}

export function StatusBar({ stats, qualityPreset, effectiveRenderScale, warnings = 0 }: { stats: PerfStats | null; qualityPreset?: string; effectiveRenderScale?: number | null; warnings?: number }) {
  return (
    <div role="status" aria-label="Renderer status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-neutral-800 bg-neutral-950 px-4 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Stat label="FPS" value={stats ? String(Math.round(stats.fps)) : "—"} />
        <Stat label="Frame" value={stats ? `${Math.round(stats.frameTimeMs * 10) / 10}ms` : "—"} />
        <Stat label="Draw calls" value={stats ? String(stats.drawCalls) : "—"} />
        <Stat label="Tris" value={stats ? stats.triangles.toLocaleString() : "—"} />
        <span className="hidden xl:contents">
          <Stat label="Textures" value={stats ? String(stats.textures) : "—"} />
          <Stat label="DPR" value={stats ? stats.dpr.toFixed(2) : "—"} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-neutral-600">
          Quality Profile{" "}
          <span className="text-neutral-400">
            {qualityPreset ?? "—"}
            {effectiveRenderScale != null && ` · ${Math.round(effectiveRenderScale * 100)}% scale`}
          </span>
        </span>
        <span className="text-neutral-600">
          Warnings <span className="text-neutral-400">{warnings}</span>
        </span>
      </div>
    </div>
  );
}
