import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq-list";
import { Container, PageIntro } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { FAQ_GROUPS, siteContact } from "@/config/marketing";
import { getSiteCopy } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return (await getSiteCopy()).meta.faq;
}

/**
 * Questions (design spec §82).
 *
 * Grouped so a reader can skip to their own concern, and built on <details>, so
 * the whole page works with JavaScript switched off and costs nothing to ship.
 */
export default async function FaqPage() {
  const { faq } = await getSiteCopy();

  return (
    <>
      <PageIntro eyebrow={faq.eyebrow} title={faq.title} lead={faq.lead} />

      <section className="border-b border-line bg-canvas">
        <Container className="py-16 sm:py-20 lg:py-24">
          <div className="space-y-16">
            {FAQ_GROUPS.map((key, index) => (
              <section key={key}>
                <div className="flex items-baseline gap-3">
                  <span className="text-micro tabular-nums text-fg-subtle">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="font-serif text-section text-fg lg:text-page">
                    {faq.groups[key].title}
                  </h2>
                </div>
                <FaqList items={faq.groups[key].items} className="mt-6" />
              </section>
            ))}
          </div>

          <div className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-line bg-surface p-6 sm:p-8">
            <div className="min-w-0 flex-1">
              <h2 className="text-card font-semibold text-fg">{faq.stillUnanswered}</h2>
              <p className="mt-1.5 text-table text-fg-muted">
                {faq.writeTo}{" "}
                <a
                  href={`mailto:${siteContact.general}`}
                  className="text-accent-strong underline underline-offset-4"
                >
                  {siteContact.general}
                </a>{" "}
                {faq.orAskDirectly}
              </p>
            </div>
            <Button asChild size="md">
              <Link href="/contact">
                {faq.askUs}
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
