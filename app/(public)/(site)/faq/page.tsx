import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@/components/icons";

import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq-list";
import { Container, PageIntro, SectionBar, sectionMark } from "@/components/marketing/section";
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

      {/* Each group is one of the page's numbered sections: its bar names it. */}
      {FAQ_GROUPS.map((key) => (
        <section key={key} {...sectionMark(faq.groups[key].title)} className="relative border-b border-line bg-canvas">
          <SectionBar label={faq.groups[key].title} />
          <Container className="py-12 sm:py-14 lg:py-16">
            <h2 className="sr-only">{faq.groups[key].title}</h2>
            <FaqList items={faq.groups[key].items} />
          </Container>
        </section>
      ))}

      <section className="border-b border-line bg-canvas">
        <Container className="py-12 sm:py-14">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border border-line-strong bg-surface p-6 sm:p-8">
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
