import * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("nesto-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-card font-semibold text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-0.5 text-table text-fg-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-line px-5 py-3", className)}
      {...props}
    />
  );
}
