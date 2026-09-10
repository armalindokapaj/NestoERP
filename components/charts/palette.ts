/**
 * Chart palette (design spec §71).
 *
 * Five colours, hard stop. Charts are secondary in NESTO — a rainbow palette
 * would make them the loudest thing on a dashboard, which §71 rules out.
 */
export const CHART_COLORS = [
  "var(--nesto-accent)",
  "var(--nesto-success)",
  "var(--nesto-warning)",
  "var(--nesto-danger)",
  "var(--nesto-fg-subtle)",
] as const;

export type ChartTone = "default" | "success" | "warning" | "danger" | "info";

export const TONE_COLOR: Record<ChartTone, string> = {
  default: "var(--nesto-accent)",
  success: "var(--nesto-success)",
  warning: "var(--nesto-warning)",
  danger: "var(--nesto-danger)",
  info: "var(--nesto-info)",
};

export function seriesColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
