import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@/components/icons";

import { SectionCut } from "@/components/marketing/home/section-cut";
import { InteractiveStory } from "@/components/marketing/landing/interactive-story";
import { PriceBook } from "@/components/marketing/price-book";
import { Container, Dotted } from "@/components/marketing/section";
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

/**
 * The public home page (UI-05 §3).
 *
 * NESTO drawn as a building cut open, a floor per department on one
 * foundation; then "Try it here" — the interactive story, run inside an
 * illustrative NESTO window (Landing + Full View PRD §3-§12, §43); then the
 * build end to end, the three kinds of company, every rate in public, how
 * access holds, and the way in.
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

      {/* From the tender to the final account */}
      <section className="border-t-2 border-fg bg-canvas">
        <Container className="flex flex-col gap-11 py-20 lg:py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="nesto-eyebrow text-accent-strong">{home.stages.eyebrow}</p>
              <h2 className="mt-3 text-[40px] leading-[0.95] text-fg sm:text-[64px] font-display">
                {home.stages.title[0]}
                <br />
                <Dotted>{home.stages.title[1]}</Dotted>
              </h2>
            </div>
            <p className="nesto-standfirst max-w-[520px] text-[19px] leading-snug sm:text-[21px]">{home.stages.lead}</p>
          </div>
          <ol className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-6">
            {lifecycle.map((stage, index) => (
              <li key={stage.key} className="flex flex-col gap-3.5">
                <span aria-hidden="true" className="flex h-[150px] flex-col-reverse items-center border-b-[3px] border-fg">
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
                <span className="font-mono text-[10px] max-md:text-meta tracking-[0.12em] text-fg-subtle">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="text-[28px] leading-none text-fg font-display">{site.lifecycle[stage.key].title}</h3>
                <p className="text-table leading-relaxed text-fg-muted">{site.lifecycle[stage.key].copy}</p>
                <ul className="flex flex-wrap gap-1">
                  {stage.modules.map((key) => (
                    <li key={key} className="rounded-full border border-line-strong px-2 py-0.5 text-micro text-fg-muted">{label(key)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Three kinds of company */}
      <section className="bg-canvas">
        <Container className="flex flex-col gap-8 pb-4 pt-6 lg:pt-10">
          <div>
            <p className="nesto-eyebrow text-accent-strong">{home.kinds.eyebrow}</p>
            <h2 className="mt-3 text-[36px] leading-[0.95] text-fg sm:text-[56px] font-display"><Dotted>{home.kinds.title}</Dotted></h2>
          </div>
          <ul className="grid gap-4 md:grid-cols-3">
            {(["developer", "contractor", "group"] as const).map((kind, index) => {
              const words = home.kinds.items[kind];
              return (
                <li key={kind}>
                  <Link
                    href={storyHref({ persona: kind === "developer" ? "DEVELOPER" : kind === "contractor" ? "CONTRACTOR" : "GROUP", index: 0 })}
                    className="group flex h-full flex-col overflow-hidden rounded-[14px] border border-line bg-surface transition-shadow hover:border-line-strong hover:shadow-[var(--nesto-shadow-card)]"
                  >
                    <span aria-hidden="true" className="site-paper flex h-[180px] items-end justify-center gap-2.5 border-b border-line pb-6">
                      {TOWERS[kind].map((tower, i) => (
                        <span key={i} className={cn("block w-[46px] border-[1.5px] border-b-[3px] border-fg", tower.gold && "site-fill-gold")} style={{ height: tower.h }} />
                      ))}
                    </span>
                    <span className="flex flex-1 flex-col gap-2.5 p-5">
                      <span className="font-mono text-[10px] max-md:text-meta tracking-[0.12em] text-fg-subtle">{String(index + 1).padStart(2, "0")}</span>
                      <span className="text-[32px] leading-none text-fg font-display">{words.name}</span>
                      <span className="text-body leading-relaxed text-fg-muted">{words.copy}</span>
                      <span className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2.5">
                        <span className="font-mono text-[10px] max-md:text-meta uppercase tracking-[0.1em] text-fg-subtle">{words.meta}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] max-md:text-meta uppercase tracking-[0.1em] text-accent-strong">
                          {home.kinds.follow}
                          <ArrowRight aria-hidden="true" className="size-3 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Container>
      </section>

      {/* Every rate, in public */}
      <section className="bg-canvas">
        <Container className="flex flex-col gap-7 pt-20 lg:pt-24">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="nesto-eyebrow text-accent-strong">{home.prices.eyebrow}</p>
              <h2 className="mt-3 text-[36px] leading-[0.95] text-fg sm:text-[56px] font-display"><Dotted>{home.prices.title}</Dotted></h2>
            </div>
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

      {/* Access */}
      <section className="bg-canvas">
        <Container className="grid items-start gap-10 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12 lg:py-24">
          <div>
            <p className="nesto-eyebrow text-accent-strong">{home.access.eyebrow}</p>
            <h2 className="mt-3 text-[36px] leading-[0.95] text-fg sm:text-[56px] font-display"><Dotted>{home.access.title}</Dotted></h2>
            <Link href="/security" className="mt-6 inline-flex items-center gap-1.5 text-body font-medium text-fg underline-offset-4 hover:underline">
              {home.access.cta}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ul className="grid sm:grid-cols-2">
            {home.access.items.map((item, index) => (
              <li key={item.title} className="flex gap-4 border-t border-fg py-5 pr-5">
                <span aria-hidden="true" className={cn("size-11 shrink-0", ACCESS_FILLS[index % ACCESS_FILLS.length])} />
                <span className="flex flex-col gap-1.5">
                  <span className="text-card font-semibold text-fg">{item.title}</span>
                  <span className="text-table leading-relaxed text-fg-muted">{item.copy}</span>
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* The way in */}
      <section className="bg-fg text-canvas">
        <Container className="flex flex-wrap items-end justify-between gap-8 py-20 lg:py-24">
          <h2 className="text-[clamp(52px,6vw,92px)] leading-[0.9] font-display">
            {home.closing.title[0]}
            <br />
            <Dotted>{home.closing.title[1]}</Dotted>
          </h2>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="border-accent bg-accent text-[#0b0d10] hover:bg-accent/90">
              <Link href="/apply">
                {home.closing.apply}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="border border-canvas/30 text-canvas hover:bg-canvas/10 hover:text-canvas">
              <Link href="/login">{home.closing.signIn}</Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
