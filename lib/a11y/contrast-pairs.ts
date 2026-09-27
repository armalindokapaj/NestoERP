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

/** The grounds text and controls sit on. */
export const GROUNDS = ["canvas", "surface", "surface-muted", "sidebar", "row-hover", "hover", "accent-soft"] as const;

const textOnGrounds = (token: string, where: string, grounds: readonly string[] = GROUNDS): ContrastPair[] =>
  grounds.map((ground) => ({ id: `${token} on ${ground}`, fg: t(token), bg: t(ground), kind: "text", where }));

const uiOnGrounds = (token: string, where: string, grounds: readonly string[] = GROUNDS): ContrastPair[] =>
  grounds.map((ground) => ({ id: `${token} vs ${ground}`, fg: t(token), bg: t(ground), kind: "ui", where }));

export const CONTRAST_PAIRS: ContrastPair[] = [
  // ---- Text on every ground ----------------------------------------------
  ...textOnGrounds("fg", "body text, titles, labels"),
  ...textOnGrounds("fg-muted", "secondary text, ghost buttons, badge default, inactive nav"),
  ...textOnGrounds("fg-subtle", "metadata, placeholders, group labels, icons"),
  ...textOnGrounds("accent-strong", "links, active nav, selected segmented option"),

  // ---- Status text (StatusBadge, Badge, inline figures) -------------------
  ...(["success", "warning", "danger", "info"] as const).flatMap((status): ContrastPair[] => [
    { id: `${status}-strong on ${status}-soft`, fg: t(`${status}-strong`), bg: t(`${status}-soft`), kind: "text", where: "StatusBadge / Badge tone" },
    { id: `${status}-strong on surface`, fg: t(`${status}-strong`), bg: t("surface"), kind: "text", where: "status figures, error text" },
    { id: `${status}-strong on canvas`, fg: t(`${status}-strong`), bg: t("canvas"), kind: "text", where: "status text on the page ground" },
  ]),
  { id: "fg-muted on surface-muted (badge default)", fg: t("fg-muted"), bg: t("surface-muted"), kind: "text", where: "StatusBadge / Badge default" },
  { id: "fg on hover (badge neutral)", fg: t("fg"), bg: t("hover"), kind: "text", where: "StatusBadge / Badge neutral, subtle button" },

  // ---- Solid fills carrying text -------------------------------------------
  { id: "primary-fg on primary", fg: t("primary-fg"), bg: t("primary"), kind: "text", where: "primary button, checked checkbox" },
  { id: "primary-fg on primary-hover", fg: t("primary-fg"), bg: t("primary-hover"), kind: "text", where: "primary button hover" },
  { id: "accent-fg on accent", fg: t("accent-fg"), bg: t("accent"), kind: "text", where: "accent button, activity count" },
  { id: "danger-fg on danger", fg: t("danger-fg"), bg: t("danger"), kind: "text", where: "danger button, critical count" },
  { id: "graphite-fg on graphite", fg: t("graphite-fg"), bg: t("graphite"), kind: "text", where: "tooltip, brand panel" },
  {
    id: "fg-muted on topbar (surface/85 over canvas)",
    fg: t("fg-muted"),
    bg: { token: "surface", alpha: 0.85, over: "canvas" },
    kind: "text",
    where: "top bar controls over the translucent bar",
  },

  // ---- Control boundaries --------------------------------------------------
  ...uiOnGrounds("control-border", "input, textarea, select, search, checkbox, switch off track", ["canvas", "surface", "surface-muted", "row-hover", "sidebar"]),
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
