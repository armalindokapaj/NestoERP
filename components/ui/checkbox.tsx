"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        // The 3:1 control border: an unchecked box is visible on every ground (AUD-11 AV-10).
        "peer relative size-4 shrink-0 rounded-[4px] border border-control bg-surface",
        // A 44px hit area under touch without a bigger box (AUD-04 §3, MW-19):
        // an invisible square around the 16px control.
        "touch:after:absolute touch:after:-inset-3.5 touch:after:content-['']",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
