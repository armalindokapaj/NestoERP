"use client";

import { ErrorState } from "@/components/ui/error-state";

/**
 * A section that failed to load (Admin IA §31). The shell and sidebar stay;
 * only this section offers Try again. Production shows no stack; development
 * adds the message beneath.
 */
export function AdminSectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-3">
      <ErrorState title="Something went wrong loading this section." description="The rest of Platform Admin still works. Try again, or check System Health if it continues." onRetry={reset} retryLabel="Try again" />
      {process.env.NODE_ENV === "development" ? <pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 text-meta text-fg-muted">{error.message}{error.digest ? `\n${error.digest}` : ""}</pre> : null}
    </div>
  );
}
