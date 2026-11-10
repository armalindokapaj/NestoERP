import * as React from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * One icon, drawn twice: Lucide for Theme 1 and IBM's Carbon glyph for Theme 2
 * (docs/ui/UI-03-vertical-look.md §6). styles/look-2.css shows the one that
 * belongs to the look on <html> and hides the other, so a server component and
 * a client component draw the same icon with no flash and no context.
 *
 * Carbon is drawn on a 32-unit grid in the current colour. The Carbon glyph
 * comes first, so Lucide keeps its place as the last child where a row spaces
 * its children (`space-x-*`, `divide-*`) and Theme 1 lays out as it always has.
 *
 * The ref, an `id` and a test id stay on Lucide's element: they name one
 * element, and Theme 1 is the default.
 */
export function dual(Lucide: LucideIcon, glyph: string, name: string): LucideIcon {
  const Icon = React.forwardRef<SVGSVGElement, LucideProps & { "data-testid"?: string }>(function Icon(
    { size = 24, strokeWidth, absoluteStrokeWidth, color, className, id, "data-testid": testId, children, ...rest },
    ref,
  ) {
    const labelled = Boolean(rest["aria-label"] || rest["aria-labelledby"]);
    return (
      <>
        <svg
          data-icon-look="2"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          width={size}
          height={size}
          fill={color ?? "currentColor"}
          focusable="false"
          aria-hidden={labelled ? undefined : true}
          role={labelled ? "img" : undefined}
          className={className}
          {...rest}
          dangerouslySetInnerHTML={{ __html: glyph }}
        />
        <Lucide
          ref={ref}
          data-icon-look="1"
          size={size}
          strokeWidth={strokeWidth}
          absoluteStrokeWidth={absoluteStrokeWidth}
          color={color}
          className={className}
          id={id}
          data-testid={testId}
          {...rest}
        >
          {children}
        </Lucide>
      </>
    );
  });
  Icon.displayName = name;
  return Icon as unknown as LucideIcon;
}
