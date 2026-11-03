"use client";

import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

/**
 * An icon-only button with a required accessible name (MOB-01 §36).
 *
 * A 36px control with a mouse and a 44px target under touch (Button's icon
 * sizes). `pressed` makes it a toggle: it sets `aria-pressed` and a visible
 * filled state, so the state is not colour alone.
 *
 * In version 2 the box follows the density (UI-02 §6.4): 40px, or 32px
 * compact — 28px for `icon-sm`, never under the 24px target — and 44px under
 * touch whatever the preference. Hover is the neutral ground, with no colour
 * of its own (§9.1), and the pressed ring stays under it.
 *
 * Version 2 also shows the label as a tooltip, on hover and on keyboard focus
 * alike (§9.1): 400ms after the pointer arrives (§9.2), at once on focus, gone
 * on Escape, and never on touch, where nothing hovers (§9.3). It brings its
 * own provider, so it works wherever it is put. The tooltip is for the eye:
 * the label is already the button's name, so the button is not described by
 * it a second time. In version 1 it is not drawn — its content is `hidden`
 * unless the page is on version 2.
 */
export type IconButtonProps = Omit<ButtonProps, "size" | "children" | "aria-label" | "loading"> & {
  /** What the control does: its accessible name, and in version 2 its tooltip. */
  label: string;
  icon: React.ReactNode;
  size?: "icon" | "icon-sm";
  pressed?: boolean;
};

/** §9.2: a tooltip waits 400ms before it opens. */
const TOOLTIP_OPEN_MS = 400;

export function IconButton({ label, icon, size = "icon", variant = "ghost", pressed, className, ...props }: IconButtonProps) {
  return (
    <TooltipProvider delayDuration={TOOLTIP_OPEN_MS}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            aria-label={label}
            aria-pressed={pressed}
            // Stated, so the tooltip's own reference does not land here: only a caller's description does.
            aria-describedby={props["aria-describedby"]}
            className={cn(pressed && "bg-hover text-fg ring-1 ring-inset ring-line-strong", className)}
            {...props}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent aria-hidden="true" className="hidden ds2:block">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
