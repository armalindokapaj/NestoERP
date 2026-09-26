"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { ErrorState } from "@/components/ui/error-state";

/**
 * The structure or a unit could not be loaded (E-05B §94).
 *
 * Says what failed and offers to try again — never the server's words. Retry
 * asks the server again rather than re-rendering what failed.
 */
export default function ProjectStructureError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="Could not load project structure."
      description="Nothing was changed. Try again in a moment."
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}
