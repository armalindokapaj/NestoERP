"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { usePendingQueryChange } from "@/components/navigation/navigation-feedback";
import { cn } from "@/lib/utils/cn";

/**
 * A register's results — its totals, rows and pages — as one region (AUD-01 §9).
 *
 * While a filter, a sort or another page is on its way, the list still on the
 * screen is marked busy and dimmed, so the old answer never passes for the new
 * one; the totals and the rows are replaced together when it arrives.
 */
export function RegisterResults({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const updating = usePendingQueryChange(pathname);
  const t = useTranslations("financeRegister");

  return (
    <div
      aria-busy={updating}
      data-testid="register-results"
      data-updating={updating ? "true" : undefined}
      className={cn("space-y-4 transition-opacity duration-150", updating && "pointer-events-none opacity-60")}
    >
      {updating ? <span className="sr-only">{t("updating")}</span> : null}
      {children}
    </div>
  );
}

/**
 * Puts the address of the list that actually ran into the location bar
 * (AUD-01 §5.1, §5.2): the page reached when a page past the end was asked for,
 * the filters as understood. A replacement, not a new entry, so Back still goes
 * where it went, and no second request is made.
 */
export function CanonicalUrl({ href }: { href: string }) {
  React.useEffect(() => {
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
  }, [href]);
  return null;
}
