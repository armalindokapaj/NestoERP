import type { Paint, PairKind } from "@/lib/a11y/contrast";

/**
 * Every foreground/background pair the shared primitives actually paint
 * (AUD-11 §6, AV-10), with the threshold it must meet. Measured in both
 * schemes by tests/unit/a11y/contrast.test.ts; printed in docs/a11y/contrast.md.
 *
 * `text` pairs are normal-size text (4.5:1). `ui` pairs are control
 * boundaries, focus rings, state indicators and information-bearing graphics
 * (3:1). Disabled controls (opacity 50–60%) and decorative dividers
 * (`border`, `border-strong`) are deliberately absent: see the document.
 */
export type ContrastPair = {
  id: string;
  fg: Paint;
  bg: Paint;
  kind: PairKind;
  /** Where the pair is painted. */
  where: string;
};

const t = (token: string): Paint => ({ token });

/**
 * The grounds text and controls sit on. `accent-soft` is the selected surface
 * and `pressed` the ground of a control while it is pressed (UI-02 §6.1, §6.5):
 * in version 1 that is the hover ground, in version 2 a step of its own.
 */
export const GROUNDS = ["canvas", "surface", "surface-muted", "sidebar", "row-hover", "hover", "pressed", "accent-soft"] as const;

const textOnGrounds = (token: string, where: string, grounds: readonly string[] = GROUNDS): ContrastPair[] =>
  grounds.map((ground) => ({ id: `${token} on ${ground}`, fg: t(token), bg: t(ground), kind: "text", where }));

const uiOnGrounds = (token: string, where: string, grounds: readonly string[] = GROUNDS): ContrastPair[] =>
  grounds.map((ground) => ({ id: `${token} vs ${ground}`, fg: t(token), bg: t(ground), kind: "ui", where }));

export const CONTRAST_PAIRS: ContrastPair[] = [
  // ---- Text on every ground ----------------------------------------------
  ...textOnGrounds("fg", "body text, titles, labels"),
  ...textOnGrounds("fg-muted", "secondary text, ghost buttons, badge default, inactive nav"),
  ...textOnGrounds("fg-subtle", "metadata, placeholders, group labels, icons"),
  // The gold foreground of UI-02 §6.1: canvas, surface, hover, pressed and selected among them.
  ...textOnGrounds("accent-strong", "links, active nav, selected segmented option"),

  // ---- Status text (StatusBadge, Badge, inline figures) -------------------
  ...(["success", "warning", "danger", "info"] as const).flatMap((status): ContrastPair[] => [
    { id: `${status}-strong on ${status}-soft`, fg: t(`${status}-strong`), bg: t(`${status}-soft`), kind: "text", where: "StatusBadge / Badge tone" },
    { id: `${status}-strong on surface`, fg: t(`${status}-strong`), bg: t("surface"), kind: "text", where: "status figures, error text" },
    { id: `${status}-strong on canvas`, fg: t(`${status}-strong`), bg: t("canvas"), kind: "text", where: "status text on the page ground" },
    // UI-02 §6.5: a status figure in a row that is hovered, pressed or selected.
    { id: `${status}-strong on hover`, fg: t(`${status}-strong`), bg: t("hover"), kind: "text", where: "status text in a hovered row" },
    { id: `${status}-strong on pressed`, fg: t(`${status}-strong`), bg: t("pressed"), kind: "text", where: "status text in a pressed row" },
    { id: `${status}-strong on accent-soft`, fg: t(`${status}-strong`), bg: t("accent-soft"), kind: "text", where: "status text in a selected row" },
  ]),
  { id: "fg-muted on surface-muted (badge default)", fg: t("fg-muted"), bg: t("surface-muted"), kind: "text", where: "StatusBadge / Badge default" },
  { id: "fg on hover (badge neutral)", fg: t("fg"), bg: t("hover"), kind: "text", where: "StatusBadge / Badge neutral, subtle button" },

  // ---- Solid fills carrying text -------------------------------------------
  { id: "primary-fg on primary", fg: t("primary-fg"), bg: t("primary"), kind: "text", where: "primary button, checked checkbox" },
  { id: "primary-fg on primary-hover", fg: t("primary-fg"), bg: t("primary-hover"), kind: "text", where: "primary button hover" },
  // UI-02 §10.1: a filled button keeps its text readable through hover and pressed.
  { id: "primary-fg on primary-pressed", fg: t("primary-fg"), bg: t("primary-pressed"), kind: "text", where: "primary button pressed" },
  { id: "accent-fg on accent", fg: t("accent-fg"), bg: t("accent"), kind: "text", where: "accent button, activity count" },
  { id: "danger-fg on danger", fg: t("danger-fg"), bg: t("danger"), kind: "text", where: "danger button, critical count" },
  { id: "danger-fg on danger-hover", fg: t("danger-fg"), bg: t("danger-hover"), kind: "text", where: "danger button hover" },
  { id: "danger-fg on danger-pressed", fg: t("danger-fg"), bg: t("danger-pressed"), kind: "text", where: "danger button pressed" },
  { id: "graphite-fg on graphite", fg: t("graphite-fg"), bg: t("graphite"), kind: "text", where: "tooltip, brand panel" },
  { id: "hero-fg on hero", fg: t("hero-fg"), bg: t("hero"), kind: "text", where: "phone My Day card text" },
  { id: "hero-accent on hero", fg: t("hero-accent"), bg: t("hero"), kind: "text", where: "phone My Day card eyebrow and arrow ground" },
  { id: "ring vs hero", fg: t("ring"), bg: t("hero"), kind: "ui", where: "focus ring on the phone My Day card" },
  {
    id: "fg-subtle on bar (surface/85 over canvas)",
    fg: t("fg-subtle"),
    bg: { token: "surface", alpha: 0.85, over: "canvas" },
    kind: "text",
    where: "floating bottom bar idle tabs",
  },
  {
    id: "fg-muted on topbar (surface/85 over canvas)",
    fg: t("fg-muted"),
    bg: { token: "surface", alpha: 0.85, over: "canvas" },
    kind: "text",
    where: "top bar controls over the translucent bar",
  },

  // ---- Control boundaries --------------------------------------------------
  ...uiOnGrounds("control-border", "input, textarea, select, search, checkbox, switch off track", ["canvas", "surface", "surface-muted", "row-hover", "sidebar"]),
  // UI-02 §10.1: a secondary button's boundary is the control border, on its hover and pressed grounds too.
  ...uiOnGrounds("control-border", "secondary button boundary while hovered and pressed", ["hover", "pressed"]),
  // UI-02 §12.4: a selected table row is the selection tint, and its checkbox stands on it.
  ...uiOnGrounds("control-border", "checkbox in a selected table row", ["accent-soft"]),
  { id: "surface thumb vs control-border track", fg: t("surface"), bg: t("control-border"), kind: "ui", where: "switch off: thumb against track" },
  { id: "surface thumb vs accent track", fg: t("surface"), bg: t("accent"), kind: "ui", where: "switch on: thumb against track" },
  { id: "accent (focused input border) vs surface", fg: t("accent"), bg: t("surface"), kind: "ui", where: "focused control border" },
  { id: "danger (invalid border) vs surface", fg: t("danger"), bg: t("surface"), kind: "ui", where: "invalid control border and ring" },

  // ---- Focus ring against every adjacent ground ----------------------------
  ...uiOnGrounds("ring", "2px :focus-visible outline / ring-2 ring-ring"),

  // ---- State indicators -----------------------------------------------------
  { id: "accent (tab underline) vs surface", fg: t("accent"), bg: t("surface"), kind: "ui", where: "active tab underline" },
  { id: "accent (tab underline) vs canvas", fg: t("accent"), bg: t("canvas"), kind: "ui", where: "active tab underline on the page" },
  { id: "accent (nav marker) vs accent-soft", fg: t("accent"), bg: t("accent-soft"), kind: "ui", where: "active navigation marker and icon" },
  { id: "primary (checked box) vs surface", fg: t("primary"), bg: t("surface"), kind: "ui", where: "checked checkbox" },

  // ---- Information-bearing graphics ----------------------------------------
  ...(["accent", "success", "warning", "danger", "info", "fg-subtle"] as const).flatMap((series): ContrastPair[] => [
    { id: `${series} (series) vs surface`, fg: t(series), bg: t("surface"), kind: "ui", where: "chart series, status dot, progress fill" },
    { id: `${series} (fill) vs hover track`, fg: t(series), bg: t("hover"), kind: "ui", where: "progress and bar-chart fill against its track" },
  ]),
  ...[
    "task", "meeting", "project", "milestone", "hr", "finance", "legal",
    "procurement", "qaqc", "hse", "document", "engineering", "company", "personal",
  ].map((category): ContrastPair => ({
    id: `cal-${category} vs surface`,
    fg: t(`cal-${category}`),
    bg: t("surface"),
    kind: "ui",
    where: "calendar category rail and dot",
  })),
];
