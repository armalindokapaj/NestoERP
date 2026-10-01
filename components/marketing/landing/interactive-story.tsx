"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";

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

/**
 * The interactive landing presentation (Landing + Full View PRD §6-§11, §40-§45,
 * §69, §76, §79-§81).
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

  if (!position) {
    return (
      <PersonaSelector
        copy={copy}
        onSelect={(persona, event) =>
          intercept(event, () => {
            trackLanding("landing_persona_selected", { persona });
            trackLanding("landing_story_started", { persona, totalSteps: LANDING_STORIES[persona].length });
            setDemo(INITIAL_DEMO_STATE);
            go({ persona, index: 0 });
          })
        }
      />
    );
  }

  const slides = LANDING_STORIES[position.persona];
  const slide = slides[position.index];
  const story = copy.stories[position.persona];
  const words = (story.slides as Record<string, { label: string; headline: string; copy: string; why: string }>)[slide.id];
  const total = slides.length;
  const isLast = position.index === total - 1;
  const number = String(position.index + 1).padStart(2, "0");
  const prev = position.index > 0 ? { persona: position.persona, index: position.index - 1 } : null;
  const next = !isLast ? { persona: position.persona, index: position.index + 1 } : null;

  return (
    <section aria-labelledby="story-heading" className="border-b border-line bg-surface" data-testid="landing-story" data-persona={position.persona} data-step={slide.id}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-8 sm:pb-14 sm:pt-8">
        {/* Progress (§11): every step on wide screens, "03 / 08" on narrow ones. */}
        <nav aria-label={copy.controls.progress}>
          <p className="nesto-eyebrow text-fg-subtle sm:hidden" data-testid="story-progress-compact">
            {fill(copy.controls.stepOf, { n: number, total: String(total).padStart(2, "0") })} · {words.label}
          </p>
          <ol className="hidden gap-1.5 sm:flex">
            {slides.map((item, index) => {
              const label = (story.slides as Record<string, { label: string }>)[item.id].label;
              const state = index < position.index ? "done" : index === position.index ? "current" : "todo";
              return (
                <li key={item.id} className="min-w-0 flex-1">
                  <a
                    href={storyHref({ persona: position.persona, index })}
                    aria-current={state === "current" ? "step" : undefined}
                    onClick={(event) => intercept(event, () => go({ persona: position.persona, index }))}
                    className="group block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span className={cn("block h-1 rounded-full transition-colors", state === "todo" ? "bg-line" : "bg-accent")} />
                    <span className={cn("mt-2 block truncate text-micro", state === "current" ? "font-semibold text-fg" : "text-fg-subtle group-hover:text-fg-muted")}>
                      {String(index + 1).padStart(2, "0")} {label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <p aria-live="polite" className="sr-only">
          {fill(copy.controls.slideAnnounce, { n: position.index + 1, total, label: words.label })}
        </p>

        <div key={`${position.persona}-${slide.id}`} className="nesto-slide mt-8 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:gap-12">
          <div className="flex min-w-0 flex-col">
            <p className="nesto-eyebrow hidden text-accent-strong sm:block">
              {number} · {words.label.toUpperCase()}
            </p>
            <h2 id="story-heading" ref={headingRef} tabIndex={-1} className="mt-3 text-balance font-serif text-page leading-tight text-fg outline-none sm:mt-4 sm:text-display">
              {words.headline}
            </h2>
            {/* On a phone the visual comes before the explanation (§79). */}
            <div className="mt-6 lg:hidden">
              <StoryVisual visual={slide.visual} slideId={slide.id} persona={position.persona} demo={demo} onDemo={(part) => setDemo((d) => ({ ...d, ...part }))} v={copy.visual} />
            </div>
            <p className="mt-6 max-w-xl text-body leading-relaxed text-fg-muted sm:text-card">{words.copy}</p>
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
                    <Link href="/contact" onClick={() => trackLanding("landing_request_access_clicked", { persona: position.persona })}>{copy.final.tertiary}</Link>
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap items-center gap-3 lg:mt-auto lg:pt-8">
              {prev ? (
                <Button asChild variant="secondary" size="lg">
                  <a href={storyHref(prev)} onClick={(event) => intercept(event, () => step(-1))} data-testid="story-back">
                    <ArrowLeft />
                    {copy.controls.back}
                  </a>
                </Button>
              ) : (
                <Button asChild variant="secondary" size="lg">
                  <Link href="/" onClick={(event) => intercept(event, () => go(null))} data-testid="story-back">
                    <ArrowLeft />
                    {copy.controls.change}
                  </Link>
                </Button>
              )}
              {next ? (
                <Button asChild size="lg">
                  <a href={storyHref(next)} onClick={(event) => intercept(event, () => step(1))} data-testid="story-next">
                    {copy.controls.next}
                    <ArrowRight />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="hidden min-w-0 lg:block">
            <StoryVisual visual={slide.visual} slideId={slide.id} persona={position.persona} demo={demo} onDemo={(part) => setDemo((d) => ({ ...d, ...part }))} v={copy.visual} />
            <p className="mt-2 text-micro text-fg-subtle">{copy.visual.illustrative}</p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-table">
          <a
            href={storyHref({ persona: position.persona, index: 0 })}
            onClick={(event) => intercept(event, () => { trackLanding("landing_story_restarted", { persona: position.persona }); setDemo(INITIAL_DEMO_STATE); go({ persona: position.persona, index: 0 }); })}
            className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg"
            data-testid="story-restart"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {copy.controls.restart}
          </a>
          <Link href="/" onClick={(event) => intercept(event, () => go(null))} className="text-fg-muted hover:text-fg" data-testid="story-change">
            {copy.controls.change}
          </Link>
          <Link href="/full-view" onClick={() => trackLanding("landing_full_view_clicked", { persona: position.persona })} className="text-fg-subtle hover:text-fg sm:ml-auto">
            {copy.controls.skip}
          </Link>
        </div>
      </div>
    </section>
  );
}

function PersonaSelector({ copy, onSelect }: { copy: LandingCopy; onSelect: (persona: LandingPersona, event: React.MouseEvent) => void }) {
  const primary = LANDING_PERSONAS.filter((persona) => persona !== "GENERIC");
  return (
    <section aria-labelledby="landing-heading" className="relative overflow-hidden border-b border-accent/25 bg-surface" data-testid="landing-personas">
      <div aria-hidden="true" className="nesto-drafting-grid absolute inset-0" />
      <div className="relative mx-auto w-full max-w-6xl px-4 pb-14 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
        <p className="nesto-rise nesto-eyebrow text-accent-strong">{copy.hero.eyebrow}</p>
        <h1 id="landing-heading" className="nesto-rise nesto-rise-2 mt-5 max-w-3xl text-balance font-serif text-page font-normal leading-[1.05] text-fg sm:text-display lg:text-hero">
          {/* Black & Gold: the closing line is the gold italic one, as in the dashboard heading. */}
          {copy.hero.headline.map((line, index, lines) => (index === lines.length - 1 && lines.length > 1
            ? <em key={line} className="block italic text-accent-strong">{line}</em>
            : <span key={line} className="block">{line}</span>))}
        </h1>
        <p className="nesto-rise nesto-rise-3 mt-6 max-w-2xl text-body leading-relaxed text-fg-muted sm:text-card">{copy.hero.lead}</p>

        <h2 className="sr-only">{copy.hero.choose}</h2>
        <ul className="nesto-rise nesto-rise-4 mt-10 grid gap-3 md:grid-cols-3">
          {primary.map((persona) => (
            <li key={persona}>
              <a
                href={storyHref({ persona, index: 0 })}
                onClick={(event) => onSelect(persona, event)}
                data-testid={`persona-${persona.toLowerCase()}`}
                className="group flex h-full flex-col rounded-xl border border-line-strong bg-surface p-5 transition-colors hover:border-accent hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="font-serif text-section font-normal text-fg">{copy.personas[persona].title}</span>
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
          onClick={(event) => onSelect("GENERIC", event)}
          data-testid="persona-generic"
          className="nesto-rise nesto-rise-5 mt-6 inline-flex items-center gap-1.5 text-body text-fg-muted hover:text-fg"
        >
          {copy.hero.explore}
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
        <p className="mt-10 max-w-2xl border-t border-line pt-5 text-table text-fg-muted">{copy.hero.principle}</p>
      </div>
    </section>
  );
}
