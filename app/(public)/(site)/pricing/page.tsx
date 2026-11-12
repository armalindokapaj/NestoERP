import type { Metadata } from "next";
import { Check } from "@/components/icons";

import { PricingWizard } from "@/components/pricing/pricing-wizard";
import { ModuleSchedule } from "@/components/marketing/module-schedule";
import { PriceBook } from "@/components/marketing/price-book";
import { Dotted, Section, SectionHeader, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { getLocale, getSiteCopy } from "@/lib/i18n/server";
import { pricingCopy } from "@/lib/i18n/site/pricing-configurator";
import { getPublicPricingConfig } from "@/lib/modules/pricing/pricing.service";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const t = pricingCopy[await getLocale()];
  return { title: t.metaTitle, description: t.metaDescription };
}

/**
 * /pricing is the configurator (Modular Pricing PRD §3-§5): one header, then
 * the seven steps with the live estimate — no hero to scroll past, no button
 * to enter it. Then every rate as the bill of quantities, with the launch
 * offer (UI-05 §7), what's included, the FAQ and the proposal prompt.
 */
export default async function PricingPage() {
  const locale = await getLocale();
  const t = pricingCopy[locale];
  // Never a stale or hardcoded price when the price book cannot be read (§53).
  const [site, pricing] = await Promise.all([getSiteCopy(), getPublicPricingConfig().catch(() => null)]);

  return (
    <>
      <Section id="configurator" tone="canvas" containerClassName="max-w-[1400px] scroll-mt-20 pb-10 pt-8 sm:pt-10">
        <header className="mb-8 flex flex-col gap-4 border-b-2 border-fg pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="nesto-eyebrow text-accent-strong">{t.eyebrow}</p>
            <h1 className="mt-3 text-[40px] leading-[0.92] text-fg sm:text-[64px] font-display"><Dotted>{t.title}</Dotted></h1>
            <p className="nesto-standfirst mt-3 max-w-2xl text-[19px] leading-snug">{t.subtitle}</p>
          </div>
          <p className="font-mono text-[10px] max-md:text-meta uppercase tracking-[0.12em] text-fg-subtle">{t.notes}</p>
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

      <Section id="prices" tone="canvas" className="scroll-mt-28" bar={site.home.prices.eyebrow}>
        <SectionHeader title={site.home.prices.title} />
        <div className="mt-8">
          <PriceBook config={pricing} copy={site.home.prices} locale={locale} />
        </div>
      </Section>

      {/* Every module with its own rate, and what typical buyers pay (docs/pricing-modules.md). */}
      {pricing ? (
        <Section id="modules" tone="surface" className="scroll-mt-28" bar={t.schedule.eyebrow}>
          <SectionHeader title={t.schedule.title} lead={t.schedule.intro} />
          <div className="mt-8">
            <ModuleSchedule config={pricing} copy={t} locale={locale} />
          </div>
        </Section>
      ) : null}

      <Section tone="surface" bar={t.sections.includedEyebrow}>
        <SectionHeader title={t.sections.includedTitle} />
        <ul className={cn(hairlineGrid, "mt-8 sm:grid-cols-2 lg:grid-cols-4")}>
          {t.sections.includedItems.map((item) => <li key={item} className={cn(hairlineCell, "flex items-start gap-2 p-5 text-body text-fg")}><Check className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden="true" />{item}</li>)}
        </ul>
      </Section>

      <Section tone="canvas" bar={t.sections.faqEyebrow}>
        <SectionHeader title={t.sections.faqTitle} />
        <div className={cn(hairlineGrid, "mt-8 md:grid-cols-2")}>
          {t.faq.map(([question, answer]) => (
            <article key={question} className={cn(hairlineCell, "p-6")}>
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
          <Button asChild variant="secondary" size="lg"><a href="#configurator">{t.sections.ctaButton}</a></Button>
        </div>
      </Section>
    </>
  );
}
