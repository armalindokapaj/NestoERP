"use client";

import * as React from "react";
import { CircleHelp, X } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { useCommonTranslations } from "@/components/i18n/common-text";
import { tabIdentity } from "@/lib/unsaved/tab-context";
import { cn } from "@/lib/utils/cn";

/**
 * "What is this?" — contextual help at a point where first-time users get
 * confused (AUD-05 §7, UX-15, UX-16).
 *
 * - A disclosure, not a tour or a popover: a real button with `aria-expanded`
 *   opens a short explanation in the page flow, so it works by keyboard and
 *   touch, never on hover, and never covers the action it explains.
 * - It describes what the screen does today and may link to the canonical
 *   page for the related action. It never grants anything, creates a sample
 *   record or stands in for a failed request.
 * - "Hide this tip" removes it for the rest of the browser session for this
 *   identity and this version of the text only: sessionStorage, keyed by the
 *   opaque identity digest the shell registers (`tabIdentity().user`, AUD-03
 *   §7) — never the raw user id, never localStorage, no form data. Another
 *   demo identity in the same tab sees it again; a route change does not bring
 *   it back. Bumping `version` when the text changes shows it once more.
 */

const PREFIX = "nesto.help.dismissed";

/** The sessionStorage key for one tip, one identity and one version of its text. */
export function helpDismissalKey(user: string, id: string, version: number): string {
  return `${PREFIX}:${user}:${id}:v${version}`;
}

type SessionStore = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): SessionStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked: the tip simply stays available
  }
}

/** True when this identity hid this version of the tip earlier in the session. */
export function isHelpDismissed(store: SessionStore | null, user: string | null, id: string, version: number): boolean {
  if (!store || !user) return false;
  try {
    return store.getItem(helpDismissalKey(user, id, version)) === "1";
  } catch {
    return false;
  }
}

/** Records the dismissal; without an identity or storage it lasts for this page only. */
export function dismissHelp(store: SessionStore | null, user: string | null, id: string, version: number): void {
  if (!store || !user) return;
  try {
    store.setItem(helpDismissalKey(user, id, version), "1");
  } catch {
    // quota or privacy mode: the in-memory dismissal still applies
  }
}

export type WhatIsThisProps = {
  /** Stable id of the confusion point, e.g. "approvals.queue". */
  id: string;
  /** Bump when the explanation changes materially. */
  version?: number;
  /** Visible trigger text. */
  label?: string;
  /** Short heading inside the panel. */
  title: string;
  children: React.ReactNode;
  /** The canonical page for the action or topic the tip explains. */
  link?: { label: string; href: string };
  className?: string;
};

export function WhatIsThis({ id, version = 1, label, title, children, link, className }: WhatIsThisProps) {
  const t = useCommonTranslations();
  const panelId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // The identity is known only in the browser, after the shell's layout effect
  // has registered it — so storage is read in an effect, never during render.
  React.useEffect(() => {
    if (isHelpDismissed(sessionStore(), tabIdentity()?.user ?? null, id, version)) setDismissed(true);
  }, [id, version]);

  if (dismissed) return null;

  return (
    <div className={cn("text-table", className)} data-testid={`help-${id}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 font-medium text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch:min-h-11"
      >
        <CircleHelp aria-hidden="true" className="size-4" />
        {label ?? t("help.whatIsThis")}
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={title}
        hidden={!open}
        className="mt-2 max-w-prose rounded-lg border border-line bg-surface-muted p-3 text-fg-muted"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-semibold text-fg">{title}</p>
          <button
            type="button"
            aria-label={t("help.close")}
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
            className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch:size-11"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="mt-1 space-y-1.5">{children}</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {link ? (
            <Link href={link.href} className="font-medium text-accent-strong hover:underline">
              {link.label}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              dismissHelp(sessionStore(), tabIdentity()?.user ?? null, id, version);
              setDismissed(true);
            }}
            className="min-h-8 font-medium text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent touch:min-h-11"
          >
            {t("help.hideTip")}
          </button>
        </div>
      </div>
    </div>
  );
}
