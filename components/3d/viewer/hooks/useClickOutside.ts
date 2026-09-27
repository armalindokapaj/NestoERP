import { useEffect, type RefObject } from "react";

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  active = true,
  alsoInside?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active) return;
    function handler(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (!ref.current || ref.current.contains(target)) return;
      if (alsoInside?.current?.contains(target)) return;
      onOutside();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onOutside, active, alsoInside]);
}
