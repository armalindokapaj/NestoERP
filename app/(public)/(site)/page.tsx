import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { InteractiveStory } from "@/components/marketing/landing/interactive-story";
import { Container, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { getLocale } from "@/lib/i18n/server";
import { landingCopy } from "@/lib/i18n/site/landing";
import { parseStoryParams } from "@/lib/marketing/landing-stories";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const copy = landingCopy[await getLocale()];
  return {
    title: { absolute: copy.meta.title },
    description: copy.meta.description,
    alternates: { canonical: "/" },
    openGraph: { title: copy.meta.title, description: copy.meta.description, url: "/" },
  };
}

/**
 * The public home page: the interactive presentation (Landing + Full View PRD
 * §3-§12, §67, §68, §76). Choose a business, then advance a short story in
 * which one company, one project and one Unit carry forward from department to
 * department. The detailed tour that used to live here is now /full-view.
 *
 * The server renders whichever slide `?story=&step=` names, so the story reads
 * without JavaScript and every slide has a shareable URL (§43). After the story
 * comes only a short proof strip and the way in — never the old long page (§67).
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [copy, params] = await Promise.all([getLocale().then((locale) => landingCopy[locale]), searchParams]);
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const initial = parseStoryParams(one(params.story), one(params.step));

  return (
    <>
      {initial ? <h1 className="sr-only">{copy.meta.title}</h1> : null}
      <InteractiveStory initial={initial} copy={copy} />

      {/* Proof strip (§97) */}
      <section className="border-b border-line bg-canvas" data-testid="landing-proof">
        <Container className="py-12 sm:py-16">
          <p className="nesto-eyebrow text-accent-strong">{copy.proof.eyebrow}</p>
          <ul className={cn(hairlineGrid, "mt-6 sm:grid-cols-3")}>
            {copy.proof.items.map((item) => (
              <li key={item.title} className={cn(hairlineCell, "p-6")}>
                <p className="nesto-eyebrow text-fg">{item.title}</p>
                <p className="mt-2 text-table leading-relaxed text-fg-muted">{item.copy}</p>
              </li>
            ))}
          </ul>
          <Button asChild variant="secondary" size="md" className="mt-6">
            <Link href="/full-view">
              {copy.proof.fullView}
              <ArrowRight />
            </Link>
          </Button>
        </Container>
      </section>

      {/* The way in (§50, §67) */}
      <section className="border-t border-accent/25 bg-surface">
        <Container className="flex flex-col items-start gap-5 py-12 sm:flex-row sm:items-center sm:justify-between sm:py-16">
          <div>
            <h2 className="text-balance font-serif text-section text-fg sm:text-page">{copy.closing.title}</h2>
            <p className="mt-2 max-w-xl text-body text-fg-muted">{copy.closing.copy}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/pricing">
                {copy.closing.pricing}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/contact">{copy.closing.access}</Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
