import { LoaderCircle } from "lucide-react";

/**
 * The editor's own loading state (3D Editor PRD §78, §81): the shape of the
 * editor — top bar, scene panel, viewport, properties and tools — while the
 * Experience is authorized and read. Never the Platform Admin skeleton.
 */
export default function Loading() {
  return (
    <div className="flex h-full w-full flex-col" aria-busy="true">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3">
        <div className="space-y-1.5"><div className="h-3 w-56 rounded bg-surface-muted" /><div className="h-2 w-40 rounded bg-surface" /></div>
        <div className="ml-auto h-8 w-64 rounded bg-surface" />
        <div className="h-8 w-20 rounded bg-surface-muted" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 space-y-2 border-r border-line p-3">{[0, 1, 2, 3].map((row) => <div key={row} className="h-3 rounded bg-surface" />)}</div>
        <div role="status" className="flex flex-1 items-center justify-center gap-2 bg-surface text-xs text-fg-muted"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Opening the Experience Editor…</div>
        <div className="w-80 shrink-0 space-y-2 border-l border-line p-3">{[0, 1, 2].map((row) => <div key={row} className="h-16 rounded bg-surface" />)}</div>
      </div>
      <div className="h-10 shrink-0 border-t border-line" />
    </div>
  );
}
