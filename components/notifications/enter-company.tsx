"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { requestWorkspaceSwitch } from "@/lib/workspace/client";

/**
 * Enters a company's workspace and goes on (Workspace Context §31, §74).
 *
 * A notification's record is a company page, and the Group workspace has none
 * to show it in. Following a notification from there is the same rule as
 * opening a record from a group list: ask the server (which checks the person's
 * own membership), and only then go on. It is the page's fallback when the link
 * was followed directly; the lists hand the person to it, so the answer to
 * "which company?" is never guessed. If the switch fails the person can retry
 * or go back — nothing was opened.
 */
export function EnterCompany({ companyId, companyName, href, backHref, backLabel }: { companyId: string; companyName: string; href: string; backHref: string; backLabel: string }) {
  const t = useTranslations("workspace");
  const [attempt, setAttempt] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void requestWorkspaceSwitch({ scopeType: "COMPANY", companyId }).then((result) => {
      if (cancelled) return;
      if (result.ok) window.location.assign(href);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, href, attempt]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <section className="nesto-card p-8 text-center" data-testid="notification-entering-company" aria-live="polite">
        {failed ? (
          <>
            <p className="text-body text-fg-muted">{t("switchFailed", { name: companyName })}</p>
            <button type="button" onClick={() => setAttempt((count) => count + 1)} className="mt-4 inline-flex text-table font-medium text-accent-strong hover:underline">
              {t("openInCompany", { company: companyName })}
            </button>
            <div>
              <Link href={backHref} className="mt-3 inline-flex text-table font-medium text-accent-strong hover:underline">
                {backLabel}
              </Link>
            </div>
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-body text-fg-muted">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {t("switching", { name: companyName })}
          </p>
        )}
      </section>
    </div>
  );
}
