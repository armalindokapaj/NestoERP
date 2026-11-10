"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { applyLook, ChoiceGroup } from "@/components/settings/display-preferences";
import { ThemePreference } from "@/components/settings/theme-preference";
import { LOOKS, type Look } from "@/lib/layout/look-state";
import type { ThemeChoice } from "@/lib/layout/theme-state";

/**
 * The catalog's switches: colour scheme and theme. The same controls and the
 * same cookies as Settings › Appearance (components/settings), so what is
 * chosen here is what every other page then shows.
 */
export function CatalogToolbar({ theme, look: initialLook }: { theme: ThemeChoice; look: Look }) {
  const t = useTranslations("settings");
  const [look, setLook] = React.useState(initialLook);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-testid="catalog-toolbar">
      <ThemePreference initial={theme} />
      <ChoiceGroup
        label={t("appearance.look")}
        value={look}
        options={LOOKS.map((value) => ({ value, label: t(`appearance.looks.${value}`) }))}
        onChange={(next) => {
          setLook(next);
          applyLook(next);
        }}
        testId="catalog-look"
      />
    </div>
  );
}
