import { TONE_COLOR, type ChartTone } from "@/components/charts/palette";
import { cn } from "@/lib/utils/cn";

/**
 * Line chart (design spec §71).
 *
 * Small enough to sit inside a KPI card without becoming the point of it —
 * §19 allows at most one visual per KPI card.
 */
export function Sparkline({
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

  const width = 100;
  const height = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point - min) / range) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const color = TONE_COLOR[tone];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      // The values themselves, not only the caption (AUD-04 §5, SP-14).
      aria-label={`${caption}: ${points.join(", ")}`}
      // The line is data: kept in forced colours (AUD-11 AV-15).
      className={cn("forced-color-adjust-none", className)}
    >
      <polyline
        points={`0,${height} ${coords.join(" ")} ${width},${height}`}
        // Styles, not attributes, so the token resolves for the current scheme (AUD-11 §7, AV-14).
        style={{ fill: color }}
        fillOpacity="0.08"
        stroke="none"
      />
      <polyline
        points={coords.join(" ")}
        fill="none"
        style={{ stroke: color }}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
