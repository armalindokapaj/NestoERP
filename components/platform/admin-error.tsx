"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { ErrorState } from "@/components/ui/error-state";

/**
 * A section that failed to load (Admin IA §31). The shell and sidebar stay;
 * only this section offers Try again. Production shows no stack; development
 * adds the message beneath.
 */
export function AdminSectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("admin");
  return (
    <div className="space-y-3">
      <ErrorState title={t("errors.sectionTitle")} description={t("errors.sectionDescription")} onRetry={reset} retryLabel={t("errors.tryAgain")} />
      {process.env.NODE_ENV === "development" ? <pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 text-meta text-fg-muted">{error.message}{error.digest ? `\n${error.digest}` : ""}</pre> : null}
    </div>
  );
}
