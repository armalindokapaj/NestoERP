"use client";

import * as React from "react";
import { Menu } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { OPEN_MORE_EVENT } from "@/components/layout/mobile-bottom-nav";
import { usePhone } from "@/components/layout/use-phone";
import { emitNavigationEvent } from "@/lib/navigation/analytics";

/**
 * The phone's hamburger, fixed at the top right of the top bar. It opens the
 * same More sheet the bottom bar used to open, by the same event pattern as
 * Create, so the sheet, its search and its focus handling stay in one place.
 * From tablet up the bar keeps its own More button, so this is phone only.
 */
export function MobileMenuButton() {
  const t = useTranslations("shell");
  const phone = usePhone();
  if (phone === false) return null;
  return (
    <button
      type="button"
      aria-label={t("mobile.more")}
      aria-haspopup="dialog"
      data-testid="mobile-more"
      onClick={(event) => {
        emitNavigationEvent("more_opened");
        window.dispatchEvent(new CustomEvent(OPEN_MORE_EVENT, { detail: { opener: event.currentTarget } }));
      }}
      className="grid size-11 shrink-0 place-items-center rounded-full text-fg transition-colors hover:bg-hover active:bg-hover md:hidden"
    >
      <Menu aria-hidden="true" className="size-[22px]" strokeWidth={1.6} />
    </button>
  );
}
