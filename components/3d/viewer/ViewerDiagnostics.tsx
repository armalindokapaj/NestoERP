"use client";

import { useState, useSyncExternalStore } from "react";
import type { RendererFacts } from "@/lib/3d/runtime/render-engine/RenderEngine";
import { BISECTABLE_EFFECTS, formatEffectOverrides, parseEffectOverrides, type EffectName } from "@/lib/3d/viewer/viewerEffectOverrides";

export function ViewerDiagnostics({
  facts,
  stats,
  site,
}: {
  facts: RendererFacts | null;
  site: string;
  stats: {
    fps: number;
    frameTimeMs: number;
    drawCalls: number;
    triangles: number;
    textures: number;
    dpr: number;
    outlineClip: string;
  } | null;
}) {
  // Rozaris compares this page's build with the server's here; NESTO exposes no
  // build identifier, so the build rows are left out.
  const [resetting, setResetting] = useState(false);

  const swControlled = useSyncExternalStore(
    () => () => {},
    () => !!navigator.serviceWorker?.controller,
    () => false
  );

  async function hardReset() {
    setResetting(true);
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(regs.filter((r) => r.active?.scriptURL.endsWith("/sw-3d-cache.js")).map((r) => r.unregister()));
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("nesto-3d-")).map((n) => caches.delete(n)));
    } catch {
    }
    window.location.replace(window.location.pathname + "?diag=1&fresh=" + Date.now());
  }

  const disabled = useSyncExternalStore(
    () => () => {},
    () => window.location.search,
    () => ""
  );
  const disabledSet = parseEffectOverrides(disabled);
  const allOff = BISECTABLE_EFFECTS.every((name) => disabledSet.has(name));

  function hrefFor(next: Set<EffectName>): string {
    const params = new URLSearchParams(disabled);
    params.set("diag", "1");
    const value = formatEffectOverrides(next);
    if (value) params.set("fx", value);
    else params.delete("fx");
    return `${window.location.pathname}?${params.toString()}`;
  }

  function bisectLink(name: EffectName) {
    const isOff = disabledSet.has(name);
    const next = new Set(disabledSet);
    if (isOff) next.delete(name);
    else next.add(name);
    return (
      <a
        key={name}
        href={hrefFor(next)}
        className={`pointer-events-auto rounded border px-1.5 py-0.5 ${
          isOff ? "border-warning/60 bg-warning/15 text-warning-strong" : "border-fg/20 text-fg/80"
        }`}
      >
        {name}
      </a>
    );
  }


  return (
    <div className="pointer-events-none fixed left-2 top-2 z-[100] max-w-[calc(100vw-1rem)] rounded-lg border border-fg/15 bg-black/85 p-3 font-mono text-[11px] leading-relaxed text-fg/85 backdrop-blur">
      <div className="mb-1.5 font-sans text-xs font-semibold text-fg">Viewer diagnostics</div>
      <Row label="backend" value={facts ? facts.backend : "…starting"} bad={facts?.backend === "webgl2"} />
      <Row label="navigator.gpu" value={facts ? (facts.webgpuAvailable ? "present" : "absent") : "…"} bad={facts?.webgpuAvailable === false} />
      <Row label="gpu" value={facts?.glRenderer ?? (facts?.backend === "webgpu" ? "(not exposed)" : "…")} />
      <Row label="max texture" value={facts?.maxTextureSize ? `${facts.maxTextureSize}px` : "—"} />
      <Row
        label="buffer"
        value={facts?.drawingBufferPx ? `${facts.drawingBufferPx.width}×${facts.drawingBufferPx.height} @${facts.pixelRatio}x` : "—"}
      />
      <Row label="context lost" value={facts ? String(facts.contextLostCount) : "—"} bad={!!facts && facts.contextLostCount > 0} />
      <Row label="fps" value={stats ? `${stats.fps} (${stats.frameTimeMs}ms)` : "—"} bad={!!stats && stats.fps > 0 && stats.fps < 20} />
      <Row label="draws / tris" value={stats ? `${stats.drawCalls} / ${stats.triangles.toLocaleString()}` : "—"} />
      <Row label="textures" value={stats ? String(stats.textures) : "—"} />
      <Row label="site terrain" value={site} bad={site.startsWith("failed")} />
      <Row label="outline clip" value={stats?.outlineClip ?? "—"} bad={(stats?.outlineClip ?? "").includes("outside")} />
      {facts && facts.gpuErrors.length > 0 && (
        <div className="mt-1.5 border-t border-fg/10 pt-1.5">
          <div className="text-fg/45">gpu errors</div>
          {facts.gpuErrors.map((message) => (
            <p key={message} className="mt-0.5 max-w-[240px] whitespace-normal break-words text-warning-strong">
              {message}
            </p>
          ))}
        </div>
      )}
      <div className="my-1.5 h-px bg-fg/10" />
      <div className="mb-1 text-fg/45">turn a pass off</div>
      <div className="flex flex-wrap gap-1">
        {BISECTABLE_EFFECTS.slice(0, 4).map((name) => bisectLink(name))}
        <a
          href={hrefFor(new Set(BISECTABLE_EFFECTS))}
          className={`pointer-events-auto rounded border px-1.5 py-0.5 ${
            allOff ? "border-warning/60 bg-warning/15 text-warning-strong" : "border-fg/20 text-fg/80"
          }`}
        >
          all off
        </a>
        {disabledSet.size > 0 && (
          <a href={hrefFor(new Set())} className="pointer-events-auto rounded border border-fg/20 px-1.5 py-0.5 text-fg/80">
            reset
          </a>
        )}
      </div>
      <div className="my-1.5 h-px bg-fg/10" />
      <Row label="service worker" value={swControlled ? "controlling" : "none"} />
      <button
        type="button"
        onClick={hardReset}
        disabled={resetting}
        className="pointer-events-auto mt-2 w-full rounded border border-fg/20 px-2 py-1.5 font-sans text-[11px] font-medium text-fg hover:bg-fg/10 disabled:opacity-50"
      >
        {resetting ? "Resetting…" : "Reset cache & reload"}
      </button>
    </div>
  );
}

function Row({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-fg/45">{label}</span>
      <span className={bad ? "text-warning-strong" : "text-fg"}>{value}</span>
    </div>
  );
}
