import { cn } from "@/lib/utils/cn";

/**
 * The architectural line drawings that carry the public site (design spec §3, §83).
 *
 * NESTO ships no photography and no illustration files. The brand visual is a
 * drafting drawing, rendered as inline SVG hairlines in `currentColor` — so it
 * inherits the surrounding text colour, works on warm white and on graphite,
 * costs nothing to load, and can never shift the layout while it arrives.
 *
 * Three drawings cover every placement: an elevation beside the hero, a plan
 * behind a panel, and a horizontal survey line under a band.
 */

export function BlueprintElevation({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 360 470"
      fill="none"
      preserveAspectRatio="xMidYMax meet"
      className={cn("pointer-events-none", className)}
    >
      <g stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
        {/* Setting-out lines the drawing is dimensioned from */}
        <path d="M0 96h360M0 148h360" strokeDasharray="3 9" opacity="0.45" />

        {/* Tower crane: mast, jib, counter-jib, hook */}
        <g opacity="0.6">
          <path d="M48 430V64M40 430V64" />
          <path d="M40 78h-28M12 78v18M20 64h216M44 64 20 78M76 64l-28 14" />
          <path d="M188 78v56" />
          <path d="M182 134h12v10h-12z" />
          {/* Mast bracing */}
          <path d="M40 118 48 96M48 118 40 96M40 172 48 150M48 172 40 150M40 226 48 204M48 226 40 204M40 280 48 258M48 280 40 258M40 334 48 312M48 334 40 312M40 388 48 366M48 388 40 366" />
        </g>

        {/* Tower under construction: flat top, floor plates, columns */}
        <path d="M116 430V148h148v282" />
        <path d="M116 190h148M116 232h148M116 274h148M116 316h148M116 372h148" opacity="0.75" />
        <path d="M154 430V148M190 430V148M228 430V148" opacity="0.5" />
        {/* Top storey still open — frame only, no floor plate */}
        <path d="M116 148h148" strokeWidth="1.5" />

        {/* Low block */}
        <path d="M276 430V318l48-26v138" />
        <path d="M276 356h48M276 394h48" opacity="0.6" />

        {/* Ground and foundation hatch */}
        <path d="M0 430h360" strokeWidth="1.5" />
        <g opacity="0.3">
          <path d="M96 430v14M120 430v14M144 430v14M168 430v14M192 430v14M216 430v14M240 430v14M264 430v14M288 430v14M312 430v14" />
        </g>

        {/* Overall dimension */}
        <g opacity="0.45">
          <path d="M116 460h148M116 452v16M264 452v16" />
        </g>
      </g>

      {/* Setting-out points */}
      <g fill="currentColor" opacity="0.45">
        <circle cx="116" cy="148" r="2.5" />
        <circle cx="264" cy="148" r="2.5" />
        <circle cx="324" cy="292" r="2.5" />
      </g>
    </svg>
  );
}

export function BlueprintPlan({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 320"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      className={cn("pointer-events-none", className)}
    >
      <g stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
        {/* Outer walls */}
        <path d="M40 40h320v240H40z" strokeWidth="1.5" />
        {/* Partitions */}
        <path d="M40 152h180M220 40v240M300 152h60M220 200h80" opacity="0.7" />
        {/* Openings */}
        <path d="M120 40v12M280 280v-12M40 96h12M360 216h-12" opacity="0.5" />
        {/* Grid */}
        <path d="M40 96h320M40 216h320M120 40v240M300 40v240" strokeDasharray="3 9" opacity="0.35" />
      </g>
      <g fill="currentColor" opacity="0.4">
        <circle cx="120" cy="152" r="2" />
        <circle cx="220" cy="152" r="2" />
        <circle cx="220" cy="200" r="2" />
      </g>
    </svg>
  );
}

export function BlueprintSurvey({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 120"
      fill="none"
      preserveAspectRatio="none"
      className={cn("pointer-events-none", className)}
    >
      <g stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
        <path d="M0 92h1200" opacity="0.6" />
        <path d="M0 60h1200" strokeDasharray="3 9" opacity="0.3" />
        {/* Station ticks, tall every fourth */}
        {Array.from({ length: 25 }, (_, index) => index * 50).map((x) => (
          <path key={x} d={`M${x} 92v${x % 200 === 0 ? -22 : -10}`} opacity="0.45" />
        ))}
      </g>
    </svg>
  );
}
