"use client";

import { useState } from "react";
import { Check, Clock } from "lucide-react";
import type { ConstructionStage } from "@/lib/3d/viewer/types";
import { useT } from "@/lib/3d/viewer/i18n";
import { cn } from "@/lib/3d/viewer/utils";

export function ConstructionTimelineStrip({
  stages,
  overallPercent,
  compact = false,
}: {
  stages: ConstructionStage[];
  overallPercent: number;
  compact?: boolean;
}) {
  const activeIndex = stages.findIndex((s) => s.status === "active");
  const [selected, setSelected] = useState(activeIndex >= 0 ? activeIndex : 0);
  const stage = stages[selected];
  const { t } = useT();
  // Rozaris names stages from a fixed marketplace list; a NESTO stage is a
  // planning phase and carries its own name.
  const stageName = (s: ConstructionStage) => s.name;

  if (stages.length === 0) return null;

  if (compact) {
    const activeStage = stages[activeIndex >= 0 ? activeIndex : stages.length - 1];
    const r = 15;
    const circumference = 2 * Math.PI * r;
    return (
      <div className="glass-panel-dark flex items-center gap-3 rounded-pill py-2 pl-3 pr-4 text-fg">
        <span className="relative h-9 w-9 shrink-0">
          <svg viewBox="0 0 36 36" className="h-9 w-9">
            <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
            <circle
              cx="18"
              cy="18"
              r={r}
              fill="none"
              stroke="var(--nesto-accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - overallPercent / 100)}
              transform="rotate(-90 18 18)"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold">
            {overallPercent}%
          </span>
        </span>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-fg/50">
            {t("project.progress")}
          </p>
          <p className="truncate text-sm font-semibold">{stageName(activeStage)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel-dark rounded-panel p-4 text-fg">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{t("project.constructionProgress")}</p>
        <span className="text-sm font-bold text-accent-strong">{overallPercent}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={stages.length - 1}
        step={1}
        value={selected}
        onChange={(e) => setSelected(Number(e.target.value))}
        aria-label={t("project.scrubTimeline")}
        className="w-full accent-accent"
      />
      <div className="mt-2 flex justify-between gap-1">
        {stages.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setSelected(i)}
            aria-label={stageName(s)}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i === selected
                ? "bg-accent"
                : s.status === "done"
                ? "bg-fg/60"
                : "bg-fg/15"
            )}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm">
        {stage.status === "done" ? (
          <Check className="h-4 w-4 text-green-400" />
        ) : (
          <Clock className="h-4 w-4 text-accent-strong" />
        )}
        <span className="font-medium">{stageName(stage)}</span>
        <span className="text-fg/50">· {stage.dateLabel}</span>
      </div>
    </div>
  );
}
