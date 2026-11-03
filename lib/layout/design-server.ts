import { cache } from "react";
import { cookies } from "next/headers";

import { isDevMode } from "@/lib/auth/dev-mode";

import {
  DENSITY_COOKIE,
  DESIGN_COOKIE,
  RULER_COOKIE,
  isRulerDisabled,
  readDensityChoice,
  readRulerChoice,
  resolveDesignSystem,
  type AppearanceOptions,
  type DensityChoice,
  type DesignSystem,
  type RulerChoice,
} from "./design-state";

export type DesignState = DesignSystem & {
  density: DensityChoice;
  ruler: RulerChoice;
  /** NESTO_UI_RULER=off (UI-02 §33.3). */
  rulerDisabled: boolean;
  /** What the appearance controls may offer this person. */
  options: AppearanceOptions;
};

/**
 * The design-system version and display preferences of this request, read once
 * (UI-02 §15, §33). The root layout renders them onto <html>; the shells pass
 * `options` down to the account panel, and a page may branch on `version`.
 */
export const getDesignState = cache(async (): Promise<DesignState> => {
  const cookieStore = await cookies();
  const design = resolveDesignSystem({
    flag: process.env.NESTO_DESIGN_SYSTEM,
    devMode: isDevMode,
    cookie: cookieStore.get(DESIGN_COOKIE)?.value,
  });
  const rulerDisabled = isRulerDisabled(process.env.NESTO_UI_RULER);

  return {
    ...design,
    density: readDensityChoice(cookieStore.get(DENSITY_COOKIE)?.value),
    ruler: readRulerChoice(cookieStore.get(RULER_COOKIE)?.value),
    rulerDisabled,
    options: { designSwitch: design.switchable, ruler: !rulerDisabled },
  };
});
