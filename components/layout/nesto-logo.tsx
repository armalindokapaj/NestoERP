import { brand } from "@/config/brand";
import { cn } from "@/lib/utils/cn";

/**
 * NESTO wordmark (design spec §4).
 *
 * Uppercase, wide letter spacing, refined serif. The mark is a gold-outlined serif N. No gradients.
 *
 * Three assemblies cover every placement: mark plus wordmark (compact headers),
 * wordmark plus tagline (the navigation drawer), and the wordmark or the mark on
 * its own (the desktop sidebar and its 72px rail, where a second line would
 * overrun the width). `tone="inverse"` is for dark grounds such as the
 * authentication brand panel, where graphite-on-light would disappear.
 */
const wordmarkSizes = {
  sm: "text-body tracking-[0.2em]",
  md: "text-card tracking-[0.22em]",
  lg: "text-section tracking-[0.3em]",
} as const;

const markSizes = {
  sm: "size-7 text-[16px]",
  md: "size-8 text-[18px]",
  lg: "size-[38px] text-[24px]",
} as const;

export function NestoLogo({
  className,
  wordmarkClassName,
  showWordmark = true,
  showMark = true,
  size = "md",
  tagline,
  tone = "default",
}: {
  className?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
  showMark?: boolean;
  size?: keyof typeof wordmarkSizes;
  /** `true` uses the standard tagline; a string overrides it. */
  tagline?: boolean | string;
  tone?: "default" | "inverse";
}) {
  const inverse = tone === "inverse";
  const taglineText = tagline === true ? brand.tagline : tagline || null;

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {showMark ? (
        <span
          aria-hidden="true"
          className={cn(
            "grid shrink-0 place-items-center rounded-[10px] border border-accent bg-transparent font-serif font-normal leading-none text-accent-strong",
            markSizes[size],
          )}
        >
          N
        </span>
      ) : null}

      {showWordmark ? (
        <span className="inline-flex min-w-0 flex-col gap-1">
          <span
            className={cn(
              "font-serif leading-none",
              wordmarkSizes[size],
              inverse ? "text-graphite-fg" : "text-fg",
              wordmarkClassName,
            )}
          >
            {brand.name}
          </span>
          {taglineText ? (
            <span
              className={cn(
                "nesto-eyebrow truncate",
                inverse ? "text-graphite-fg/60" : "text-fg-subtle",
              )}
            >
              {taglineText}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
