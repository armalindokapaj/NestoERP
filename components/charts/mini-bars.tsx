import { TONE_COLOR, type ChartTone } from "@/components/charts/palette";
import { cn } from "@/lib/utils/cn";

/**
 * Micro bar chart (design spec §71).
 *
 * The counterpart to Sparkline for KPI cards whose series is a set of discrete
 * periods rather than a continuous line. Earlier bars fade back so the current
 * period reads first without needing a second colour.
 */
export function MiniBars({
  points,
  caption,
  tone = "default",
  className,
}: {
  points: number[];
  caption: string;
  tone?: ChartTone;
  className?: string;
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points) || 1;
  const color = TONE_COLOR[tone];

  return (
    <span
      role="img"
      aria-label={caption}
      className={cn("flex items-end gap-[3px]", className)}
    >
      {points.map((point, index) => (
        <span
          key={index}
          className="w-1 shrink-0 rounded-[1px]"
          style={{
            /* A floor keeps a near-zero period visible as a period. */
            height: `${Math.max(14, (point / max) * 100)}%`,
            backgroundColor: color,
            opacity: 0.35 + (index / (points.length - 1)) * 0.65,
          }}
        />
      ))}
    </span>
  );
}
