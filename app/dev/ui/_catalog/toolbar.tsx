"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { applyDensityChoice, applyDesignVersion, ChoiceGroup } from "@/components/settings/display-preferences";
import { ThemePreference } from "@/components/settings/theme-preference";
import { DENSITY_CHOICES, DESIGN_VERSIONS, type DensityChoice, type DesignVersion } from "@/lib/layout/design-state";
import type { ThemeChoice } from "@/lib/layout/theme-state";

/**
 * The catalog's switches: colour scheme, density and — where the server offers
 * it — the design version. The same controls and the same cookies as Settings
 * › Appearance (components/settings), so what is chosen here is what every
 * other page then shows.
 */
export function CatalogToolbar({
  theme,
  density: initialDensity,
  version: initialVersion,
  switchable,
}: {
  theme: ThemeChoice;
  density: DensityChoice;
  version: DesignVersion;
  switchable: boolean;
}) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [density, setDensity] = React.useState(initialDensity);
  const [version, setVersion] = React.useState(initialVersion);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-testid="catalog-toolbar">
      <ThemePreference initial={theme} />
      {/* Density belongs to version 2 (UI-02 §6.4): in version 1 there is nothing for it to change. */}
      {version === "2" ? (
        <ChoiceGroup
          label={t("appearance.density")}
          value={density}
          options={DENSITY_CHOICES.map((value) => ({ value, label: t(`appearance.densities.${value}`) }))}
          onChange={(next) => {
            setDensity(next);
            applyDensityChoice(next);
          }}
          testId="catalog-density"
        />
      ) : null}
      {switchable ? (
        <ChoiceGroup
          label={t("appearance.design")}
          value={version}
          options={DESIGN_VERSIONS.map((value) => ({ value, label: t(`appearance.designs.${value}`) }))}
          onChange={(next) => {
            setVersion(next);
            // The server decides what a version shows, so the page is asked for again.
            if (applyDesignVersion(next)) router.refresh();
          }}
          testId="catalog-design"
        />
      ) : null}
    </div>
  );
}
