import { TONE_COLOR, type ChartTone } from "@/components/charts/palette";

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
      aria-label={caption}
      className={className}
    >
      <polyline
        points={`0,${height} ${coords.join(" ")} ${width},${height}`}
        fill={color}
        fillOpacity="0.08"
        stroke="none"
      />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
