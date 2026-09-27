"use client";

import { startTransition, useEffect } from "react";

import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { ErrorState } from "@/components/ui/error-state";
import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * A project page failed to load (AUD-05 §6, UX-11, UX-12).
 *
 * A retriable read failure, distinct from a project that does not exist or is
 * out of reach (`notFound()` → the app's 404, which names nothing). Retry asks
 * the server again — `reset()` alone would re-render the same failed payload —
 * and the Projects list is the authorised way out. The error text is never
 * shown: it could carry a record name the reader may not see.
 */
export default function ProjectWorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const t = useTranslations("projects");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div data-testid="project-error" className="space-y-4">
      <ErrorState
        title={t("errorPage.title")}
        description={t("errorPage.description")}
        onRetry={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      />
      <p className="text-center text-table">
        <Link href="/projects" className="font-medium text-accent-strong hover:underline">
          {t("errorPage.back")}
        </Link>
      </p>
    </div>
  );
}
