"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { RotateCw } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useCommonTranslations } from "@/components/i18n/common-text";

/**
 * One independently revealed part of a page (NAV-03 §8, STREAM-01, STREAM-07).
 *
 * The page renders its guarded frame first; each section's data is awaited
 * inside its own Suspense boundary, below one of these. A section that fails
 * to render shows "Couldn't load this section" with Retry, in the same
 * geometry, and nothing else on the page is affected.
 *
 * Retry refreshes the route once, however many sections ask at the same
 * moment: the server reruns the page in a fresh request scope, siblings
 * included. It is never a per-section endpoint. Framework control flow —
 * a redirect to sign-in, a not-found, an access denial — is never caught
 * here; it goes on to the route's own handling.
 */

let refreshing: Promise<void> | null = null;

function useCoalescedRefresh() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const refresh = React.useCallback(() => {
    if (refreshing) return;
    let done!: () => void;
    refreshing = new Promise<void>((resolve) => (done = resolve));
    startTransition(() => router.refresh());
    // A refresh has no completion promise; a second press inside a second joins the first.
    window.setTimeout(() => {
      done();
      refreshing = null;
    }, 1_000);
  }, [router]);
  return { refresh, pending };
}

function isFrameworkSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_") || digest.includes("NEXT_REDIRECT") || digest.includes("NEXT_HTTP_ERROR_FALLBACK"));
}

type BoundaryState = { error: unknown };

class Boundary extends React.Component<{ fallback: (reset: () => void) => React.ReactNode; children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      if (isFrameworkSignal(this.state.error)) throw this.state.error;
      return this.props.fallback(() => this.setState({ error: null }));
    }
    return this.props.children;
  }
}

export function SectionError({ className, onRetry, pending }: { className?: string; onRetry: () => void; pending: boolean }) {
  const t = useCommonTranslations();
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 p-5", className)} data-testid="section-error">
      <p className="text-table text-fg-muted">{t("sectionFailed")}</p>
      <button type="button" onClick={onRetry} disabled={pending} aria-busy={pending || undefined} className="inline-flex items-center gap-1.5 text-table font-medium text-accent-strong hover:underline disabled:opacity-60" data-testid="section-retry">
        <RotateCw aria-hidden="true" className={cn("size-3.5", pending && "motion-safe:animate-spin")} />
        {t("retry")}
      </button>
    </div>
  );
}

/** The failed state: Retry refreshes the route, and the section tries again once that refresh has landed. */
function RetryingError({ className, reset }: { className?: string; reset: () => void }) {
  const { refresh, pending } = useCoalescedRefresh();
  const was = React.useRef(false);
  React.useEffect(() => {
    if (was.current && !pending) reset();
    was.current = pending;
  }, [pending, reset]);
  return <SectionError className={className} pending={pending} onRetry={refresh} />;
}

/** A client boundary for one section; its children are server-rendered and may suspend. */
export function SectionBoundary({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Boundary fallback={(reset) => <RetryingError className={className} reset={reset} />}>{children}</Boundary>;
}
