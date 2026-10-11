import Link from "@/components/navigation/nav-link";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Architectural brand visual for the authentication pages (design spec §83).
 *
 * Drawn rather than photographed: a structural line composition keeps the
 * "architectural minimalism" direction (§3) with no image asset to ship, no
 * layout shift, and no stock photography to license.
 */
export async function BrandPanel({ tagline }: { tagline?: string }) {
  const [tAuth, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);

  return (
    <div className="relative hidden overflow-hidden bg-graphite lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:justify-between lg:p-12">
      <svg
        aria-hidden="true"
        viewBox="0 0 400 600"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 size-full text-graphite-fg/10"
      >
        <g stroke="currentColor" strokeWidth="1" fill="none">
          {/* Structural frame */}
          <path d="M60 560V220l140-90 140 90v340" />
          <path d="M60 300h280M60 380h280M60 460h280" />
          <path d="M130 560V265M200 560V225M270 560V265" />
          {/* Foundation */}
          <path d="M20 560h360" strokeWidth="1.5" />
          {/* Site lines */}
          <path d="M0 200h400M0 140h400" strokeDasharray="4 10" />
        </g>
      </svg>

      <div className="relative">
        <Link href="/" aria-label={tShell("homeLink")} className="inline-flex">
          <NestoLogo tone="inverse" />
        </Link>
      </div>

      <div className="relative max-w-sm">
        <p className="font-serif text-display text-graphite-fg">{tAuth("brandHeadline")}</p>
        <p className="mt-4 text-body text-graphite-fg/60">{tagline ?? tAuth("brandTagline")}</p>
      </div>
    </div>
  );
}
