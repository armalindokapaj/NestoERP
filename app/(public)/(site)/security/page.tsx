import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq-list";
import { Dotted, PageIntro, Section, SectionHeader } from "@/components/marketing/section";
import { getSiteCopy } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

const LEGEND = ["site-fill-solid", "site-fill-hatch", "site-fill-outline", "site-fill-dash", "site-fill-gold", "site-fill-cross"];

export async function generateMetadata(): Promise<Metadata> {
  return (await getSiteCopy()).meta.security;
}

/**
 * Security (spec §55, §69).
 *
 * Every claim here describes something that is actually implemented, and the
 * closing panel says plainly what is not. A trust page that overstates is the
 * fastest way to lose the audience it was written for.
 */
export default async function SecurityPage() {
  const { security, faq, sheet } = await getSiteCopy();

  return (
    <>
      <PageIntro eyebrow={security.eyebrow} title={security.title} lead={security.lead} />

      <Section tone="canvas" bar={sheet.measures}>
        {/* A drawing's legend: each measure keeps its own fill (UI-05 §7). */}
        <dl className="grid sm:grid-cols-2 sm:gap-x-10">
          {security.measures.map((measure, index) => (
            <div key={measure.title} className="flex gap-5 border-t border-fg py-7">
              <span aria-hidden="true" className={cn("size-12 shrink-0", LEGEND[index % LEGEND.length])} />
              <div>
                <dt className="text-card font-semibold text-fg">{measure.title}</dt>
                <dd className="mt-2 text-table leading-relaxed text-fg-muted">{measure.copy}</dd>
              </div>
            </div>
          ))}
        </dl>
      </Section>

      <Section tone="canvas" bar={security.honesty.eyebrow}>
        <div className="max-w-3xl border-[1.5px] border-dashed border-fg p-6 sm:p-10">
          <h2 className="text-[32px] leading-[0.98] text-fg sm:text-[44px] font-display">
            <Dotted>{security.honesty.title}</Dotted>
          </h2>
          <p className="mt-4 text-body leading-relaxed text-fg-muted sm:text-card">{security.honesty.copy}</p>
        </div>
      </Section>

      <Section tone="surface" bordered={false} bar={security.questions.eyebrow}>
        <SectionHeader
          title={security.questions.title}
        />
        <FaqList items={faq.groups.security.items} className="mt-12" />
      </Section>

      <CtaBand />
    </>
  );
}
