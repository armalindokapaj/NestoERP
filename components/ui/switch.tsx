"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils/cn";

/** Switch (design spec §88). For immediate on/off settings, never for forms that save on submit. */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors",
        // 44×44 hit area under touch, the track unchanged (AUD-04 §3, MW-19).
        "touch:after:absolute touch:after:-inset-x-1 touch:after:-inset-y-3 touch:after:content-['']",
        // The off track is the 3:1 control border, not a divider grey (AUD-11 AV-10); forced colours
        // keep a drawn track and a thumb whose position is the state (AV-15).
        "data-[state=checked]:bg-accent data-[state=unchecked]:bg-control forced-colors:border-[ButtonText]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-surface shadow-card transition-transform forced-colors:bg-[ButtonText] forced-colors:data-[state=checked]:bg-[Highlight]",
          "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
