"use client";

import * as React from "react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/** Inspector building blocks for the Experience Editor's dark panels. */

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-line bg-surface/70 p-3"><h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-fg-subtle">{title}</h3><div className="space-y-3">{children}</div></section>;
}

export function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className={cn("flex items-center justify-between gap-3 text-xs text-fg-muted", disabled && "opacity-40")}><span>{label}</span><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="size-4 accent-accent" /></label>;
}

export function Range({ label, value, min, max, step, suffix, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void; disabled?: boolean }) {
  return <label className={cn("block text-xs text-fg-muted", disabled && "opacity-40")}><span className="mb-1 flex justify-between"><span>{label}</span><span className="font-mono text-fg-muted">{value}{suffix}</span></span><input className="w-full accent-accent" type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

export function Color({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className={cn("flex items-center justify-between text-xs text-fg-muted", disabled && "opacity-40")}><span>{label}</span><span className="flex items-center gap-2"><input type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /><code>{value}</code></span></label>;
}

export function Choice({ label, value, options, onChange, disabled }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className={cn("block text-xs text-fg-muted", disabled && "opacity-40")}><span className="mb-1 block">{label}</span><select className={cn(selectClass, "h-8 border-line-strong bg-canvas text-xs text-fg")} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

/**
 * Keeps one panel's failure inside that panel (3D Editor PRD §158): the
 * viewport, the other panels and the unsaved draft all stay usable.
 */
export class PanelBoundary extends React.Component<{ label: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-lg border border-danger/30 bg-surface p-3 text-xs text-fg-muted">
        <p className="font-medium text-danger-strong">{this.props.label} could not be shown.</p>
        <p className="mt-1 text-fg-subtle">The rest of the editor and your unsaved changes are unaffected.</p>
        <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => this.setState({ failed: false })}>Try again</Button>
      </div>
    );
  }
}
