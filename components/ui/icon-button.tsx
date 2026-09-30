import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * An icon-only button with a required accessible name (MOB-01 §36).
 *
 * A 36px control with a mouse and a 44px target under touch (Button's icon
 * sizes). `pressed` makes it a toggle: it sets `aria-pressed` and a visible
 * filled state, so the state is not colour alone.
 */
export type IconButtonProps = Omit<ButtonProps, "size" | "children" | "aria-label" | "loading"> & {
  /** What the control does; read by screen readers and used as the tooltip-free name. */
  label: string;
  icon: React.ReactNode;
  size?: "icon" | "icon-sm";
  pressed?: boolean;
};

export function IconButton({ label, icon, size = "icon", variant = "ghost", pressed, className, ...props }: IconButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(pressed && "bg-hover text-fg ring-1 ring-inset ring-line-strong", className)}
      {...props}
    >
      {icon}
    </Button>
  );
}
