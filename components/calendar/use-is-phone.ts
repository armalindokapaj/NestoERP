"use client";

import { useIsBelow } from "@/components/ui/use-breakpoint";

/**
 * True below the `md` breakpoint (PRD #39 §28): phones get sheets and Agenda first.
 *
 * The shared breakpoint hook underneath (AUD-04 §3, SP-15, MW-16), not a local
 * matchMedia copy: `undefined` until the browser has answered, so a caller
 * never paints a guessed layout and then swaps it.
 */
export function useIsPhone(): boolean | undefined {
  return useIsBelow("md");
}
