/**
 * Responsive visibility and input presets (MOB-01 §18, §43).
 *
 * Class strings live here so Tailwind's scanner sees them and so a module never
 * spells its own breakpoint. Visibility is for chrome, never for functionality:
 * do not build two implementations of one workflow and hide one (MOB-01 §64).
 * Anything the phone cannot fit reflows, collapses or moves into a menu or sheet.
 */
export const showOn = {
  /** Phone only: below md (768). */
  phone: "md:hidden",
  /** Tablet and up. */
  tabletUp: "max-md:hidden",
  /** Desktop only: lg (1024) and up. */
  desktop: "max-lg:hidden",
  /** Hidden on a phone, shown from sm (640). */
  smUp: "max-sm:hidden",
} as const;

export type ShowOn = keyof typeof showOn;

/**
 * Keyboard and autofill hints for the shared input (MOB-01 §18, §27). Spread
 * into `<Input {...inputModes.email} />`. The phone keyboard then matches the
 * field, and the 16px font rule in globals.css keeps iOS from zooming on focus.
 */
export const inputModes = {
  text: { inputMode: "text", autoCapitalize: "sentences" },
  email: { type: "email", inputMode: "email", autoCapitalize: "none", autoCorrect: "off", spellCheck: false },
  phone: { type: "tel", inputMode: "tel", autoComplete: "tel" },
  url: { type: "url", inputMode: "url", autoCapitalize: "none", autoCorrect: "off", spellCheck: false },
  /** Whole numbers, no decimal key. */
  integer: { inputMode: "numeric", pattern: "[0-9]*" },
  /** Amounts and quantities: digits with a decimal key. */
  decimal: { inputMode: "decimal" },
  search: { type: "search", inputMode: "search", enterKeyHint: "search", autoCapitalize: "none", autoCorrect: "off" },
  password: { type: "password", autoCapitalize: "none", autoCorrect: "off" },
} as const;

export type InputModeName = keyof typeof inputModes;
