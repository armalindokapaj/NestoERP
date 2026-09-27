"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { gsap } from "gsap";
import { useT } from "@/lib/3d/viewer/i18n";
import { useIsDesktop } from "@/components/3d/viewer/hooks/useMediaQuery";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";

const STORAGE_KEY = "nesto:project-viewer:hint-seen";

function subscribe() {
  return () => {};
}
function getSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return "1";
  }
}
function getServerSnapshot() {
  return "1";
}

export function FirstVisitHint({ ready }: { ready: boolean }) {
  const { t } = useT();
  const isDesktop = useIsDesktop();
  const reducedMotion = useEffectiveReducedMotion();
  const elRef = useRef<HTMLDivElement>(null);
  const dismissedRef = useRef(false);
  const seenFlag = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const shouldRender = ready && !seenFlag;

  useEffect(() => {
    if (!shouldRender) return;
    const el = elRef.current;
    if (!el) return;

    function dismiss() {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      try {
        window.localStorage.setItem(STORAGE_KEY, "1");
      } catch {
      }
      gsap.to(el, { autoAlpha: 0, duration: reducedMotion ? 0.001 : 0.25, ease: "power1.out" });
    }

    gsap.fromTo(
      el,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: reducedMotion ? 0.001 : 0.4, ease: "power1.out" }
    );
    const fadeTimer = setTimeout(dismiss, 2600);
    window.addEventListener("pointerdown", dismiss, { once: true, passive: true });

    return () => {
      clearTimeout(fadeTimer);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [shouldRender, reducedMotion]);

  if (!shouldRender) return null;

  return (
    <div
      ref={elRef}
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-[60%] z-10 -translate-x-1/2 opacity-0"
    >
      <p className="viewer-glass rounded-pill px-4 py-2 text-xs font-medium text-white/80">
        {isDesktop ? t("viewer.dragToExplore") : t("viewer.swipeToExplore")}
      </p>
    </div>
  );
}
