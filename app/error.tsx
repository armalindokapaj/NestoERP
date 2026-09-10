"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/error-state";

/** Application error boundary (spec §58). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replaced by real error reporting when observability is introduced.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <ErrorState className="w-full max-w-md" onRetry={reset} />
    </div>
  );
}
