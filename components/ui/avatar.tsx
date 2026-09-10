import * as React from "react";

import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/format";

const sizes = {
  sm: "size-7 text-micro",
  md: "size-9 text-meta",
  lg: "size-12 text-table",
  xl: "size-16 text-section",
};

export type AvatarProps = {
  firstName?: string | null;
  lastName?: string | null;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
};

/**
 * Initials avatar. Image support is wired for when file storage arrives; until
 * then every account renders as calm neutral initials.
 */
export function Avatar({ firstName, lastName, src, size = "md", className }: AvatarProps) {
  const label = initials(firstName, lastName);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        "border border-line bg-hover font-semibold text-fg-muted uppercase",
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        label
      )}
    </span>
  );
}
