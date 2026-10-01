"use client";

import * as React from "react";

import { organizationInitials } from "@/lib/workspace/branding";
import { cn } from "@/lib/utils/cn";

const sizes = {
  sm: "size-7 rounded-md text-micro",
  md: "size-8 rounded-lg text-meta",
} as const;

/**
 * The tenant's mark (OW §12, §51): its logo, or its initials when there is no
 * logo or the image does not load — never a broken image. Decorative: the
 * organization's name is always said next to it or by the control around it.
 */
export function OrganizationMark({
  name,
  logoUrl,
  size = "md",
  className,
}: {
  name: string;
  logoUrl: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const [failed, setFailed] = React.useState<string | null>(null);
  const image = React.useRef<HTMLImageElement>(null);
  const showLogo = Boolean(logoUrl) && failed !== logoUrl;

  // An image that failed before hydration fired its error with nobody listening.
  React.useEffect(() => {
    const element = image.current;
    if (element?.complete && element.naturalWidth === 0) setFailed(logoUrl);
  }, [logoUrl]);

  return (
    <span
      aria-hidden="true"
      data-testid="organization-mark"
      data-mark={showLogo ? "logo" : "initials"}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden leading-none",
        showLogo ? "bg-surface font-semibold ring-1 ring-line" : "border border-accent bg-transparent font-serif font-normal text-accent-strong",
        sizes[size],
        className,
      )}
    >
      {showLogo ? (
        // A tenant logo is a same-origin file or inline data (lib/workspace/branding.ts),
        // so the optimizing image component adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={image} src={logoUrl!} alt="" className="size-full object-contain" onError={() => setFailed(logoUrl)} />
      ) : (
        organizationInitials(name)
      )}
    </span>
  );
}
