"use client";

import * as React from "react";
import { ArrowRight, X } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { useTranslations } from "@/components/i18n/i18n-provider";
import type { StartHere } from "@/lib/modules/dashboard/dashboard.start-here";

/**
 * The "Start here" card (AUD-05 §7, UX-15). Up to three numbered steps, each a
 * link to the canonical page; or, for a reader who may create nothing, a line
 * saying how records will reach them — never an instruction to create.
 *
 * "Hide" puts it away for the rest of this browser session for this identity
 * and this version of the guidance: sessionStorage under the opaque identity
 * digest (never the raw id, never localStorage, no form data), so another demo
 * identity in the same tab sees its own, and a route change never brings it
 * back. Hiding leaves the rest of the page exactly where it was.
 */
export function StartHereCard({
  guidance,
  dismissKey,
}: {
  guidance: Exclude<StartHere, { kind: "none" }>;
  dismissKey: string;
}) {
  // Unknown until the browser's storage is read: nothing drawn, so a hidden card never flashes.
  const [hidden, setHidden] = React.useState<boolean | null>(null);
  const headingId = React.useId();
  const t = useTranslations("dashboard");

  React.useEffect(() => {
    try {
      setHidden(window.sessionStorage.getItem(dismissKey) === "1");
    } catch {
      setHidden(false);
    }
  }, [dismissKey]);

  if (hidden !== false) return null;

  function hide() {
    try {
      window.sessionStorage.setItem(dismissKey, "1");
    } catch {
      // Hidden for this page view only; nothing else depends on it.
    }
    setHidden(true);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="nesto-card p-5"
      data-testid="start-here"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-card font-semibold text-fg">
          {t("startHere")}
        </h2>
        <button
          type="button"
          onClick={hide}
          aria-label={t("hideStartHere")}
          className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch:size-11"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {guidance.kind === "steps" ? (
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {guidance.steps.map((step, index) => (
            <li key={step.key} className="min-w-0">
              <Link
                href={step.href}
                navSource="dashboard"
                className="group flex h-full flex-col gap-1 rounded-lg border border-line p-3 transition-colors hover:border-line-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex items-center gap-2 text-body font-medium text-fg">
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-meta text-accent-strong"
                  >
                    {index + 1}
                  </span>
                  {step.label}
                  <ArrowRight
                    aria-hidden="true"
                    className="ml-auto size-4 text-fg-subtle group-hover:text-fg-muted"
                  />
                </span>
                <span className="text-table text-fg-muted">{step.why}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-body text-fg-muted">
          {t("nothingShared")}
        </p>
      )}
    </section>
  );
}
