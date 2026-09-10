import { brand } from "@/config/brand";

/**
 * The graphite card that closes an executive dashboard (design spec §74).
 *
 * A dashboard of nothing but figures reads as a report; this is the one place
 * the brand speaks on an internal screen. It carries no data and no link, so
 * it can never go stale or dead.
 *
 * Drawn rather than photographed, for the same reasons as the sign-in panel:
 * no asset to ship, no layout shift, nothing to license.
 */
export function BrandFeatureCard() {
  return (
    <section className="relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-xl bg-graphite p-5 md:p-6">
      <svg
        aria-hidden="true"
        viewBox="0 0 320 260"
        preserveAspectRatio="xMaxYMax slice"
        className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 text-graphite-fg/10"
      >
        <g stroke="currentColor" strokeWidth="1" fill="none">
          <path d="M40 260V110l90-58 90 58v150" />
          <path d="M40 150h180M40 195h180" />
          <path d="M85 260V132M130 260V104M175 260V132" />
          <path d="M240 260V150l50-32v142" />
          <path d="M0 260h320" strokeWidth="1.5" />
          <path d="M0 88h320" strokeDasharray="4 10" />
        </g>
      </svg>

      <div className="relative flex items-start justify-between gap-4">
        <p className="nesto-eyebrow text-graphite-fg/60">{brand.feature.eyebrow}</p>
        <div className="hidden text-right xl:block">
          {brand.feature.aside.map((line) => (
            <p key={line} className="nesto-eyebrow text-graphite-fg/40">
              {line}
            </p>
          ))}
        </div>
      </div>

      <div className="relative mt-8">
        <p className="font-serif text-section leading-tight text-graphite-fg md:text-display">
          {brand.feature.headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
        <div aria-hidden="true" className="mb-3 mt-5 h-px w-6 bg-graphite-fg/30" />
        <p className="nesto-eyebrow text-graphite-fg/60">{brand.name}</p>
      </div>
    </section>
  );
}
