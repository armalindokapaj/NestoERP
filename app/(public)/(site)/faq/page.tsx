import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq-list";
import { Container, PageIntro } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { faqGroups, site } from "@/config/marketing";

export const metadata: Metadata = {
  title: "Questions",
  description:
    "What NESTO is, which modules are included, how access is enforced, what it costs and what is finished — answered directly.",
};

/**
 * Questions (design spec §82).
 *
 * Grouped so a reader can skip to their own concern, and built on <details>, so
 * the whole page works with JavaScript switched off and costs nothing to ship.
 */
export default function FaqPage() {
  return (
    <>
      <PageIntro
        eyebrow="Questions"
        title="Answered directly, including the awkward ones."
        lead="If something you need is missing, ask. We would rather tell you it is not built yet than let you find out in month two."
      />

      <section className="border-b border-line bg-canvas">
        <Container className="py-16 sm:py-20 lg:py-24">
          <div className="space-y-16">
            {faqGroups.map((group, index) => (
              <section key={group.title}>
                <div className="flex items-baseline gap-3">
                  <span className="text-micro tabular-nums text-fg-subtle">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="font-serif text-section text-fg lg:text-page">{group.title}</h2>
                </div>
                <FaqList items={group.items} className="mt-6" />
              </section>
            ))}
          </div>

          <div className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-line bg-surface p-6 sm:p-8">
            <div className="min-w-0 flex-1">
              <h2 className="text-card font-semibold text-fg">Still unanswered?</h2>
              <p className="mt-1.5 text-table text-fg-muted">
                Write to{" "}
                <a
                  href={`mailto:${site.contact.general}`}
                  className="text-accent-strong underline underline-offset-4"
                >
                  {site.contact.general}
                </a>{" "}
                or send us the question directly.
              </p>
            </div>
            <Button asChild size="md">
              <Link href="/contact">
                Ask us
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
