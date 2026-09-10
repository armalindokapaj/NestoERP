import type { Metadata } from "next";

import { BlueprintElevation } from "@/components/marketing/blueprint";
import { CtaBand } from "@/components/marketing/cta-band";
import {
  Container,
  PageIntro,
  Section,
  hairlineCell,
  hairlineGrid,
} from "@/components/marketing/section";
import { about, site } from "@/config/marketing";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "About",
  description: about.lead,
};

/**
 * About (design spec §82).
 *
 * An editorial layout rather than a card grid: the section title sits in the
 * margin and the argument runs in a single measured column, which is how long
 * text is meant to be read. No stock photography of people in hard hats.
 */
export default function AboutPage() {
  return (
    <>
      <PageIntro eyebrow={about.eyebrow} title={about.title} lead={about.lead} />

      <Section tone="canvas">
        <dl className={cn(hairlineGrid, "sm:grid-cols-3")}>
          {about.principles.map((principle) => (
            <div key={principle.term} className={cn(hairlineCell, "p-6")}>
              <dt className="font-serif text-section text-fg">{principle.term}</dt>
              <dd className="mt-2.5 text-table leading-relaxed text-fg-muted">{principle.copy}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section className="border-b border-line bg-surface">
        <Container className="py-16 sm:py-20 lg:py-28">
          <div className="space-y-16">
            {about.sections.map((section, index) => (
              <article
                key={section.title}
                className="grid gap-6 border-t border-line pt-10 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:gap-12"
              >
                <div>
                  <p className="nesto-eyebrow text-fg-subtle">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h2 className="mt-3 font-serif text-section text-fg lg:text-page">
                    {section.title}
                  </h2>
                </div>
                <div className="max-w-2xl space-y-4">
                  {section.body.map((paragraph) => (
                    <p key={paragraph} className="text-body leading-relaxed text-fg-muted sm:text-card">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="relative overflow-hidden border-b border-line bg-canvas">
        <BlueprintElevation className="absolute -right-20 bottom-0 hidden h-full w-[460px] text-line-strong opacity-60 lg:block" />
        <Container className="relative py-16 sm:py-20">
          <div className="max-w-xl">
            <p className="nesto-eyebrow text-fg-subtle">{site.category}</p>
            <p className="mt-6 font-serif text-page leading-tight text-fg sm:text-display">
              {brand.motto.join(" ")}
            </p>
            <p className="mt-5 text-body leading-relaxed text-fg-muted">
              The same line sits beside the date on every dashboard in the product. It is not a
              slogan we wrote for this page — it is what the software is trying to be.
            </p>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
