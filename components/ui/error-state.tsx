"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** The Retry button's label, for callers that translate it. */
  retryLabel?: string;
  className?: string;
};

/** The standard NESTO error component (spec §58). */
export function ErrorState({
  title = "Something went wrong.",
  description = "Please try again.",
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorStateProps) {
  // Announced when it appears: a failed load replaces what the reader was
  // waiting for (AUD-05 §6, §8).
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-line bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger-strong">
        <TriangleAlert aria-hidden="true" className="size-5" />
      </div>
      <p className="text-card font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-sm text-table text-fg-muted">{description}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
