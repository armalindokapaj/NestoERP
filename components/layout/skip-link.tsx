"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * Skip to main content (AUD-11 §3, AV-02).
 *
 * The first focusable element of every authenticated page. Invisible until it
 * has keyboard focus, then drawn above the top bar. Activating it moves focus
 * into `#nesto-main` (focusable by script, tabIndex -1) without adding a hash
 * to the URL, so the next Tab continues inside the page's own content.
 */
export function SkipLink() {
  const t = useTranslations("shell");

  return (
    <a
      href="#nesto-main"
      data-testid="skip-link"
      onClick={(event) => {
        const main = document.getElementById("nesto-main");
        if (!main) return;
        event.preventDefault();
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: "start" });
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2.5 focus:text-body focus:font-medium focus:text-fg focus:shadow-dialog"
    >
      {t("skipToMain")}
    </a>
  );
}
