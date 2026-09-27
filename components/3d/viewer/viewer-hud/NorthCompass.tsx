"use client";

import { useEffect, useRef } from "react";
import { Navigation2 } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import type { ThreeProjectViewerHandle } from "@/components/3d/company/viewerTypes";

export function NorthCompass({
  viewerRef,
  northOffsetDeg = 0,
}: {
  viewerRef: React.RefObject<ThreeProjectViewerHandle | null>;
  northOffsetDeg?: number;
}) {
  const needleRef = useRef<SVGSVGElement>(null);
  const { t } = useT();

  useEffect(() => {
    let raf = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      const state = viewerRef.current?.getCameraState();
      const needle = needleRef.current;
      if (!state || !needle) return;
      const dx = state.position.x - state.target.x;
      const dz = state.position.z - state.target.z;
      const cameraAzimuthRad = Math.atan2(dx, dz);
      const northOffsetRad = (northOffsetDeg * Math.PI) / 180;
      const needleDeg = ((northOffsetRad - cameraAzimuthRad) * 180) / Math.PI;
      needle.style.transform = `rotate(${needleDeg}deg)`;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewerRef, northOffsetDeg]);

  return (
    <button
      type="button"
      title={t("project.northSign")}
      aria-label={t("project.northSign")}
      className="viewer-glass flex h-12 w-12 shrink-0 items-center justify-center rounded-panel"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 ring-2 ring-brand-400/50">
        <Navigation2
          ref={needleRef}
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-brand-400"
          style={{ transformOrigin: "50% 50%" }}
        />
      </span>
    </button>
  );
}
