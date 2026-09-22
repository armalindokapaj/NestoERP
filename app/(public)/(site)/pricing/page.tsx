import type { Metadata } from "next";

import { PricingWizard } from "@/components/pricing/pricing-wizard";
import { PageIntro, Section, SectionHeader } from "@/components/marketing/section";
import { getPublicPricingConfig } from "@/lib/modules/pricing/pricing.service";

export const metadata: Metadata = {
  title: "NESTO Pricing — Build Your ERP & ROZARIS Plan",
  description: "Configure your NESTO subscription based on companies, projects, users and ROZARIS projects. See your price instantly.",
};

const commercialQuestions = [
  ["What counts as an active user?", "A person with an enabled NESTO login. Employee and workforce records do not become paid users unless login access is enabled."],
  ["What is an active project?", "A project currently used for live operational work. Completed and archived projects are not priced by this public calculator."],
  ["What is a full company?", "A legal or operating company with its own company context and full access to the NESTO modules permitted by your agreement."],
  ["What is documents-only access?", "A restricted company connection for controlled shared-document access. It does not create a full workspace or add included active users."],
  ["Is 3D model production included?", "No. ROZARIS recurring pricing covers the project platform and published viewer. Model creation, conversion and preparation receive a separate quotation."],
] as const;

export default async function PricingPage() {
  let pricing;
  try {
    pricing = await getPublicPricingConfig();
  } catch {
    pricing = null;
  }
  const indexation = pricing?.publicRules.indexation;
  const indexName = indexation?.source === "EUROSTAT_HICP_EURO_AREA_ALL_ITEMS"
    ? "Euro Area HICP — All Items"
    : indexation?.source.replaceAll("_", " ");
  const questions = [
    ...commercialQuestions,
    [
      "How does HICP indexation work?",
      indexation?.enabled
        ? `Recurring prices are fixed until month ${indexation.firstAdjustmentMonth}. ${indexName} may then apply with a ${indexation.floorPercent}% floor and ${indexation.capPercent}% cap.`
        : "The active price book does not apply a future HICP adjustment.",
    ],
  ] as const;

  return (
    <>
      <PageIntro
        eyebrow="Transparent, configurable pricing"
        title="Build the NESTO structure you actually need."
        lead="Choose your companies, active projects, users and ROZARIS experiences. Every selection is explained and priced as you build."
      >
        <a href="#configurator" className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-body font-medium text-primary-fg hover:bg-primary-hover">
          Build your configuration
        </a>
      </PageIntro>

      <Section id="configurator" tone="canvas" containerClassName="max-w-[1400px] scroll-mt-20 py-10 sm:py-14 lg:py-16">
        {pricing ? (
          <PricingWizard initialConfig={pricing} />
        ) : (
          <div className="nesto-card mx-auto max-w-2xl p-8 text-center" role="alert">
            <h2 className="text-section font-semibold text-fg">Pricing is temporarily unavailable.</h2>
            <p className="mt-2 text-body text-fg-muted">Please try again. We will never show unverified fallback prices.</p>
          </div>
        )}
      </Section>

      <Section tone="surface">
        <SectionHeader
          step="01"
          eyebrow="Commercial rules"
          title="Clear definitions before you commit."
          lead="The calculator separates operational records from paid access and keeps one-time services outside recurring fees."
        />
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
          {questions.map(([question, answer]) => (
            <article key={question} className="bg-surface p-6">
              <h3 className="text-card font-semibold text-fg">{question}</h3>
              <p className="mt-2 text-body leading-relaxed text-fg-muted">{answer}</p>
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
