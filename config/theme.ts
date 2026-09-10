/**
 * NESTO theme tokens (design spec §85, §86).
 *
 * The authoritative values live in styles/tokens.css — this is the typed view
 * of them for code that cannot read CSS: breakpoint maths, charts that need a
 * literal colour, and the responsive verification script.
 *
 * Colours resolve through CSS custom properties on purpose, so a single token
 * edit repaints the product in both colour schemes rather than only one — the
 * light and dark values are declared together with light-dark() in tokens.css,
 * and nothing in TypeScript needs to know which one is showing.
 */

const color = (token: string) => `var(--nesto-${token})`;

export const theme = {
  colors: {
    white: color("white"),
    canvas: color("canvas"),
    surface: color("surface"),
    surfaceMuted: color("surface-muted"),
    sidebar: color("sidebar"),
    rowHover: color("row-hover"),

    fg: color("fg"),
    fgMuted: color("fg-muted"),
    fgSubtle: color("fg-subtle"),

    border: color("border"),
    borderStrong: color("border-strong"),

    primary: color("primary"),
    accent: color("accent"),
    accentSoft: color("accent-soft"),
    graphite: color("graphite"),

    success: color("success"),
    warning: color("warning"),
    danger: color("danger"),
    info: color("info"),
  },

  /** 8px base scale (§8). */
  spacing: [4, 8, 12, 16, 24, 32, 40, 48, 64] as const,

  /** §9 — moderate corners, never fully rounded surfaces. */
  radius: {
    button: 8,
    input: 8,
    smallCard: 10,
    dashboardCard: 12,
    dialog: 14,
    featureCard: 16,
  },

  /** §7 — the full type scale in px, mirroring the --text-* steps. */
  typography: {
    /** Public hero only. */
    hero: 56,
    display: 36,
    pageTitle: 28,
    sectionTitle: 20,
    cardTitle: 16,
    body: 14,
    table: 13,
    metadata: 12,
    /** The floor: §7 puts nothing below 11px. */
    micro: 11,
  },

  /** §10 — three elevation steps, nothing heavier. */
  shadows: {
    card: color("shadow-card"),
    menu: color("shadow-menu"),
    dialog: color("shadow-dialog"),
  },

  /** §35 — the breakpoints the layout actually switches on. */
  breakpoints: {
    mobile: 0,
    tablet: 768,
    desktop: 1200,
    largeDesktop: 1440,
    /** Tablet landscape keeps an icon rail rather than the drawer (§43, §44). */
    navRail: 1024,
  },

  /** §52, §53 — premium but restrained. */
  motion: {
    fast: 150,
    base: 180,
    slow: 220,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },

  /** §85 — one ordered stack, so overlays cannot fight each other. */
  zIndex: {
    sidebar: 40,
    topbar: 30,
    drawer: 50,
    dialog: 60,
    toast: 70,
  },
} as const;

export type Theme = typeof theme;
