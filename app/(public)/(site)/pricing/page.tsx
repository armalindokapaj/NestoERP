import type { Metadata } from "next";
import { Check } from "lucide-react";

import { PricingWizard } from "@/components/pricing/pricing-wizard";
import { Section, SectionHeader } from "@/components/marketing/section";
import { getLocale } from "@/lib/i18n/server";
import { pricingCopy } from "@/lib/i18n/site/pricing-configurator";
import { getPublicPricingConfig } from "@/lib/modules/pricing/pricing.service";

export const metadata: Metadata = {
  title: "NESTO Pricing — Build your NESTO",
  description: "Configure only what your company needs: foundation, modules, companies, projects, users and contract. See your price instantly.",
};

/**
 * /pricing is the configurator (Modular Pricing PRD §3-§5): one header, then
 * the seven steps with the live estimate — no hero to scroll past, no button
 * to enter it. What's included, the FAQ and the proposal prompt follow.
 */
export default async function PricingPage() {
  const locale = await getLocale();
  const t = pricingCopy[locale];
  // Never a stale or hardcoded price when the price book cannot be read (§53).
  const pricing = await getPublicPricingConfig().catch(() => null);

  return (
    <>
      <Section id="configurator" tone="canvas" containerClassName="max-w-[1400px] scroll-mt-20 pb-10 pt-8 sm:pt-10">
        <header className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="nesto-eyebrow text-fg-subtle">{t.eyebrow}</p>
            <h1 className="mt-2 font-serif text-page text-fg sm:text-display">{t.title}</h1>
            <p className="mt-2 max-w-2xl text-body text-fg-muted">{t.subtitle}</p>
          </div>
          <p className="text-meta text-fg-subtle">{t.notes}</p>
        </header>
        {pricing ? (
          <PricingWizard initialConfig={pricing} copy={t} locale={locale} />
        ) : (
          <div className="nesto-card mx-auto max-w-2xl p-8 text-center" role="alert">
            <h2 className="text-section font-semibold text-fg">{t.unavailableTitle}</h2>
            <p className="mt-2 text-body text-fg-muted">{t.unavailableBody}</p>
          </div>
        )}
      </Section>

      <Section tone="surface">
        <SectionHeader step="01" eyebrow={t.sections.includedEyebrow} title={t.sections.includedTitle} />
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {t.sections.includedItems.map((item) => <li key={item} className="flex items-start gap-2 rounded-xl border border-line bg-canvas p-4 text-body text-fg"><Check className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden="true" />{item}</li>)}
        </ul>
      </Section>

      <Section tone="canvas">
        <SectionHeader step="02" eyebrow={t.sections.faqEyebrow} title={t.sections.faqTitle} />
        <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
          {t.faq.map(([question, answer]) => (
            <article key={question} className="bg-surface p-6">
              <h3 className="text-card font-semibold text-fg">{question}</h3>
              <p className="mt-2 text-body leading-relaxed text-fg-muted">{answer}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-section font-semibold text-fg">{t.sections.ctaTitle}</h2>
            <p className="mt-1 max-w-2xl text-body text-fg-muted">{t.sections.ctaBody}</p>
          </div>
          <a href="#configurator" className="inline-flex h-11 items-center rounded-md border border-line px-5 text-body font-medium text-fg hover:bg-hover">{t.sections.ctaButton}</a>
        </div>
      </Section>
    </>
  );
}
