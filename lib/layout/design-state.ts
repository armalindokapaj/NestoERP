/**
 * Design-system version, density and page-ruler preferences (UI-02 §6.4, §15,
 * §27.1, §33).
 *
 * Two versions of the design system live side by side while UI-02 rolls out:
 * version 1 is the look the product has today and stays the default; version 2
 * is the UI-02 look, declared in styles/tokens-v2.css under
 * `:root[data-ds="2"]`. Version 1 renders no attribute at all, so a page that
 * is not on version 2 cannot match a single version-2 rule.
 *
 * Cookies, like the colour scheme beside this file (theme-state.ts) and for the
 * same reason: the server renders the attributes in the first byte of HTML, so
 * a page never paints one density and then jumps to the other.
 *
 * Pure on purpose — no `next/headers`, no `process.env` — so the client
 * controls, the server reader (design-server.ts) and the tests share one rule.
 */

/* ---- Version (§33) ---------------------------------------------------- */

export const DESIGN_COOKIE = "nesto.ds";

export const DESIGN_VERSIONS = ["1", "2"] as const;

export type DesignVersion = (typeof DESIGN_VERSIONS)[number];

export function isDesignVersion(value: string | undefined): value is DesignVersion {
  return DESIGN_VERSIONS.includes(value as DesignVersion);
}

export type DesignSystem = {
  version: DesignVersion;
  /** Whether this person may change version: a developer's convenience, never a product setting. */
  switchable: boolean;
};

/**
 * Which version a request is rendered in. The release flag NESTO_DESIGN_SYSTEM
 * decides, fail-closed, so unsetting it is the rollback (§33.3):
 *
 * - flag unset, or anything but "1" or "2": version 1, always, and no switch —
 *   whatever cookie the browser sends;
 * - flag "1" or "2": that is the default, and where development conveniences
 *   exist (lib/auth/dev-mode.ts) the cookie may override it.
 */
export function resolveDesignSystem(input: {
  flag: string | undefined;
  devMode: boolean;
  cookie: string | undefined;
}): DesignSystem {
  const flag = input.flag?.trim();
  if (!isDesignVersion(flag)) return { version: "1", switchable: false };
  if (!input.devMode) return { version: flag, switchable: false };
  return { version: isDesignVersion(input.cookie) ? input.cookie : flag, switchable: true };
}

/** The value for `data-ds` on <html>. Version 1 deliberately renders nothing. */
export function designAttribute(version: DesignVersion): "2" | undefined {
  return version === "2" ? "2" : undefined;
}

/* ---- Density (§6.4) --------------------------------------------------- */

export const DENSITY_COOKIE = "nesto.density";

/** Touch sizing is not a choice: a coarse pointer gets it whatever is stored here. */
export const DENSITY_CHOICES = ["comfortable", "compact"] as const;

export type DensityChoice = (typeof DENSITY_CHOICES)[number];

export function isDensityChoice(value: string | undefined): value is DensityChoice {
  return DENSITY_CHOICES.includes(value as DensityChoice);
}

export function readDensityChoice(value: string | undefined): DensityChoice {
  return isDensityChoice(value) ? value : "comfortable";
}

/**
 * The value for `data-density` on <html>. "comfortable" is the absence of the
 * attribute, and version 1 has one density, so it never carries it.
 */
export function densityAttribute(choice: DensityChoice, version: DesignVersion): "compact" | undefined {
  return version === "2" && choice === "compact" ? "compact" : undefined;
}

/* ---- Page ruler (§15, §33.3) ------------------------------------------ */

export const RULER_COOKIE = "nesto.ruler";

export const RULER_CHOICES = ["auto", "off"] as const;

export type RulerChoice = (typeof RULER_CHOICES)[number];

export function isRulerChoice(value: string | undefined): value is RulerChoice {
  return RULER_CHOICES.includes(value as RulerChoice);
}

export function readRulerChoice(value: string | undefined): RulerChoice {
  return isRulerChoice(value) ? value : "auto";
}

/** NESTO_UI_RULER=off: the kill switch that disables the ruler for everyone without reverting the rest. */
export function isRulerDisabled(flag: string | undefined): boolean {
  return flag?.trim().toLowerCase() === "off";
}

/**
 * The value for `data-ruler` on <html>: "off" for a person who turned it off
 * and for everyone under the kill switch, nothing otherwise. Only version 2
 * draws a ruler, so — like the density — version 1 never carries the
 * attribute, whatever cookie the browser kept.
 */
export function rulerAttribute(choice: RulerChoice, disabled: boolean, version: DesignVersion): "off" | undefined {
  return version === "2" && (disabled || choice === "off") ? "off" : undefined;
}

/* ---- What the appearance controls may offer --------------------------- */

/**
 * Decided on the server and handed to the client controls as a prop: client
 * code cannot read the environment, and must not guess at it.
 */
export type AppearanceOptions = {
  /** The Classic / New choice: only where the version is switchable. */
  designSwitch: boolean;
  /** The Auto / Off choice: withheld while the kill switch is on, when it would change nothing. */
  ruler: boolean;
};
