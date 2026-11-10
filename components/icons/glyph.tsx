import * as React from "react";

/** What every icon accepts: an SVG's own props, a square `size` and the fill `color` (currentColor by default). */
export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "ref" | "children" | "strokeWidth"> & {
  size?: number | string;
  "data-testid"?: string;
};

export type IconComponent = React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>;

/**
 * One icon: an IBM Carbon glyph (docs/ui/UI-03-nesto-theme.md §6), drawn on its
 * 32-unit grid in the current colour. Decorative unless it is given a name
 * (`aria-label`), when it becomes an image.
 */
export function glyph(name: string, markup: string): IconComponent {
  const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon({ size = 24, color, ...rest }, ref) {
    const labelled = Boolean(rest["aria-label"] || rest["aria-labelledby"]);
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        width={size}
        height={size}
        fill={color ?? "currentColor"}
        focusable="false"
        aria-hidden={labelled ? undefined : true}
        role={labelled ? "img" : undefined}
        {...rest}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  });
  Icon.displayName = name;
  return Icon;
}
