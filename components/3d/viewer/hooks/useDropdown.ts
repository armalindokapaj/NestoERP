"use client";

import { useRef, useState } from "react";
import { useClickOutside } from "./useClickOutside";

export function useDropdown<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useClickOutside(ref, () => setOpen(false), open);

  return {
    open,
    setOpen,
    toggle: () => setOpen((v) => !v),
    close: () => setOpen(false),
    ref,
  };
}
