"use client";

import { forwardRef, useRef, type ChangeEvent } from "react";
import { gsap } from "gsap";
import { Check, ChevronDown, Moon, RotateCcw, Sun, Sunrise, Sunset, X } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { clamp, cn } from "@/lib/3d/viewer/utils";
import type { SunTimePreset } from "@/lib/3d/runtime/sunPosition";
import { DOCK_MORPH_TIMING } from "../layoutState";
import { DockPopover } from "./DockPopover";

function formatHM(hours: number): string {
  const norm = ((hours % 24) + 24) % 24;
  const h = Math.floor(norm);
  const m = Math.round((norm - h) * 60);
  const carry = m === 60;
  return `${String(carry ? (h + 1) % 24 : h).padStart(2, "0")}:${String(carry ? 0 : m).padStart(2, "0")}`;
}

const PRESET_LABEL_KEY: Record<SunTimePreset["id"], string> = {
  morning: "sunTime.presetMorning",
  noon: "sunTime.presetNoon",
  goldenHour: "sunTime.presetGoldenHour",
  evening: "sunTime.presetEvening",
};

const PRESET_ICON: Record<SunTimePreset["id"], typeof Sun> = {
  morning: Sunrise,
  noon: Sun,
  goldenHour: Sunset,
  evening: Moon,
};

const SLIDER_THUMB_INSET_PX = 8;

export const TimeContent = forwardRef<
  HTMLDivElement,
  {
    isDesktop: boolean;
    interactive: boolean;
    timeHours: number;
    bounds: { startHours: number; endHours: number; stepMinutes: number };
    presets: SunTimePreset[];
    activePresetId: SunTimePreset["id"] | null;
    canReset: boolean;
    onTimeChange: (hours: number) => void;
    onPresetSelect: (preset: SunTimePreset) => void;
    onReset: () => void;
    onBack: () => void;
    onClose: () => void;
    popoverOpen: boolean;
    onTogglePopover: () => void;
    onClosePopover: () => void;
  }
>(function TimeContent(
  {
    isDesktop,
    interactive,
    timeHours,
    bounds,
    presets,
    activePresetId,
    canReset,
    onTimeChange,
    onPresetSelect,
    onReset,
    onClose,
    popoverOpen,
    onTogglePopover,
    onClosePopover,
  },
  ref
) {
  const { t } = useT();
  const reducedMotion = useEffectiveReducedMotion();
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const presetTriggerRef = useRef<HTMLButtonElement>(null);

  function handleSliderInput(e: ChangeEvent<HTMLInputElement>) {
    tweenRef.current?.kill();
    onTimeChange(clamp(Number(e.target.value), bounds.startHours, bounds.endHours));
  }

  function handlePresetSelect(preset: SunTimePreset) {
    onClosePopover();
    const proxy = { value: timeHours };
    tweenRef.current = gsap.to(proxy, {
      value: preset.hour,
      duration: reducedMotion ? 0.05 : DOCK_MORPH_TIMING.presetTween,
      ease: "power2.inOut",
      onUpdate: () => onTimeChange(proxy.value),
      onComplete: () => onPresetSelect(preset),
    });
  }

  const fillPercent = clamp(((timeHours - bounds.startHours) / Math.max(1e-6, bounds.endHours - bounds.startHours)) * 100, 0, 100);

  const sliderTrack = (
    <div className="relative flex h-5 flex-1 items-center">
      <div className="pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-brand-400"
          style={{ width: `calc(${fillPercent}% + ${(1 - fillPercent / 100) * SLIDER_THUMB_INSET_PX}px - ${(fillPercent / 100) * SLIDER_THUMB_INSET_PX}px)`, opacity: interactive ? 1 : 0.35 }}
        />
      </div>
      <input
        type="range"
        min={bounds.startHours}
        max={bounds.endHours}
        step={Math.max(bounds.stepMinutes, 1) / 60}
        value={timeHours}
        onChange={handleSliderInput}
        disabled={!interactive}
        aria-label={t("sunTime.title")}
        className="rz-range-single disabled:cursor-not-allowed"
      />
    </div>
  );

  const activePreset = presets.find((p) => p.id === activePresetId) ?? null;
  const presetTriggerLabel = activePreset ? t(PRESET_LABEL_KEY[activePreset.id]) : t("sunTime.presets");

  const presetPopoverList = (
    <div className="flex min-w-[196px] flex-col gap-0.5" role="menu" aria-label={t("sunTime.presets")}>
      {presets.map((preset) => {
        const isActive = activePresetId === preset.id;
        const PresetIcon = PRESET_ICON[preset.id];
        return (
          <button
            key={preset.id}
            type="button"
            role="menuitemradio"
            aria-checked={isActive}
            disabled={!interactive}
            onClick={() => handlePresetSelect(preset)}
            className={cn(
              "flex items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              isActive ? "bg-brand-500/10 text-brand-400" : "text-white/75 hover:bg-white/5 hover:text-white"
            )}
          >
            <PresetIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1 whitespace-nowrap">{t(PRESET_LABEL_KEY[preset.id])}</span>
            <span className={cn("shrink-0 tabular-nums", isActive ? "text-brand-400/70" : "text-white/40")}>{formatHM(preset.hour)}</span>
            {isActive && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("common.close")}
      title={t("common.close")}
      className="flex shrink-0 items-center rounded-control px-1.5 text-brand-400 transition-colors hover:text-brand-300"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  const presetTrigger = (
    <div className="relative flex shrink-0 items-center gap-3">
      <button
        ref={presetTriggerRef}
        type="button"
        onClick={onTogglePopover}
        aria-haspopup="menu"
        aria-expanded={popoverOpen}
        disabled={!interactive}
        className="flex items-center gap-1.5 rounded-control px-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {presetTriggerLabel}
        <ChevronDown className={cn("h-3.5 w-3.5 text-white/50 transition-transform", popoverOpen && "rotate-180")} aria-hidden="true" />
      </button>
      {isDesktop && <span className="h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />}
      <DockPopover open={popoverOpen} onClose={onClosePopover} triggerRef={presetTriggerRef} anchorClassName="right-0">
        {presetPopoverList}
      </DockPopover>
    </div>
  );

  const liveTimeReadout = (
    <span className="shrink-0 text-sm font-semibold tabular-nums text-white">{formatHM(timeHours)}</span>
  );

  if (isDesktop) {
    return (
      <div ref={ref} className="flex h-full w-full items-center gap-3 px-3.5 sm:px-4">
        {liveTimeReadout}
        <span className="h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />
        <span className="flex shrink-0 items-center gap-1.5 text-sm tabular-nums text-white/70">
          <Sunrise className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatHM(bounds.startHours)}
        </span>
        {sliderTrack}
        <span className="flex shrink-0 items-center gap-1.5 text-sm tabular-nums text-brand-400">
          <Sun className="h-4 w-4 shrink-0 fill-brand-400/40" aria-hidden="true" />
          {formatHM(bounds.endHours)}
        </span>
        <span className="h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />
        {presetTrigger}
        {closeButton}
      </div>
    );
  }

  return (
    <div ref={ref} className="flex w-full flex-col gap-1.5 px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        {liveTimeReadout}
        {presetTrigger}
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-control border border-white/15 px-2.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {closeButton}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] text-white/40">{formatHM(bounds.startHours)}</span>
        {sliderTrack}
        <span className="shrink-0 text-[10px] text-white/40">{formatHM(bounds.endHours)}</span>
      </div>
      {!interactive && <p className="text-[11px] text-white/35">{t("sunTime.readOnlyHint")}</p>}
    </div>
  );
});
