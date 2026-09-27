import { TONE_COLOR, type ChartTone } from "@/components/charts/palette";

/**
 * Horizontal bar chart (design spec §71).
 *
 * Rows rather than columns: department and category names stay readable at
 * every width, which a rotated axis label never manages on mobile.
 *
 * It is a captioned list, not an image (AUD-04 §5, SP-14, MW-17): each row's
 * label and exact value are text a screen reader reads and a finger or the
 * keyboard never needs to hover for; only the bar itself is decoration. Long
 * labels wrap onto a second line instead of being cut off.
 */
export type BarDatum = { label: string; value: number; display: string; tone?: ChartTone };

export function BarChart({ data, caption }: { data: BarDatum[]; caption: string }) {
  const max = Math.max(...data.map((row) => row.value), 1);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className="space-y-3">
      {data.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-meta leading-tight text-fg-muted [overflow-wrap:anywhere]">{row.label}</span>
          <div aria-hidden="true" className="h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-hover">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round((row.value / max) * 100)}%`,
                backgroundColor: TONE_COLOR[row.tone ?? "default"],
              }}
            />
          </div>
          <span className="shrink-0 text-right text-meta font-medium tabular-nums text-fg">
            {row.display}
          </span>
        </li>
      ))}
      </ul>
    </figure>
  );
}
