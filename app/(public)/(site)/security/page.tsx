import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq-list";
import { BlueprintPlan } from "@/components/marketing/blueprint";
import {
  PageIntro,
  Section,
  SectionHeader,
  hairlineCell,
  hairlineGrid,
} from "@/components/marketing/section";
import { faqGroups, security } from "@/config/marketing";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How access is controlled in NESTO: permissions derived from the role, enforced at the edge and again in the page.",
};

/**
 * Security (spec §55, §69).
 *
 * Every claim here describes something that is actually implemented, and the
 * closing panel says plainly what is not. A trust page that overstates is the
 * fastest way to lose the audience it was written for.
 */
export default function SecurityPage() {
  return (
    <>
      <PageIntro eyebrow="Security" title={security.title} lead={security.lead} />

      <Section tone="canvas">
        <dl className={cn(hairlineGrid, "sm:grid-cols-2")}>
          {security.measures.map((measure) => (
            <div key={measure.title} className={cn(hairlineCell, "p-6 lg:p-8")}>
              <dt className="text-card font-semibold text-fg">{measure.title}</dt>
              <dd className="mt-3 text-table leading-relaxed text-fg-muted">{measure.copy}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section className="relative overflow-hidden border-b border-line bg-graphite">
        <BlueprintPlan className="absolute -right-10 top-0 hidden h-full w-[440px] text-graphite-fg/10 lg:block" />
        <div className="relative mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="max-w-2xl">
            <p className="nesto-eyebrow text-graphite-fg/55">Plainly</p>
            <h2 className="mt-5 font-serif text-page text-graphite-fg sm:text-display">
              {security.honesty.title}
            </h2>
            <p className="mt-5 text-body leading-relaxed text-graphite-fg/70 sm:text-card">
              {security.honesty.copy}
            </p>
          </div>
        </div>
      </section>

      <Section tone="surface" bordered={false}>
        <SectionHeader step="01" eyebrow="Questions" title="Security and data." />
        <FaqList items={faqGroups[2].items} className="mt-12" />
      </Section>

      <CtaBand />
    </>
  );
}
