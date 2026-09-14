import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BlueprintElevation } from "@/components/marketing/blueprint";
import { ContrastList } from "@/components/marketing/contrast-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq-list";
import { Lifecycle } from "@/components/marketing/lifecycle";
import { ModuleGrid } from "@/components/marketing/module-grid";
import { RoleGrid } from "@/components/marketing/role-grid";
import {
  Container,
  Section,
  SectionHeader,
  hairlineCell,
  hairlineGrid,
} from "@/components/marketing/section";
import { StatStrip } from "@/components/marketing/stat-strip";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import { Button } from "@/components/ui/button";
import { featuredFaq, featuredRoles } from "@/config/marketing";
import { getSiteCopy } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();

  return {
    /* The home page states the category rather than repeating the brand name. */
    title: { absolute: `NESTO — ${copy.category}` },
    description: copy.summary,
  };
}

/**
 * The public home page (spec §6; design spec §81, §82).
 *
 * One argument, told in seven sections: what construction runs on today, what
 * NESTO holds instead, who it is shaped around, the build it follows end to
 * end, why it feels the way it does, how access is controlled, and the six
 * questions everyone asks. Then the way in.
 *
 * Nothing on this page is an image. The preview is the product's own
 * components, the drawings are inline hairlines, and the only JavaScript is the
 * navigation drawer — so the page is finished by the time it is painted.
 */
export default async function HomePage() {
  const copy = await getSiteCopy();
  const { hero, problem, platform, roles, build, principles, access, questions } = copy.home;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line bg-surface">
        <div aria-hidden="true" className="nesto-drafting-grid absolute inset-0" />

        <Container className="relative pb-16 pt-16 sm:pb-20 sm:pt-24 lg:pb-24 lg:pt-28">
          <div className="grid items-end gap-10 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-16">
            <div className="max-w-3xl">
              <p className="nesto-rise nesto-eyebrow text-fg-subtle">{copy.category}</p>

              <h1 className="nesto-rise nesto-rise-2 mt-6 text-balance font-serif text-page leading-[1.05] text-fg sm:text-display lg:text-hero">
                {hero.headline.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </h1>

              <p className="nesto-rise nesto-rise-3 mt-7 max-w-2xl text-body leading-relaxed text-fg-muted sm:text-card">
                {hero.lead}
              </p>

              <div className="nesto-rise nesto-rise-4 mt-9 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/contact">
                    {hero.primary}
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/login">{hero.secondary}</Link>
                </Button>
              </div>

              <p className="nesto-rise nesto-rise-5 mt-6 text-meta text-fg-subtle">{hero.note}</p>
            </div>

            {/* The elevation gets its own column rather than sitting behind the
                copy — a drawing half-covered by a card reads as a mistake. */}
            <BlueprintElevation className="nesto-rise nesto-rise-4 hidden h-[380px] w-full text-line-strong xl:block" />
          </div>

          <div className="nesto-rise nesto-rise-5 mt-14 sm:mt-16">
            <WorkspacePreview />
          </div>
        </Container>
      </section>

      {/* Figures */}
      <section className="border-b border-line bg-canvas">
        <Container className="py-12 sm:py-14">
          <StatStrip />
        </Container>
      </section>

      {/* 01 — The problem */}
      <Section tone="surface">
        <SectionHeader
          step="01"
          eyebrow={problem.eyebrow}
          title={problem.title}
          lead={problem.lead}
        />
        <ContrastList className="mt-12" />
      </Section>

      {/* 02 — The platform */}
      <Section id="platform" tone="canvas">
        <SectionHeader
          step="02"
          eyebrow={platform.eyebrow}
          title={platform.title}
          lead={platform.lead}
          aside={
            <Button asChild variant="secondary" size="md">
              <Link href="/platform">
                {platform.cta}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
        <ModuleGrid className="mt-14" />
      </Section>

      {/* 03 — Roles */}
      <Section tone="surface">
        <SectionHeader
          step="03"
          eyebrow={copy.rolesSection.eyebrow}
          title={copy.rolesSection.title}
          lead={copy.rolesSection.lead}
          aside={
            <Button asChild variant="secondary" size="md">
              <Link href="/platform#roles">
                {roles.cta}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
        <RoleGrid roleKeys={featuredRoles} className="mt-12" />
      </Section>

      {/* 04 — The build */}
      <Section tone="canvas">
        <SectionHeader
          step="04"
          eyebrow={build.eyebrow}
          title={build.title}
          lead={build.lead}
        />
        <Lifecycle className="mt-12" />
      </Section>

      {/* 05 — Principles */}
      <Section tone="surface">
        <SectionHeader
          step="05"
          eyebrow={principles.eyebrow}
          title={principles.title}
          lead={principles.lead}
        />

        <div className={cn(hairlineGrid, "mt-12 lg:grid-cols-3")}>
          {copy.pillars.map((pillar) => (
            <article key={pillar.title} className={cn(hairlineCell, "flex flex-col p-6 lg:p-8")}>
              <h3 className="text-card font-semibold text-fg">{pillar.title}</h3>
              <p className="mt-3 text-table leading-relaxed text-fg-muted">{pillar.copy}</p>
              <ul className="mt-6 space-y-2 border-t border-line pt-5 lg:mt-auto">
                {pillar.points.map((point) => (
                  <li key={point} className="nesto-eyebrow text-fg-subtle">
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      {/* 06 — Security */}
      <Section tone="canvas">
        <SectionHeader
          step="06"
          eyebrow={access.eyebrow}
          title={copy.security.title}
          lead={copy.security.lead}
          aside={
            <Button asChild variant="secondary" size="md">
              <Link href="/security">
                {access.cta}
                <ArrowRight />
              </Link>
            </Button>
          }
        />

        <dl className={cn(hairlineGrid, "mt-12 lg:grid-cols-3")}>
          {copy.security.measures.slice(0, 3).map((measure) => (
            <div key={measure.title} className={cn(hairlineCell, "p-6")}>
              <dt className="text-card font-semibold text-fg">{measure.title}</dt>
              <dd className="mt-2.5 text-table leading-relaxed text-fg-muted">{measure.copy}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* 07 — Questions */}
      <Section tone="surface" bordered={false}>
        <SectionHeader
          step="07"
          eyebrow={questions.eyebrow}
          title={questions.title}
          aside={
            <Button asChild variant="secondary" size="md">
              <Link href="/faq">
                {questions.cta}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
        <FaqList
          items={featuredFaq.map(([group, index]) => copy.faq.groups[group].items[index])}
          className="mt-12"
        />
      </Section>

      <CtaBand />
    </>
  );
}
