"use client";

import { forwardRef } from "react";
import { gsap } from "gsap";
import { useT } from "@/lib/3d/viewer/i18n";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/3d/viewer/utils";
import { DOCK_MORPH_TIMING } from "../layoutState";
import { MODULE_ICONS, NAV_ITEMS, type ActiveModule } from "../types";

type NavId = Exclude<ActiveModule, "none">;

export const NavigationContent = forwardRef<
  HTMLDivElement,
  { activeModule: ActiveModule; onSelect: (id: NavId) => void }
>(function NavigationContent({ activeModule, onSelect }, ref) {
  const { t } = useT();
  const reducedMotion = useEffectiveReducedMotion();

  function handleClick(id: NavId, target: HTMLButtonElement) {
    if (!reducedMotion) {
      gsap.timeline().to(target, { scale: 0.96, duration: DOCK_MORPH_TIMING.selectionFeedback, ease: "power1.out" }).to(target, {
        scale: 1,
        duration: DOCK_MORPH_TIMING.selectionFeedback,
        ease: "power1.out",
      });
    }
    if (id === "explore") {
      if (activeModule !== "explore") onSelect("explore");
    } else if (activeModule === id) {
      onSelect("explore");
    } else {
      onSelect(id);
    }
  }

  return (
    <div ref={ref} className="flex h-full min-h-[70px] w-full items-stretch gap-1 px-3.5 sm:px-4 lg:min-h-0">
      {NAV_ITEMS.map((id) => {
        const Icon = MODULE_ICONS[id];
        const isActive = activeModule === id;
        const label = t(`viewer.${id}`);
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => handleClick(id, e.currentTarget)}
            aria-label={label}
            aria-pressed={isActive}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-t-control transition-colors lg:w-24 lg:flex-none",
              isActive ? "bg-brand-500/10 text-brand-400" : "text-white/60 hover:bg-white/5 hover:text-white"
            )}
          >
            <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="whitespace-nowrap text-xs font-medium leading-none">{label}</span>
            {isActive && <span className="absolute inset-x-0 bottom-0 h-1 bg-brand-400" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
});
