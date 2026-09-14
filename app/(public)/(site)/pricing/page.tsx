import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq-list";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { PageIntro, Section, SectionHeader } from "@/components/marketing/section";
import { getSiteCopy } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return (await getSiteCopy()).meta.pricing;
}

/** Plans (design spec §82). Commercial questions answered on the same page. */
export default async function PricingPage() {
  const { pricing, faq } = await getSiteCopy();

  return (
    <>
      <PageIntro eyebrow={pricing.eyebrow} title={pricing.title} lead={pricing.lead} />

      <Section tone="canvas">
        <PricingPlans />

        <ul className="mt-10 space-y-2.5 border-t border-line pt-8">
          {pricing.footnotes.map((note) => (
            <li key={note} className="flex gap-3 text-table text-fg-muted">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-line-strong" />
              {note}
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="surface" bordered={false}>
        <SectionHeader
          step="01"
          eyebrow={pricing.questions.eyebrow}
          title={pricing.questions.title}
        />
        <FaqList items={faq.groups.gettingStarted.items} className="mt-12" />
      </Section>

      <CtaBand />
    </>
  );
}
