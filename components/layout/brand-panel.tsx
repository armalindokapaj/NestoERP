import Link from "@/components/navigation/nav-link";
import { BrandSkyline } from "@/components/layout/brand-skyline";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { brand } from "@/config/brand";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The brand panel beside sign-in, recovery and the invitation (design spec
 * §83; UI-05 §5): the company's towers at dusk, every floor one sign-in away.
 * Ink in both themes — it is the one surface on these pages that never
 * changes, so the form beside it is what the theme toggle visibly moves.
 */
export async function BrandPanel({ tagline }: { tagline?: string }) {
  const [tAuth, tShell] = await Promise.all([getTranslations("auth"), getTranslations("shell")]);

  return (
    <div className="relative hidden overflow-hidden bg-[#0f141a] text-[#e8e4da] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:p-12">
      <div>
        <Link href="/" aria-label={tShell("homeLink")} className="inline-flex">
          <NestoLogo wordmarkClassName="text-[#e8e4da]" />
        </Link>
      </div>
      <div className="mt-14 max-w-md">
        <p className="text-[56px] leading-[0.9] xl:text-[64px] font-display">
          {tAuth("brandHeadline")}
          <span className="block text-[#c9a961]">{tAuth("brandHeadlineAccent")}</span>
        </p>
        <p className="mt-5 font-mono text-[11px] max-md:text-meta uppercase tracking-[0.16em] text-[#e8e4da]/60">
          {tagline ?? brand.signoff.join(" · ")}
        </p>
      </div>
      {/* The drawing takes whatever height is left, so it never runs under the words. */}
      <div className="relative -mx-12 -mb-12 mt-8 min-h-0 flex-1">
        <BrandSkyline className="pointer-events-none absolute inset-0 size-full" />
      </div>
    </div>
  );
}
