"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, PlayCircle } from "@/components/icons";

import { getIcon } from "@/components/layout/nav-icon";
import { Button } from "@/components/ui/button";
import type { SectionFloorKey } from "@/config/marketing";
import type { SiteCopy } from "@/lib/i18n/site";
import { cn } from "@/lib/utils/cn";

export type CutFloor = { key: SectionFloorKey; level: string; icon: string; modules: string[] };

/** Three columns, the same in every row: the floor's name, its leader line, the slab. */
const columns = "grid grid-cols-[108px_12px_minmax(0,1fr)] sm:grid-cols-[132px_16px_minmax(0,1fr)]";

/**
 * The home page's hero: NESTO drawn as a building cut open (UI-05 §3.1).
 *
 * A floor for every department, all of them standing on one foundation — the
 * project record. Each floor is a toggle; the one picked opens its sheet
 * beside the drawing. Without JavaScript the drawing still reads, and the
 * sheet shows Procurement.
 */
export function SectionCut({
  copy,
  floors,
  figures,
  storyHref,
}: {
  copy: SiteCopy["home"]["cut"];
  floors: CutFloor[];
  figures: { modules: number; roles: number };
  storyHref: string;
}) {
  const [picked, setPicked] = useState<SectionFloorKey>("procurement");
  const floor = floors.find((item) => item.key === picked) ?? floors[0];
  const words = copy.floors[floor.key];
  const Icon = getIcon(floor.icon);

  return (
    <section className="bg-canvas" data-testid="section-cut">
      <div className="mx-auto grid w-full max-w-[1280px] items-start gap-10 px-[clamp(16px,4vw,48px)] pb-20 pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:pb-24 lg:pt-12">
        <div className="flex flex-col gap-7 lg:pt-10">
          <p className="nesto-eyebrow text-accent-strong">{copy.eyebrow}</p>
          <h1 className="text-[clamp(52px,6.6vw,104px)] leading-[0.88] text-fg font-display">
            {copy.headline}
            <br />
            <span className="whitespace-nowrap">
              <span className="site-outline">{copy.outline}</span>
              <span aria-hidden="true" className="site-dot" />
            </span>
          </h1>
          <p className="nesto-standfirst text-[19px] leading-snug sm:text-[23px]">{copy.lead}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/apply">
                {copy.apply}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href={storyHref} scroll={false}>
                <PlayCircle />
                {copy.story}
              </Link>
            </Button>
          </div>
          <dl className="grid grid-cols-3 gap-5 pt-2">
            {[
              [figures.modules, copy.figures.modules],
              [figures.roles, copy.figures.roles],
              [1, copy.figures.foundation],
            ].map(([figure, label]) => (
              <div key={label} className="flex flex-col-reverse gap-1.5 border-t border-line pt-3.5">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">{label}</dt>
                <dd className="text-[48px] leading-[0.85] tabular-nums text-fg font-display">{figure}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="site-paper relative flex flex-col overflow-hidden border-[1.5px] border-fg px-4 pt-5 sm:px-7 sm:pt-7">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">{copy.drawing}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-subtle">{copy.pick}</span>
          </div>

          <div className="mt-2 flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-5">
            <div className="w-full min-w-0 max-w-[440px] xl:flex-1">
              {/* The crane, drawn over the slab column. */}
              <div aria-hidden="true" className={columns}>
                <span />
                <span />
                <svg viewBox="0 0 250 96" className="block h-auto w-full text-fg">
                  <g fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M150 96V8M166 96V8" />
                    <path d="M150 20l16 16M166 20l-16 16M150 44l16 16M166 44l-16 16M150 68l16 16M166 68l-16 16" />
                    <path d="M40 8H246M60 20H166M158 0V8M120 8L158 0L200 8" />
                    <path d="M220 8V40" strokeDasharray="3 3" />
                  </g>
                  <rect x="212" y="40" width="16" height="12" fill="currentColor" />
                  <rect x="60" y="9" width="24" height="10" className="fill-accent" />
                </svg>
              </div>

              <div role="group" aria-label={copy.floorsLabel} className="flex flex-col">
                {floors.map((item) => {
                  const on = item.key === picked;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked(item.key)}
                      data-testid={`floor-${item.key}`}
                      className={cn("site-floor h-[46px] w-full items-stretch text-left text-fg", columns)}
                    >
                      <span className={cn("flex flex-col items-end justify-center gap-px pr-2.5 text-table font-medium whitespace-nowrap", on && "text-accent-strong")}>
                        <span className="max-w-full truncate">{copy.floors[item.key].name}</span>
                        <span className="font-mono text-[9px] tracking-[0.1em] text-fg-subtle">{item.level}</span>
                      </span>
                      <span aria-hidden="true" className={cn("mb-[22px] border-b", on ? "border-accent" : "border-control")} />
                      <span aria-hidden="true" className="site-slab" />
                    </button>
                  );
                })}
              </div>

              {/* Ground, foundation and piles: the project record everything stands on. */}
              <div aria-hidden="true" className={columns}>
                <span />
                <span />
                <span className="relative -mx-6 h-[70px] border-t-[3px] border-fg bg-[repeating-linear-gradient(-45deg,var(--nesto-border-strong)_0_1px,transparent_1px_7px)]">
                  <span className="absolute inset-x-6 top-0 h-[30px] border-2 border-t-0 border-accent bg-accent-soft" />
                  <span className="absolute left-[16%] top-[30px] h-10 border-l-2 border-accent" />
                  <span className="absolute left-1/2 top-[30px] h-10 border-l-2 border-accent" />
                  <span className="absolute right-[16%] top-[30px] h-10 border-l-2 border-accent" />
                </span>
              </div>
              <div className={cn(columns, "pb-5 pt-1")}>
                <span className="pr-2.5 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-accent-strong">{copy.foundation}</span>
                <span />
                <span className="text-table font-medium text-accent-strong">{copy.foundationLine}</span>
              </div>
            </div>

            {/* The floor's sheet. */}
            <article aria-live="polite" className="mb-6 flex flex-col gap-3 rounded-xl border border-line-strong bg-surface p-5 shadow-[0_18px_40px_-24px_rgb(15_20_26/0.45)] xl:mt-24 xl:w-[232px] xl:shrink-0" data-testid="floor-sheet">
              <span className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent-strong">
                  {floor.level} · {copy.sheet}
                </span>
                <Icon aria-hidden="true" className="size-6 text-accent-strong" />
              </span>
              <p className="text-[34px] leading-none text-fg font-display">{words.name}</p>
              <p className="nesto-standfirst text-card leading-snug">{words.line}</p>
              <ul className="flex flex-col gap-2 border-t border-line pt-3">
                {words.points.map((point) => (
                  <li key={point} className="flex gap-2 text-table text-fg">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-strong" />
                    {point}
                  </li>
                ))}
              </ul>
              <ul className="flex flex-wrap gap-1">
                {floor.modules.map((label) => (
                  <li key={label} className="rounded-full border border-line-strong px-2 py-0.5 text-micro text-fg-muted">
                    {label}
                  </li>
                ))}
              </ul>
              <Button asChild size="sm" variant="secondary" className="self-start">
                <Link href="/full-view#modules">
                  {copy.open}
                  <ArrowRight />
                </Link>
              </Button>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
