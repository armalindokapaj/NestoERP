import { seriesColor } from "@/components/charts/palette";

/**
 * Donut chart (design spec §71).
 *
 * Drawn with stroke-dasharray on a single circle — no chart library, no
 * runtime layout maths. The legend carries the labels because §56 forbids
 * communicating a value by colour alone.
 */
export type DonutSlice = { label: string; value: number };

export function Donut({
  slices,
  caption,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  caption: string;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = slices.map((slice, index) => {
    const fraction = total > 0 ? slice.value / total : 0;
    const segment = {
      ...slice,
      color: seriesColor(index),
      dash: fraction * circumference,
      offset,
      percent: Math.round(fraction * 100),
    };
    offset += segment.dash;
    return segment;
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={caption}
        className="size-28 shrink-0 -rotate-90"
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--nesto-hover)"
          strokeWidth="12"
        />
        {segments.map((segment) => (
          <circle
            key={segment.label}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="12"
            strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
            strokeDashoffset={-segment.offset}
          />
        ))}
        {centerValue ? (
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            transform="rotate(90 50 50)"
            className="fill-[var(--nesto-fg)] text-section font-semibold"
          >
            {centerValue}
          </text>
        ) : null}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2 text-table">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="min-w-0 flex-1 truncate text-fg-muted">{segment.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-fg">{segment.percent}%</span>
          </li>
        ))}
      </ul>
      {centerLabel ? <span className="sr-only">{centerLabel}</span> : null}
    </div>
  );
}
