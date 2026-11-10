import Link from "next/link";
import { ArrowRight } from "@/components/icons";

import { Container, Dotted } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { getSiteCopy } from "@/lib/i18n/server";

/**
 * The ink band that closes every public page (design spec §74, §82; UI-05 §4).
 *
 * One inverted surface per page, always in the same place, always saying the
 * same thing. A visitor who has scrolled a whole page should not have to hunt
 * for the way in.
 */
export async function CtaBand() {
  const { closingCta } = await getSiteCopy();
  const last = closingCta.headline.length - 1;

  return (
    <section className="bg-fg text-canvas">
      <Container className="flex flex-wrap items-end justify-between gap-8 py-16 sm:py-20 lg:py-24">
        <div className="max-w-3xl">
          <p className="nesto-eyebrow text-accent">{closingCta.eyebrow}</p>
          <h2 className="mt-5 text-balance text-[40px] leading-[0.92] sm:text-[56px] lg:text-[72px] font-display">
            {closingCta.headline.map((line, index) => (
              <span key={line} className="block">
                {index === last ? <Dotted>{line}</Dotted> : line}
              </span>
            ))}
          </h2>
          <p className="mt-5 max-w-xl text-body leading-relaxed opacity-70 sm:text-card">{closingCta.lead}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="border-accent bg-accent text-[#0b0d10] hover:bg-accent/90">
            <Link href="/apply">
              {closingCta.primary}
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="border border-canvas/30 text-canvas hover:bg-canvas/10 hover:text-canvas">
            <Link href="/platform">{closingCta.secondary}</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
