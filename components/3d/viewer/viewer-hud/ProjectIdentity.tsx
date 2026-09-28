"use client";

import { ChevronLeft } from "lucide-react";

import { useThreeDTranslations } from "@/components/3d/three-d-text";
import Link from "@/components/navigation/nav-link";

/**
 * Rozaris' identity chip. Its wordmark is the way out of the viewer; in NESTO
 * it reads as a Back control and returns to the canonical project page.
 */
export function ProjectIdentity({
  projectName,
  developerName,
  city,
  backHref,
}: {
  projectName: string;
  developerName: string;
  city: string;
  backHref: string;
}) {
  const t = useThreeDTranslations();
  return (
    <div className="viewer-glass flex h-12 min-w-0 items-center gap-2.5 rounded-panel px-3.5 sm:gap-3 sm:px-4">
      <Link
        href={backHref}
        aria-label={t("hud.backTo", { project: projectName })}
        data-testid="project-3d-back"
        className="-ml-1 flex shrink-0 items-center gap-1 font-serif text-xs tracking-[0.14em] text-white transition-colors hover:text-white/70 sm:text-sm"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        NESTO
      </Link>
      <span className="h-5 w-px shrink-0 bg-white/15" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-tight text-white sm:text-sm">{projectName}</p>
        <p className="truncate text-[11px] leading-tight text-white/60 sm:text-xs">
          {city ? `${developerName} · ${city}` : developerName}
        </p>
      </div>
    </div>
  );
}
