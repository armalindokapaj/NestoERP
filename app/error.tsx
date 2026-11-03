"use client";

import { useEffect } from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

/** Application error boundary (spec §58). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("ui");

  useEffect(() => {
    // Replaced by real error reporting when observability is introduced.
    console.error(error);
  }, [error]);

  // The shell itself failed: a minimal screen with the two ways out, Retry and — in version 2 — Sign in (UI-02 §7.5).
  // A plain link: the router that failed is not asked to take anybody anywhere.
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <ErrorState
        className="w-full max-w-md"
        onRetry={reset}
        reference={error.digest}
        action={
          <Button asChild variant="ghost" size="sm" className="hidden ds2:inline-flex">
            <a href="/login">{t("errorSignIn")}</a>
          </Button>
        }
      />
    </div>
  );
}
