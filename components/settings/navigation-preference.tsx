"use client";

import { useId } from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useSidebar } from "@/components/layout/sidebar-provider";
import { Switch } from "@/components/ui/switch";

/**
 * Navigation width preference (design spec §14, §88).
 *
 * A real setting, not a placeholder: it drives the same cookie-backed state as
 * the collapse control in the sidebar itself, so changing it here takes effect
 * immediately and survives navigation and sign-out.
 */
export function NavigationPreference() {
  const { state, toggle } = useSidebar();
  const id = useId();
  const t = useTranslations("settings");
  const collapsed = state === "collapsed";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-card font-semibold text-fg">
          {t("appearance.collapsedNavigation")}
        </label>
        <p className="mt-1 text-table text-fg-muted">{t("appearance.collapsedNavigationHint")}</p>
      </div>
      <Switch
        id={id}
        checked={collapsed}
        onCheckedChange={toggle}
        aria-label={t("appearance.collapsedNavigation")}
      />
    </div>
  );
}
