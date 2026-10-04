"use client";

import { forwardRef } from "react";
import { Building2, Camera, LayoutGrid, Plane, Signpost, X } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { cn } from "@/lib/3d/viewer/utils";
import type { CameraPreset } from "@/lib/3d/viewer/types";

function iconForPresetLabel(label: string) {
  const key = label.trim().toLowerCase();
  if (key.includes("exterior")) return Building2;
  if (key.includes("street")) return Signpost;
  if (key.includes("aerial")) return Plane;
  if (key.includes("neighborhood") || key.includes("neighbourhood")) return LayoutGrid;
  return Camera;
}

export const ViewsContent = forwardRef<
  HTMLDivElement,
  {
    isDesktop: boolean;
    presets: CameraPreset[];
    activePresetId: string | null;
    onSelectPreset: (preset: CameraPreset) => void;
    onBack: () => void;
    onClose: () => void;
  }
>(function ViewsContent({ isDesktop, presets, activePresetId, onSelectPreset, onClose }, ref) {
  const { t } = useT();

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("common.close")}
      title={t("common.close")}
      className="flex shrink-0 items-center rounded-control px-1.5 text-accent-strong transition-colors hover:text-accent-strong"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  function renderPresetRow(itemClassName: string, rowClassName?: string) {
    if (presets.length === 0) {
      return <p className="flex flex-1 items-center justify-center px-2 text-sm text-fg/40">{t("views.empty")}</p>;
    }
    return (
      <div className={cn("flex flex-1 items-stretch gap-1 self-stretch overflow-x-auto", rowClassName)}>
        {presets.map((preset) => {
          const isActive = preset.id === activePresetId;
          const Icon = iconForPresetLabel(preset.label);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectPreset(preset)}
              aria-pressed={isActive}
              className={cn(
                "relative flex shrink-0 flex-col items-center justify-center gap-1 rounded-t-control transition-colors",
                itemClassName,
                isActive ? "bg-accent/10 text-accent-strong" : "text-fg/70 hover:bg-fg/5 hover:text-fg"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="w-full truncate text-center text-xs font-medium leading-none">{preset.label}</span>
              {isActive && <span className="absolute inset-x-0 bottom-0 h-1 bg-accent" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  }

  if (isDesktop) {
    return (
      <div ref={ref} className="flex h-full w-full items-center gap-3 px-3.5 sm:px-4">
        {renderPresetRow("w-28 px-1", "max-w-[636px]")}
        <span className="h-6 w-px shrink-0 bg-fg/10" aria-hidden="true" />
        {closeButton}
      </div>
    );
  }

  return (
    <div ref={ref} className="flex w-full min-h-[70px] items-stretch gap-2 px-3.5">
      {renderPresetRow("px-3")}
      <span className="h-6 w-px shrink-0 self-center bg-fg/10" aria-hidden="true" />
      {closeButton}
    </div>
  );
});
