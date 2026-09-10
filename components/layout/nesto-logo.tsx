import { cn } from "@/lib/utils/cn";

/**
 * NESTO wordmark (design spec §4).
 *
 * Uppercase, wide letter spacing, refined serif, graphite. No gradients, and
 * no tagline unless a page explicitly asks for one.
 *
 * `tone="inverse"` is for dark grounds such as the authentication brand panel,
 * where the default graphite-on-light treatment would disappear.
 */
export function NestoLogo({
  className,
  wordmarkClassName,
  showWordmark = true,
  tone = "default",
}: {
  className?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
  tone?: "default" | "inverse";
}) {
  const inverse = tone === "inverse";

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md font-serif text-body leading-none",
          inverse
            ? "bg-graphite-fg text-graphite"
            : "bg-graphite text-graphite-fg",
        )}
      >
        N
      </span>
      {showWordmark ? (
        <span
          className={cn(
            "font-serif text-card leading-none tracking-[0.22em]",
            inverse ? "text-graphite-fg" : "text-fg",
            wordmarkClassName,
          )}
        >
          NESTO
        </span>
      ) : null}
    </span>
  );
}
