"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { ErrorState } from "@/components/ui/error-state";

/**
 * A group page failed (UI-02 §16.1, §22.1, §26.1).
 *
 * It replaces the content region only, so the group's header, its sections and
 * the account control stay usable, as a failed page does in the company shell
 * (app/(nesto)/error.tsx) and in the Admin Console. Retry asks the server
 * again; the overview is the working page to go back to.
 *
 * Version 2 only. The group area had no boundary of its own, and a failure
 * there reached the application's (app/error.tsx): in version 1 it still
 * does — this boundary hands the error on untouched.
 */
export default function GroupContentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Asked of the document, not of a hook: the answer is needed on the first render, and a boundary only ever renders in the browser.
  if (typeof document === "undefined" || document.documentElement.dataset.ds !== "2") throw error;
  return <GroupError error={error} reset={reset} />;
}

function GroupError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const t = useTranslations("shell");
  const ui = useTranslations("ui");
  const group = useTranslations("group");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div data-testid="group-content-error" className="space-y-4">
      <ErrorState
        title={t("pageErrorTitle")}
        description={t("pageErrorDescription")}
        reference={error.digest}
        onRetry={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      />
      <p className="text-center text-table">
        <Link href="/group" className="font-medium text-accent-strong hover:underline">
          {ui("backTo", { label: group("shell.overview") })}
        </Link>
      </p>
    </div>
  );
}
