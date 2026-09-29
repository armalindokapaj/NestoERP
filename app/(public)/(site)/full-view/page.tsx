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
import { FullViewSectionNav, FULL_VIEW_SECTIONS } from "@/components/marketing/full-view-nav";
import { featuredRoles } from "@/config/marketing";
import { getLocale, getSiteCopy } from "@/lib/i18n/server";
import { fullViewCopy } from "@/lib/i18n/site/full-view";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const fv = fullViewCopy[await getLocale()];
  return {
    title: { absolute: fv.meta.title },
    description: fv.meta.description,
    alternates: { canonical: "/full-view" },
    openGraph: { title: fv.meta.title, description: fv.meta.description, url: "/full-view" },
  };
}

/**
 * Full View (Landing + Full View PRD §51-§66, §85): the former home page, kept
 * whole and reorganised as the long-form tour of the platform — overview,
 * problem, modules, roles, lifecycle, Group architecture, product experience,
 * access, ROZARIS, the pricing model and the questions. The home page at `/`
 * is now the interactive story; this page documents NESTO's breadth.
 *
 * Every section is server-rendered and reachable by anchor (§75, §87); the
 * legacy "every module on every plan" claims were corrected on the way (§56).
 */
export default async function FullViewPage() {
  const [copy, locale] = await Promise.all([getSiteCopy(), getLocale()]);
  const fv = fullViewCopy[locale];
  const { hero, problem, platform, build, principles, access } = copy.home;

  return (
    <>
      {/* 01 — Overview */}
      <section id="overview" className="relative scroll-mt-28 overflow-hidden border-b border-line bg-surface">
        <div aria-hidden="true" className="nesto-drafting-grid absolute inset-0" />

        <Container className="relative pb-16 pt-16 sm:pb-20 sm:pt-24 lg:pb-24 lg:pt-28">
          <div className="grid items-end gap-10 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-16">
            <div className="max-w-3xl">
              <p className="nesto-rise nesto-eyebrow text-fg-subtle">{fv.eyebrow} · {copy.category}</p>

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

      <FullViewSectionNav labels={fv.nav} sections={FULL_VIEW_SECTIONS} />

      {/* Figures */}
      <section className="border-b border-line bg-canvas">
        <Container className="py-12 sm:py-14">
          <StatStrip />
        </Container>
      </section>

      {/* 02 — The problem */}
      <Section id="problem" tone="surface" className="scroll-mt-28">
        <SectionHeader
          step="02"
          eyebrow={problem.eyebrow}
          title={problem.title}
          lead={problem.lead}
        />
        <ContrastList className="mt-12" />
      </Section>

      {/* 03 — The platform */}
      <Section id="modules" tone="canvas" className="scroll-mt-28">
        <span id="platform" aria-hidden="true" />
        <SectionHeader
          step="03"
          eyebrow={platform.eyebrow}
          title={platform.title}
          lead={`${platform.lead} ${fv.modulesNote}`}
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

      {/* 04 — Roles */}
      <Section id="roles" tone="surface" className="scroll-mt-28">
        <SectionHeader
          step="04"
          eyebrow={copy.rolesSection.eyebrow}
          title={copy.rolesSection.title}
          lead={copy.rolesSection.lead}
          aside={
            <Button asChild variant="secondary" size="md">
              <Link href="/platform#roles">
                {fv.rolesLink}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
        <RoleGrid roleKeys={featuredRoles} className="mt-12" />
      </Section>

      {/* 05 — The build */}
      <Section id="lifecycle" tone="canvas" className="scroll-mt-28">
        <SectionHeader
          step="05"
          eyebrow={build.eyebrow}
          title={build.title}
          lead={build.lead}
        />
        <Lifecycle className="mt-12" />
      </Section>

      {/* 06 — Company & Group architecture (§59) */}
      <Section id="group" tone="surface" className="scroll-mt-28">
        <SectionHeader step="06" eyebrow={fv.group.eyebrow} title={fv.group.title} lead={fv.group.lead} />
        <ol className={cn(hairlineGrid, "mt-12 sm:grid-cols-2 lg:grid-cols-5")}>
          {fv.group.layers.map((layer, index) => (
            <li key={layer.title} className={cn(hairlineCell, "p-6")}>
              <p className="nesto-eyebrow text-fg-subtle">{String(index + 1).padStart(2, "0")}</p>
              <h3 className="mt-3 text-card font-semibold text-fg">{layer.title}</h3>
              <p className="mt-2 text-table leading-relaxed text-fg-muted">{layer.copy}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 max-w-3xl border-l-2 border-accent pl-5">
          <h3 className="text-card font-semibold text-fg">{fv.group.crossTitle}</h3>
          <p className="mt-2 text-body leading-relaxed text-fg-muted">{fv.group.crossCopy}</p>
        </div>
      </Section>

      {/* 07 — Product experience */}
      <Section id="experience" tone="canvas" className="scroll-mt-28">
        <SectionHeader
          step="07"
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

      {/* 08 — Security */}
      <Section id="security" tone="surface" className="scroll-mt-28">
        <span id="access" aria-hidden="true" />
        <SectionHeader
          step="08"
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

      {/* 09 — ROZARIS (§62) */}
      <Section id="rozaris" tone="canvas" className="scroll-mt-28">
        <SectionHeader
          step="09"
          eyebrow={fv.rozaris.eyebrow}
          title={fv.rozaris.title}
          lead={fv.rozaris.lead}
          aside={
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="secondary" size="md">
                <Link href="/pricing">
                  {fv.rozaris.pricing}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="md">
                <Link href="/?story=developer">{fv.rozaris.story}</Link>
              </Button>
            </div>
          }
        />
        <div className={cn(hairlineGrid, "mt-12 sm:grid-cols-2 lg:grid-cols-4")}>
          {fv.rozaris.items.map((item) => (
            <article key={item.title} className={cn(hairlineCell, "p-6")}>
              <h3 className="text-card font-semibold text-fg">{item.title}</h3>
              <p className="mt-2 text-table leading-relaxed text-fg-muted">{item.copy}</p>
            </article>
          ))}
        </div>
        <p className="mt-8 max-w-3xl font-serif text-section leading-snug text-fg">{fv.rozaris.principle}</p>
      </Section>

      {/* 10 — Pricing model (§63): the philosophy, never figures (§88) */}
      <Section id="pricing" tone="surface" className="scroll-mt-28">
        <SectionHeader
          step="10"
          eyebrow={fv.pricing.eyebrow}
          title={fv.pricing.title}
          lead={fv.pricing.lead}
          aside={
            <Button asChild size="md">
              <Link href="/pricing">
                {fv.pricing.cta}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
        <ol className={cn(hairlineGrid, "mt-12 grid-cols-2 lg:grid-cols-6")}>
          {fv.pricing.steps.map((item, index) => (
            <li key={item} className={cn(hairlineCell, "p-5")}>
              <p className="nesto-eyebrow text-fg-subtle">{String(index + 1).padStart(2, "0")}</p>
              <p className="mt-2 text-table font-medium text-fg">{item}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* 11 — Questions (§64) */}
      <Section id="faq" tone="canvas" bordered={false} className="scroll-mt-28">
        <SectionHeader
          step="11"
          eyebrow={fv.faq.eyebrow}
          title={fv.faq.title}
          aside={
            <Button asChild variant="secondary" size="md">
              <Link href="/faq">
                {copy.home.questions.cta}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
        <FaqList items={fv.faq.items} className="mt-12" />
      </Section>

      {/* 12 — Request access */}
      <CtaBand />
    </>
  );
}
