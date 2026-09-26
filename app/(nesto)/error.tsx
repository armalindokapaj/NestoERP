"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { ErrorState } from "@/components/ui/error-state";

/**
 * A page below the shell failed (NAV-01 LOAD-05).
 *
 * It replaces the content region only, so the sidebar, top bar and workspace
 * controls stay usable. Retry asks the server again rather than re-rendering
 * what failed; the dashboard is always a working screen to go back to. A
 * failure of the shell itself is caught by `app/error.tsx` instead — a boundary
 * never catches its own segment's layout. More specific boundaries (the
 * Projects page, a project, its units) keep their own answers.
 */
export default function ContentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const t = useTranslations("shell");
  const system = useTranslations("system");

  useEffect(() => {
    // Whatever was pending ends here: this is where it arrived (NAV-03).
    feedback?.store.reset();
    console.error(error);
  }, [error, feedback]);

  return (
    <div data-testid="content-error" className="space-y-4">
      <ErrorState
        title={t("pageErrorTitle")}
        description={t("pageErrorDescription")}
        onRetry={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      />
      <p className="text-center text-table">
        <Link href="/dashboard" navSource="dashboard" className="font-medium text-accent-strong hover:underline">
          {system("returnToDashboard")}
        </Link>
      </p>
    </div>
  );
}
