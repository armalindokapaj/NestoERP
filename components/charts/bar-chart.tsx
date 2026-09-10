import { TONE_COLOR, type ChartTone } from "@/components/charts/palette";

/**
 * Horizontal bar chart (design spec §71).
 *
 * Rows rather than columns: department and category names stay readable at
 * every width, which a rotated axis label never manages on mobile.
 */
export type BarDatum = { label: string; value: number; display: string; tone?: ChartTone };

export function BarChart({ data, caption }: { data: BarDatum[]; caption: string }) {
  const max = Math.max(...data.map((row) => row.value), 1);

  return (
    <div role="img" aria-label={caption} className="space-y-3">
      {data.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-16 shrink-0 truncate text-meta text-fg-muted">{row.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-hover">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round((row.value / max) * 100)}%`,
                backgroundColor: TONE_COLOR[row.tone ?? "default"],
              }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-meta font-medium tabular-nums text-fg">
            {row.display}
          </span>
        </div>
      ))}
    </div>
  );
}
