import { seriesColor } from "@/components/charts/palette";

/**
 * Donut chart (design spec §71).
 *
 * Drawn with stroke-dasharray on a single circle — no chart library, no
 * runtime layout maths. The legend carries the label and the count because §56
 * forbids communicating a value by colour alone; the share is in the accessible
 * name so the figure the eye reads and the figure a screen reader reads agree.
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

  const description = segments
    .map((segment) => `${segment.label} ${segment.value} (${segment.percent}%)`)
    .join(", ");

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0">
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label={`${caption}: ${description}`}
          className="size-28 -rotate-90"
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
        </svg>

        {/* Set in HTML rather than <text> so the centre uses the same type
            scale as everything else on the card. */}
        {centerValue ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          >
            <span className="text-section font-semibold leading-none tabular-nums text-fg">
              {centerValue}
            </span>
            {centerLabel ? (
              <span className="mt-1 text-micro text-fg-subtle">{centerLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2.5 text-table">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            {/* Wraps rather than truncating: the legend is the chart's text alternative (AUD-04 §5, SP-14). */}
            <span className="min-w-0 flex-1 text-fg-muted [overflow-wrap:anywhere]">{segment.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-fg">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
