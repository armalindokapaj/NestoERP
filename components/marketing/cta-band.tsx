import Link from "next/link";

import { BlueprintPlan } from "@/components/marketing/blueprint";
import { Container, SectionMark } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { closingCta } from "@/config/marketing";

/**
 * The graphite band that closes every public page (design spec §74, §82).
 *
 * One dark surface per page, always in the same place, always saying the same
 * thing. A visitor who has scrolled a whole page should not have to hunt for
 * the way in.
 */
export function CtaBand() {
  return (
    <section className="relative overflow-hidden border-t border-line bg-graphite">
      <BlueprintPlan className="absolute -right-16 top-0 hidden h-full w-[520px] text-graphite-fg/10 lg:block" />

      <Container className="relative py-16 sm:py-20 lg:py-24">
        <div className="max-w-2xl">
          <SectionMark step="→" label={closingCta.eyebrow} tone="inverse" />

          <h2 className="mt-6 text-balance font-serif text-page leading-tight text-graphite-fg sm:text-display">
            {closingCta.headline.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>

          <p className="mt-5 max-w-xl text-body leading-relaxed text-graphite-fg/70 sm:text-card">
            {closingCta.lead}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="bg-graphite-fg text-graphite hover:bg-graphite-fg/90"
            >
              <Link href={closingCta.primary.href}>{closingCta.primary.label}</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="text-graphite-fg/75 hover:bg-graphite-fg/10 hover:text-graphite-fg"
            >
              <Link href={closingCta.secondary.href}>{closingCta.secondary.label}</Link>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
