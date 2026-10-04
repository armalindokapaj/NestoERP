"use client";

import * as React from "react";

import { organizationInitials } from "@/lib/workspace/branding";

/**
 * The viewer's loading mark: the owner's logo (or initials) at the centre of a
 * ring that turns while the scene loads. The ring is the only thing that moves,
 * and it stops for readers who ask for reduced motion.
 */
export function ViewerLoadingMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = React.useState<string | null>(null);
  const showImage = Boolean(logoUrl) && failed !== logoUrl;
  return (
    <div className="relative flex size-28 items-center justify-center" aria-hidden="true">
      <svg className="absolute inset-0 size-full animate-spin [animation-duration:1.6s] motion-reduce:animate-none" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="46" stroke="var(--nesto-border-strong)" strokeWidth="2" />
        <circle cx="50" cy="50" r="46" stroke="var(--nesto-accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="72 217" />
      </svg>
      <div className="flex size-[4.75rem] items-center justify-center overflow-hidden rounded-full bg-surface-muted">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl!} alt="" className="size-14 object-contain" onError={() => setFailed(logoUrl)} />
        ) : (
          <span className="font-serif text-xl tracking-wide text-fg">{organizationInitials(name) || "N"}</span>
        )}
      </div>
    </div>
  );
}
