"use client";

import { useEffect, useState } from "react";

export function useIdleFade(idleAfterMs = 3500): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function markActive() {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), idleAfterMs);
    }
    const startTimer = setTimeout(markActive, 0);

    window.addEventListener("pointermove", markActive);
    window.addEventListener("pointerdown", markActive);
    window.addEventListener("touchstart", markActive, { passive: true });
    window.addEventListener("wheel", markActive, { passive: true });
    return () => {
      clearTimeout(startTimer);
      clearTimeout(timer);
      window.removeEventListener("pointermove", markActive);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("touchstart", markActive);
      window.removeEventListener("wheel", markActive);
    };
  }, [idleAfterMs]);

  return idle;
}
