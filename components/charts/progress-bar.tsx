import { TONE_COLOR, type ChartTone } from "@/components/charts/palette";
import { cn } from "@/lib/utils/cn";

/** Progress bar (design spec §71). The most common chart in the product, by design. */
export function ProgressBar({
  value,
  tone = "default",
  label,
  className,
}: {
  value: number;
  tone?: ChartTone;
  label: string;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hover", className)}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${clamped}%`, backgroundColor: TONE_COLOR[tone] }}
      />
    </div>
  );
}
