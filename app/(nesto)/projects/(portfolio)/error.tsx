"use client";

import { startTransition, useEffect } from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";

import { ErrorState } from "@/components/ui/error-state";

/**
 * The Projects page could not be built (E-05A §76).
 *
 * Scoped to the page itself by its route group, so a failure here keeps the
 * shell and the navigation on screen, and a project's own pages keep their own
 * answers. It says what failed and offers to try again — never the server's
 * words. Retry asks the server again rather than re-rendering what failed.
 */
export default function ProjectsPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const t = useTranslations("projects");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={t("portfolio.loadFailed")}
      description={t("errorPage.description")}
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}
