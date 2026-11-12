import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "@/components/icons";

import { SectionCut } from "@/components/marketing/home/section-cut";
import { InteractiveStory } from "@/components/marketing/landing/interactive-story";
import { PriceBook } from "@/components/marketing/price-book";
import { Container, Dotted, SectionBar, sectionMark } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { lifecycle, sectionFloors } from "@/config/marketing";
import { modules, moduleList } from "@/config/modules";
import { MEMBERSHIP_ROLE_KEYS } from "@/config/roles";
import { fill } from "@/lib/i18n/site";
import { getLocale, getSiteCopy, getTranslations } from "@/lib/i18n/server";
import { landingCopy } from "@/lib/i18n/site/landing";
import { parseStoryParams, storyHref } from "@/lib/marketing/landing-stories";
import { getPublicPricingConfig } from "@/lib/modules/pricing/pricing.service";
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

/** The little building beside each stage: it rises as the project does. Bottom up. */
const STAGE_DRAWINGS: Record<(typeof lifecycle)[number]["key"], ("found" | "hatch" | "dash" | "open")[]> = {
  tender: [],
  award: ["found"],
  mobilise: ["found", "hatch", "dash"],
  build: ["found", "hatch", "hatch", "hatch", "dash"],
  assure: ["found", "open", "open", "open", "open", "open", "dash"],
  handOver: ["found", "open", "open", "open", "open", "open", "open", "open"],
};

const TOWERS = {
  developer: [{ h: 120, gold: true }, { h: 90, gold: false }],
  contractor: [{ h: 60, gold: false }, { h: 110, gold: true }, { h: 80, gold: false }],
  group: [{ h: 70, gold: false }, { h: 130, gold: true }, { h: 100, gold: false }, { h: 60, gold: false }],
} as const;

const ACCESS_FILLS = ["site-fill-solid", "site-fill-hatch", "site-fill-outline", "site-fill-dash"];

/** A number in an ink square, as the lineup's cards carry it (UI-05 §9). */
const NUMBER = "inline-grid h-[22px] min-w-[26px] place-items-center bg-fg px-1.5 font-mono text-[10px] max-md:text-meta font-medium tracking-[0.06em] text-canvas";
/** A square tag: a module the stage uses. */
const TAG = "border border-line-strong px-1.5 py-0.5 font-mono text-[9.5px] max-md:text-meta font-medium uppercase tracking-[0.12em] text-fg-muted";

/**
 * The public home page (UI-05 §3).
 *
 * NESTO drawn as a building cut open, a floor per department on one
 * foundation; then "Try it here" — the interactive story, run inside an
 * illustrative NESTO window (Landing + Full View PRD §3-§12, §43); then the
 * build end to end, the three kinds of company, every rate in public, how
 * access holds, and the way in. Each after the hero is one of the page's
 * numbered sections, its bar pinning under the masthead, drawn in lines
 * (UI-05 §9).
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [locale, site, tModules, params, pricing] = await Promise.all([
    getLocale(),
    getSiteCopy(),
    getTranslations("modules"),
    searchParams,
    // Never a stale or hardcoded price when the price book cannot be read.
    getPublicPricingConfig().catch(() => null),
  ]);
  const copy = landingCopy[locale];
  const home = site.home;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const initial = parseStoryParams(one(params.story), one(params.step));
  const label = (key: keyof typeof modules) => tModules(`${key}.label`);

  const floors = sectionFloors.map((floor) => ({
    key: floor.key,
    level: typeof floor.level === "number" ? fill(home.cut.levels.level, { n: floor.level }) : home.cut.levels[floor.level],
    icon: modules[floor.modules[0]].icon,
    modules: floor.modules.map(label),
  }));

  return (
    <>
      <SectionCut
        copy={home.cut}
        floors={floors}
        figures={{ modules: moduleList.length, roles: MEMBERSHIP_ROLE_KEYS.length }}
        storyHref={storyHref({ persona: "DEVELOPER", index: 0 })}
      />

      {/* A link to a slide re-mounts the story there, so the masthead's "Follow one Unit" works from this page too. */}
      <InteractiveStory key={initial ? `${initial.persona}-${initial.index}` : "choose"} initial={initial} copy={copy} />

      {/* 02 · From the tender to the final account: six stages in lines. */}
      <section {...sectionMark(home.stages.eyebrow)} className="relative border-b border-line-strong bg-canvas">
        <SectionBar label={home.stages.eyebrow} />
        <Container className="pb-12 pt-14 lg:pb-14 lg:pt-20">
          <h2 className="max-w-4xl text-[40px] leading-[0.92] text-fg sm:text-[64px] font-display">
            {home.stages.title[0]} <span className="text-accent-strong"><Dotted>{home.stages.title[1]}</Dotted></span>
          </h2>
          <p className="nesto-standfirst mt-5 max-w-[560px] text-[19px] leading-snug sm:text-[21px]">{home.stages.lead}</p>
        </Container>
        <ol className="-mb-px grid grid-cols-2 border-t border-line-strong sm:grid-cols-3 lg:grid-cols-6">
          {lifecycle.map((stage, index) => (
            <li key={stage.key} className="flex flex-col gap-3.5 border-b border-r border-line-strong px-5 pb-7 pt-5 max-sm:even:border-r-0 sm:max-lg:[&:nth-child(3n)]:border-r-0 lg:last:border-r-0">
              <span className={cn(NUMBER, "self-start")}>{String(index + 1).padStart(2, "0")}</span>
              <span aria-hidden="true" className="flex h-[132px] flex-col-reverse items-center border-b-[3px] border-fg">
                {STAGE_DRAWINGS[stage.key].map((block, i) => (
                  <i
                    key={i}
                    className={cn(
                      "block",
                      block === "found" ? "h-3 w-20 border-[1.5px] border-dashed border-fg" : "h-3.5 w-16 border-[1.5px] border-b-0 border-fg",
                      block === "hatch" && "site-fill-hatch",
                      block === "dash" && "border-dashed",
                    )}
                  />
                ))}
              </span>
              <h3 className="text-[28px] leading-none text-fg font-display">{site.lifecycle[stage.key].title}</h3>
              <p className="text-table leading-relaxed text-fg-muted">{site.lifecycle[stage.key].copy}</p>
              <ul className="flex flex-wrap gap-1">
                {stage.modules.map((key) => (
                  <li key={key} className={TAG}>{label(key)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      {/* 03 · Three kinds of company: the lineup. */}
      <section {...sectionMark(home.kinds.eyebrow)} className="relative border-b border-line-strong bg-canvas">
        <SectionBar label={home.kinds.eyebrow} />
        <Container className="pb-12 pt-14 lg:pb-14 lg:pt-20">
          <h2 className="max-w-4xl text-[36px] leading-[0.92] text-fg sm:text-[64px] font-display"><Dotted>{home.kinds.title}</Dotted></h2>
        </Container>
        <ul className="-mb-px grid border-t border-line-strong md:grid-cols-3">
          {(["developer", "contractor", "group"] as const).map((kind, index) => {
            const words = home.kinds.items[kind];
            return (
              <li key={kind} className="border-b border-line-strong md:border-r md:last:border-r-0">
                <Link
                  href={storyHref({ persona: kind === "developer" ? "DEVELOPER" : kind === "contractor" ? "CONTRACTOR" : "GROUP", index: 0 })}
                  className="group flex h-full flex-col transition-colors hover:bg-surface"
                >
                  <span className="flex h-[52px] items-center justify-between gap-3 border-b border-line-strong px-6">
                    <span className={cn(NUMBER, index === 0 && "bg-accent text-[#0b0d10]")}>{String(index + 1).padStart(2, "0")}</span>
                    <span className="truncate font-mono text-[10px] max-md:text-meta font-medium uppercase tracking-[0.14em] text-fg-subtle">{words.meta}</span>
                  </span>
                  <span aria-hidden="true" className="site-paper flex h-[200px] items-end justify-center gap-2.5 border-b border-line-strong pb-6">
                    {TOWERS[kind].map((tower, i) => (
                      <span key={i} className={cn("block w-[46px] border-[1.5px] border-b-[3px] border-fg", tower.gold && "site-fill-gold")} style={{ height: tower.h }} />
                    ))}
                  </span>
                  <span className="flex flex-1 flex-col gap-3 px-6 pb-7 pt-6">
                    <span className="text-[40px] leading-none text-fg font-display">{words.name}</span>
                    <span className="text-body leading-relaxed text-fg-muted">{words.copy}</span>
                    <span className="mt-auto inline-flex items-center gap-1.5 pt-2 font-mono text-[11px] max-md:text-meta font-medium uppercase tracking-[0.12em] text-fg group-hover:text-accent-strong">
                      {home.kinds.follow}
                      <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 04 · Every rate, in public. */}
      <section {...sectionMark(home.prices.eyebrow)} className="relative border-b border-line-strong bg-canvas">
        <SectionBar label={home.prices.eyebrow} />
        <Container className="flex flex-col gap-10 py-14 lg:py-20">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 className="max-w-4xl text-[36px] leading-[0.92] text-fg sm:text-[64px] font-display"><Dotted>{home.prices.title}</Dotted></h2>
            <Button asChild size="lg">
              <Link href="/pricing">
                {home.prices.cta}
                <ArrowRight />
              </Link>
            </Button>
          </div>
          <PriceBook config={pricing} copy={home.prices} locale={locale} />
        </Container>
      </section>

      {/* 05 · Access: the principles, in lines. */}
      <section {...sectionMark(home.access.eyebrow)} className="relative border-b border-line-strong bg-canvas">
        <SectionBar label={home.access.eyebrow} />
        <Container className="flex flex-wrap items-end justify-between gap-6 pb-12 pt-14 lg:pb-14 lg:pt-20">
          <h2 className="max-w-4xl text-[36px] leading-[0.92] text-fg sm:text-[64px] font-display"><Dotted>{home.access.title}</Dotted></h2>
          <Link href="/security" className="inline-flex items-center gap-1.5 font-mono text-[11px] max-md:text-meta font-medium uppercase tracking-[0.12em] text-fg transition-colors hover:text-accent-strong">
            {home.access.cta}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        </Container>
        <ul className="-mb-px grid border-t border-line-strong sm:grid-cols-2">
          {home.access.items.map((item, index) => (
            <li key={item.title} className="flex flex-col gap-4 border-b border-line-strong px-[clamp(16px,4vw,48px)] pb-8 pt-6 sm:odd:border-r">
              <span className="flex items-start justify-between">
                <span className="grid size-10 place-items-center border border-line-strong">
                  <span aria-hidden="true" className={cn("size-4", ACCESS_FILLS[index % ACCESS_FILLS.length])} />
                </span>
                <span className="font-mono text-[10px] max-md:text-meta font-medium tracking-[0.14em] text-fg-subtle">{String(index + 1).padStart(2, "0")}</span>
              </span>
              <span className="text-[28px] leading-none text-fg font-display">{item.title}</span>
              <span className="max-w-[46ch] text-body leading-relaxed text-fg-muted">{item.copy}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 06 · The way in. */}
      <section {...sectionMark(site.sheet.getStarted)} className="relative bg-fg text-canvas">
        <SectionBar label={site.sheet.getStarted} tone="ink" />
        <Container className="flex flex-col items-center gap-8 py-24 text-center lg:py-32">
          <h2 className="text-[clamp(52px,7vw,112px)] leading-[0.9] font-display">
            {home.closing.title[0]}
            <br />
            <span className="text-accent"><Dotted>{home.closing.title[1]}</Dotted></span>
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="border-accent bg-accent text-[#0b0d10] hover:bg-accent/90">
              <Link href="/apply">
                {home.closing.apply}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="border border-canvas/40 text-canvas hover:bg-canvas/10 hover:text-canvas">
              <Link href="/login">{home.closing.signIn}</Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
