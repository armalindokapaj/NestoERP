"use client";

import { useCallback, useMemo, type ChangeEvent } from "react";
import { useThreeDTranslations } from "@/components/3d/three-d-text";
import { clamp } from "@/lib/3d/viewer/utils";

export type SliderScale = {
  min: number;
  max: number;
  breakpoint?: number;
  breakpointFraction?: number;
  step: number;
  stepAfterBreakpoint?: number;
};

const RESOLUTION = 1000;
const MIN_GAP = Math.round(RESOLUTION * 0.02);

function valueToFraction(value: number, scale: SliderScale) {
  const { min, max, breakpoint, breakpointFraction = 0.5 } = scale;
  if (breakpoint == null || breakpoint <= min || breakpoint >= max) {
    return (value - min) / (max - min);
  }
  if (value <= breakpoint) {
    return breakpointFraction * ((value - min) / (breakpoint - min));
  }
  return (
    breakpointFraction +
    (1 - breakpointFraction) * ((value - breakpoint) / (max - breakpoint))
  );
}

function fractionToRawValue(fraction: number, scale: SliderScale) {
  const { min, max, breakpoint, breakpointFraction = 0.5 } = scale;
  if (breakpoint == null || breakpoint <= min || breakpoint >= max) {
    return min + fraction * (max - min);
  }
  if (fraction <= breakpointFraction) {
    return min + (fraction / breakpointFraction) * (breakpoint - min);
  }
  return (
    breakpoint +
    ((fraction - breakpointFraction) / (1 - breakpointFraction)) * (max - breakpoint)
  );
}

function snapValue(raw: number, scale: SliderScale) {
  const { min, max, breakpoint, step, stepAfterBreakpoint } = scale;
  if (breakpoint != null && raw > breakpoint) {
    const s = stepAfterBreakpoint ?? step;
    const snapped = breakpoint + Math.round((raw - breakpoint) / s) * s;
    return clamp(snapped, breakpoint, max);
  }
  const snapped = min + Math.round((raw - min) / step) * step;
  return clamp(snapped, min, breakpoint ?? max);
}

function valueToPosition(value: number, scale: SliderScale) {
  return Math.round(valueToFraction(value, scale) * RESOLUTION);
}

function positionToValue(position: number, scale: SliderScale) {
  return snapValue(fractionToRawValue(position / RESOLUTION, scale), scale);
}

export function RangeSlider({
  scale,
  valueMin,
  valueMax,
  onChange,
  formatValue,
  ariaLabel,
}: {
  scale: SliderScale;
  valueMin: number | null;
  valueMax: number | null;
  onChange: (min: number | null, max: number | null) => void;
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  const t = useThreeDTranslations();
  const effectiveMin = clamp(valueMin ?? scale.min, scale.min, scale.max);
  const effectiveMax = clamp(valueMax ?? scale.max, scale.min, scale.max);

  const posMin = useMemo(() => valueToPosition(effectiveMin, scale), [effectiveMin, scale]);
  const posMax = useMemo(() => valueToPosition(effectiveMax, scale), [effectiveMax, scale]);

  const handleMinInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const pos = clamp(Number(e.target.value), 0, posMax - MIN_GAP);
      const next = positionToValue(pos, scale);
      onChange(next <= scale.min ? null : next, valueMax);
    },
    [posMax, scale, onChange, valueMax]
  );

  const handleMaxInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const pos = clamp(Number(e.target.value), posMin + MIN_GAP, RESOLUTION);
      const next = positionToValue(pos, scale);
      onChange(valueMin, next >= scale.max ? null : next);
    },
    [posMin, scale, onChange, valueMin]
  );

  const barLeftPct = (posMin / RESOLUTION) * 100;
  const barRightPct = 100 - (posMax / RESOLUTION) * 100;
  const minThumbOnTop = posMin / RESOLUTION > 0.5;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm font-semibold text-fg">
        <span>{formatValue(effectiveMin)}</span>
        <span>
          {formatValue(effectiveMax)}
          {valueMax == null ? "+" : ""}
        </span>
      </div>
      <div className="relative flex h-5 items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-line-strong" />
        <div
          className="absolute h-1.5 rounded-full bg-accent"
          style={{ left: `${barLeftPct}%`, right: `${barRightPct}%` }}
        />
        <input
          type="range"
          min={0}
          max={RESOLUTION}
          value={posMin}
          onChange={handleMinInput}
          aria-label={t("hud.rangeMinimum", { label: ariaLabel })}
          className="rz-range-thumb"
          style={{ zIndex: minThumbOnTop ? 5 : 3 }}
        />
        <input
          type="range"
          min={0}
          max={RESOLUTION}
          value={posMax}
          onChange={handleMaxInput}
          aria-label={t("hud.rangeMaximum", { label: ariaLabel })}
          className="rz-range-thumb"
          style={{ zIndex: minThumbOnTop ? 3 : 4 }}
        />
      </div>
    </div>
  );
}
