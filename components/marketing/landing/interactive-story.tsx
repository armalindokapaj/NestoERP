"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, RotateCcw } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { fill } from "@/lib/i18n/site";
import type { LandingCopy } from "@/lib/i18n/site/landing";
import {
  INITIAL_DEMO_STATE,
  LANDING_PERSONAS,
  LANDING_STORIES,
  demoStateAt,
  parseStoryParams,
  storyHref,
  trackLanding,
  type DemoState,
  type LandingPersona,
  type StoryPosition,
} from "@/lib/marketing/landing-stories";
import { cn } from "@/lib/utils/cn";

import { StoryVisual } from "./story-visuals";

/** The illustrative NESTO's Ribbon tabs, and which one each slide sits under. */
const APP_TABS = ["home", "work", "department", "company", "page"] as const;
type AppTab = (typeof APP_TABS)[number];
const SLIDE_TAB: Record<string, AppTab> = {
  company: "company", group: "company", companies: "company", people: "company", team: "company",
  project: "work", projects: "work", work: "work", site: "work",
  units: "department", rozaris: "department", sale: "department", legal: "department", finance: "department",
  procurement: "department", qaqc: "department", hse: "department", departments: "department",
  control: "home", management: "home", approval: "home", approvals: "home",
};

const slug = (name: string) => name.split(" ")[0].toLowerCase();

/**
 * "Try it here": the interactive landing presentation, run inside an
 * illustrative NESTO window under the section cut (Landing + Full View PRD
 * §6-§11, §40-§45, §69, §76, §79-§81; UI-05 §3.2).
 *
 * Every control is a real link to the slide's URL (`/?story=developer&step=units`),
 * and the server renders whichever slide the URL names — so the story reads,
 * indexes and advances without JavaScript. With it, a click becomes a
 * `pushState` instead of a page load, browser Back steps back through the
 * slides, and the arrow keys move between them. One slide, one idea, one
 * action: the only primary button during the story is "What happens next?".
 */

/** Old home-page anchors now live on the Full View (§87). */
const LEGACY_ANCHORS: Record<string, string> = {
  "#platform": "/full-view#modules",
  "#modules": "/full-view#modules",
  "#roles": "/full-view#roles",
  "#lifecycle": "/full-view#lifecycle",
  "#access": "/full-view#security",
  "#security": "/full-view#security",
  "#faq": "/full-view#faq",
};

export function InteractiveStory({ initial, copy }: { initial: StoryPosition | null; copy: LandingCopy }) {
  const [position, setPosition] = useState<StoryPosition | null>(initial);
  const [demo, setDemo] = useState<DemoState>(() => (initial ? demoStateAt(initial.persona, initial.index, INITIAL_DEMO_STATE) : INITIAL_DEMO_STATE));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    const legacy = LEGACY_ANCHORS[window.location.hash];
    if (legacy && !initial) window.location.replace(legacy);
    // A shared slide's link opens the page at the window, not at the hero above it.
    if (initial) document.getElementById("try")?.scrollIntoView({ block: "start" });
    trackLanding("landing_viewed");
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const next = parseStoryParams(params.get("story"), params.get("step"));
      moved.current = true;
      setPosition(next);
      if (next) setDemo((current) => demoStateAt(next.persona, next.index, current));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initial]);

  // Focus follows the slide, so a keyboard or screen-reader user lands on the
  // new headline rather than on a button that has moved (§81). Not on first load.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus({ preventScroll: false });
  }, [position]);

  const go = useCallback((next: StoryPosition | null, how: "push" | "replace" = "push") => {
    moved.current = true;
    const href = next ? storyHref(next) : "/";
    if (how === "push") window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
    setPosition(next);
    if (next) {
      setDemo((current) => demoStateAt(next.persona, next.index, current));
      const slides = LANDING_STORIES[next.persona];
      trackLanding("landing_story_step_viewed", { persona: next.persona, stepId: slides[next.index].id, stepNumber: next.index + 1, totalSteps: slides.length });
      if (next.index === slides.length - 1) trackLanding("landing_story_completed", { persona: next.persona, totalSteps: slides.length });
    }
  }, []);

  const step = useCallback((delta: 1 | -1) => {
    if (!position) return;
    const total = LANDING_STORIES[position.persona].length;
    const index = position.index + delta;
    if (index < 0 || index >= total) return;
    trackLanding(delta === 1 ? "landing_story_next" : "landing_story_back", { persona: position.persona, stepNumber: index + 1, totalSteps: total });
    go({ persona: position.persona, index });
  }, [go, position]);

  useEffect(() => {
    if (!position) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [position, step]);

  /** A plain click moves in place; a modified click still opens the link. */
  const intercept = (event: React.MouseEvent, action: () => void) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    action();
  };

  const start = (persona: LandingPersona, event: React.MouseEvent) =>
    intercept(event, () => {
      trackLanding("landing_persona_selected", { persona });
      trackLanding("landing_story_started", { persona, totalSteps: LANDING_STORIES[persona].length });
      setDemo(INITIAL_DEMO_STATE);
      go({ persona, index: 0 });
    });

  const [first, ...rest] = copy.hero.headline;
  const v = copy.visual;
  const company = slug(position?.persona === "CONTRACTOR" ? v.demoContractor : v.demoCompany);
  const slides = position ? LANDING_STORIES[position.persona] : null;
  const slide = position && slides ? slides[position.index] : null;
  const tab = slide ? SLIDE_TAB[slide.id] ?? "page" : "home";

  return (
    <section
      id="try"
      aria-labelledby="try-heading"
      className="scroll-mt-28 border-t-2 border-fg bg-surface"
      data-testid={position ? "landing-story" : "landing-personas"}
      data-persona={position?.persona}
      data-step={slide?.id}
    >
      <div className="mx-auto w-full max-w-[1280px] px-[clamp(16px,4vw,48px)] py-16 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="nesto-eyebrow text-accent-strong">{copy.hero.eyebrow}</p>
            <h2 id="try-heading" className="mt-3 text-balance text-[36px] leading-[0.95] text-fg sm:text-[52px] font-display">
              {first}
              {rest.map((line) => <em key={line} className="block italic text-accent-strong">{line}</em>)}
            </h2>
            <p className="nesto-standfirst mt-3 text-[19px] leading-snug">{copy.hero.lead}</p>
          </div>
          {position ? (
            <div role="group" aria-label={copy.hero.choose} className="inline-flex gap-0.5 rounded-full border border-line-strong bg-canvas p-[3px]">
              {LANDING_PERSONAS.filter((persona) => persona !== "GENERIC").map((persona) => (
                <a
                  key={persona}
                  href={storyHref({ persona, index: 0 })}
                  onClick={(event) => start(persona, event)}
                  aria-current={position.persona === persona ? "true" : undefined}
                  data-testid={`story-persona-${persona.toLowerCase()}`}
                  className={cn(
                    "inline-flex h-9 items-center whitespace-nowrap rounded-full px-4 text-table transition-colors",
                    position.persona === persona ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  {copy.personas[persona].title}
                </a>
              ))}
            </div>
          ) : null}
        </div>

        {/* The window: an illustrative NESTO, its address and its Ribbon. */}
        <div className="mt-8 overflow-hidden rounded-2xl border-[1.5px] border-fg bg-canvas shadow-[0_30px_60px_-40px_rgb(15_20_26/0.55)]">
          <div className="flex h-11 items-center gap-3 border-b border-line bg-surface px-4">
            <span aria-hidden="true" className="flex gap-1.5">
              <i className="size-2.5 rounded-full border border-line-strong" />
              <i className="size-2.5 rounded-full border border-line-strong" />
              <i className="size-2.5 rounded-full border border-line-strong" />
            </span>
            <span className="min-w-0 flex-1 truncate rounded-full bg-canvas px-3 py-1 font-mono text-[11px] max-md:text-meta text-fg-muted">
              {company}.nesto.build/{slide?.id ?? "dashboard"}
            </span>
            <span className="shrink-0 rounded-full border border-accent px-2 py-0.5 font-mono text-[10px] max-md:text-meta uppercase tracking-[0.12em] text-accent-strong">
              {copy.window.illustrative}
            </span>
          </div>
          <div aria-hidden="true" className="flex gap-0.5 overflow-hidden border-b-2 border-fg bg-surface px-3 pt-2 sm:px-5">
            {APP_TABS.map((key) => (
              <span
                key={key}
                className={cn(
                  "relative inline-flex h-9 shrink-0 items-center rounded-t-lg px-3 text-table sm:px-3.5",
                  tab === key ? "bg-canvas font-semibold text-fg after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t-[3px] after:bg-accent" : "text-fg-muted",
                  key === "page" && "max-sm:hidden",
                )}
              >
                {copy.window.tabs[key]}
              </span>
            ))}
          </div>

          {position && slides && slide ? (
            <StorySlide copy={copy} position={position} slides={slides} demo={demo} setDemo={setDemo} headingRef={headingRef} go={go} step={step} intercept={intercept} />
          ) : (
            <div className="p-5 sm:p-8">
              <h3 className="text-section text-fg font-display">{copy.hero.choose}</h3>
              <ul className="mt-5 grid gap-3 md:grid-cols-3">
                {LANDING_PERSONAS.filter((persona) => persona !== "GENERIC").map((persona) => (
                  <li key={persona}>
                    <a
                      href={storyHref({ persona, index: 0 })}
                      onClick={(event) => start(persona, event)}
                      data-testid={`persona-${persona.toLowerCase()}`}
                      className="group flex h-full flex-col rounded-xl border border-line-strong bg-surface p-5 transition-colors hover:border-accent hover:bg-row-hover"
                    >
                      <span className="text-section text-fg font-display">{copy.personas[persona].title}</span>
                      <span className="mt-2 text-table leading-relaxed text-fg-muted">{copy.personas[persona].copy}</span>
                      <span className="mt-4 inline-flex items-center gap-1.5 text-table font-medium text-fg">
                        {copy.controls.start}
                        <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              <a
                href={storyHref({ persona: "GENERIC", index: 0 })}
                onClick={(event) => start("GENERIC", event)}
                data-testid="persona-generic"
                className="mt-5 inline-flex items-center gap-1.5 text-body text-fg-muted hover:text-fg"
              >
                {copy.hero.explore}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <p className="mt-8 max-w-2xl border-t border-line pt-5 text-table text-fg-muted">{copy.hero.principle}</p>
            </div>
          )}
        </div>

        {position ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-table">
            <a
              href={storyHref({ persona: position.persona, index: 0 })}
              onClick={(event) => intercept(event, () => { trackLanding("landing_story_restarted", { persona: position.persona }); setDemo(INITIAL_DEMO_STATE); go({ persona: position.persona, index: 0 }); })}
              className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg"
              data-testid="story-restart"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {copy.controls.restart}
            </a>
            <Link href="/" scroll={false} onClick={(event) => intercept(event, () => go(null))} className="text-fg-muted hover:text-fg" data-testid="story-change">
              {copy.controls.change}
            </Link>
            <Link href="/full-view" onClick={() => trackLanding("landing_full_view_clicked", { persona: position.persona })} className="text-fg-subtle hover:text-fg sm:ml-auto">
              {copy.controls.skip}
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** One slide on the window's screen, and the step bar under it. */
function StorySlide({
  copy,
  position,
  slides,
  demo,
  setDemo,
  headingRef,
  go,
  step,
  intercept,
}: {
  copy: LandingCopy;
  position: StoryPosition;
  slides: (typeof LANDING_STORIES)[LandingPersona];
  demo: DemoState;
  setDemo: React.Dispatch<React.SetStateAction<DemoState>>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  go: (next: StoryPosition | null) => void;
  step: (delta: 1 | -1) => void;
  intercept: (event: React.MouseEvent, action: () => void) => void;
}) {
  const slide = slides[position.index];
  const story = copy.stories[position.persona];
  const labels = story.slides as Record<string, { label: string; headline: string; copy: string; why: string }>;
  const words = labels[slide.id];
  const total = slides.length;
  const isLast = position.index === total - 1;
  const number = String(position.index + 1).padStart(2, "0");
  const prev = position.index > 0 ? { persona: position.persona, index: position.index - 1 } : null;
  const next = !isLast ? { persona: position.persona, index: position.index + 1 } : null;

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {fill(copy.controls.slideAnnounce, { n: position.index + 1, total, label: words.label })}
      </p>

      {/* On a phone the visual sits between the headline and the explanation (§79). */}
      <div key={`${position.persona}-${slide.id}`} className="nesto-slide grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:grid-rows-[auto_1fr] lg:gap-x-12">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <p className="nesto-eyebrow text-accent-strong">
            {number} · {words.label.toUpperCase()}
          </p>
          <h3 id="story-heading" ref={headingRef} tabIndex={-1} className="mt-3 text-balance text-[30px] leading-[1.02] text-fg outline-none sm:text-[40px] font-display">
            {words.headline}
          </h3>
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1" data-testid="story-visual">
          <StoryVisual visual={slide.visual} slideId={slide.id} persona={position.persona} demo={demo} onDemo={(part) => setDemo((d) => ({ ...d, ...part }))} v={copy.visual} />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <p className="max-w-xl text-body leading-relaxed text-fg-muted sm:text-card">{words.copy}</p>
          <div className="mt-6 max-w-xl border-l-2 border-accent pl-4">
            <p className="nesto-eyebrow text-fg-subtle">{copy.controls.why}</p>
            <p className="mt-2 text-body font-medium text-fg">{words.why}</p>
          </div>
          {isLast ? (
            <div className="mt-8" data-testid="story-final">
              <p className="text-body font-medium text-fg">{copy.final.done}</p>
              <p className="mt-2 text-table text-fg-muted">{story.summary.join(" → ")}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/pricing" onClick={() => trackLanding("landing_pricing_clicked", { persona: position.persona })}>
                    {copy.final.primary}
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href="/full-view" onClick={() => trackLanding("landing_full_view_clicked", { persona: position.persona })}>{copy.final.secondary}</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/apply" onClick={() => trackLanding("landing_request_access_clicked", { persona: position.persona })}>{copy.final.tertiary}</Link>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* The step bar (§11): every step on wide screens, "03 / 08" on narrow ones. */}
      <div className="flex flex-wrap items-center gap-4 border-t border-line bg-surface px-5 py-4 sm:px-8">
        <nav aria-label={copy.controls.progress} className="w-full min-w-0 md:w-auto md:flex-1">
          <p className="nesto-eyebrow text-fg-subtle md:hidden" data-testid="story-progress-compact">
            {fill(copy.controls.stepOf, { n: number, total: String(total).padStart(2, "0") })} · {words.label}
          </p>
          <ol className="hidden gap-1.5 md:flex">
            {slides.map((item, index) => {
              const state = index < position.index ? "done" : index === position.index ? "current" : "todo";
              return (
                <li key={item.id} className="min-w-0 flex-1">
                  <a
                    href={storyHref({ persona: position.persona, index })}
                    aria-current={state === "current" ? "step" : undefined}
                    onClick={(event) => intercept(event, () => go({ persona: position.persona, index }))}
                    className="group block rounded-sm"
                  >
                    <span className={cn("block h-1 rounded-full transition-colors", state === "todo" ? "bg-line" : "bg-accent")} />
                    <span className={cn("mt-2 block truncate text-micro", state === "current" ? "font-semibold text-fg" : "text-fg-subtle group-hover:text-fg-muted")}>
                      {String(index + 1).padStart(2, "0")} {labels[item.id].label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {prev ? (
            <Button asChild variant="secondary">
              <a href={storyHref(prev)} onClick={(event) => intercept(event, () => step(-1))} data-testid="story-back">
                <ArrowLeft />
                {copy.controls.back}
              </a>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href="/" scroll={false} onClick={(event) => intercept(event, () => go(null))} data-testid="story-back">
                <ArrowLeft />
                {copy.controls.change}
              </Link>
            </Button>
          )}
          {next ? (
            <Button asChild>
              <a href={storyHref(next)} onClick={(event) => intercept(event, () => step(1))} data-testid="story-next">
                {copy.controls.next}
                <ArrowRight />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
