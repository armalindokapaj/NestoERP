"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

/**
 * Copy-to-clipboard control (design spec §68).
 *
 * The one place V0.1 raises a toast: a real action with a real result, so the
 * toast surface is proven wired rather than sitting as dead code waiting for
 * V0.2. Also shows an inline tick, because §56 forbids relying on one channel.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: `${label} copied`, tone: "success" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Could not copy",
        description: "Your browser blocked clipboard access.",
        tone: "danger",
      });
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors",
            "hover:bg-hover hover:text-fg",
            className,
          )}
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5 text-success-strong" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{copied ? "Copied" : `Copy ${label.toLowerCase()}`}</TooltipContent>
    </Tooltip>
  );
}
