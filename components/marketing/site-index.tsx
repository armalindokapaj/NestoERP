"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { fill, type SiteCopy } from "@/lib/i18n/site";
import { cn } from "@/lib/utils/cn";

/**
 * The page's index and ruler (UI-05 §9), from getartcraft.com in Nesto's type
 * and gold.
 *
 * From xl, two columns stand at the right edge, the page's content never
 * running under them:
 * - the index rail, like a drawing's title block: where you are, large, with
 *   the way back above it; the sheet number; what is next, at the foot;
 * - the 0–100 ruler: a tick every point, a number every 5, the gold line where
 *   you are. Click it to go to that point.
 * Below xl, a 2px gold line under the masthead says how far through the page
 * you are, and each section's bar says which of how many it is (02 / 05):
 * a tap on that count drops the page's sections from the bar, in the rail's
 * capitals, the one you are in marked Here.
 *
 * The sections are the page's own (`sectionMark`, components/marketing/section.tsx),
 * read after each navigation; nothing here lists them.
 */
const MASTHEAD = 64;
/** A section is where you are once its top is this close to the masthead. */
const REACHED = 140;

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function SiteIndex({ copy }: { copy: SiteCopy["sheet"] }) {
  const pathname = usePathname();
  const [labels, setLabels] = React.useState<string[]>([]);
  const [active, setActive] = React.useState(-1);
  const [pct, setPct] = React.useState(0);
  const [list, setList] = React.useState<{ top: number; opener: HTMLElement } | null>(null);
  const sections = React.useRef<HTMLElement[]>([]);

  // The page's sections, after each navigation. The bars learn the total for their count.
  React.useEffect(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>("[data-site-section]"));
    sections.current = found;
    setLabels(found.map((element) => element.dataset.siteIndex || element.dataset.siteSection || ""));
    // Each bar's count is a button that opens the list below; it is named here, where the copy is.
    for (const button of document.querySelectorAll<HTMLElement>("[data-site-sections-open]")) button.setAttribute("aria-label", copy.sections);
    setList(null);
    const sheet = document.querySelector<HTMLElement>(".site-sheet");
    if (!sheet) return;
    if (found.length > 0) {
      sheet.dataset.siteTotal = "";
      sheet.style.setProperty("--site-total", `"${String(found.length).padStart(2, "0")}"`);
    } else {
      delete sheet.dataset.siteTotal;
      sheet.style.removeProperty("--site-total");
    }
  }, [pathname, copy.sections]);

  React.useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setPct(Math.min(1, Math.max(0, window.scrollY / max)));
      let reached = -1;
      sections.current.forEach((element, index) => {
        if (element.getBoundingClientRect().top <= MASTHEAD + REACHED) reached = index;
      });
      setActive(reached);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [labels]);

  // A tap on any bar's count opens the list under that bar; Escape, a tap beside it or a choice closes it.
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const opener = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-site-sections-open]");
      if (!opener) return;
      setList((current) => (current ? null : { top: opener.closest(".site-bar")?.getBoundingClientRect().bottom ?? opener.getBoundingClientRect().bottom, opener }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  React.useEffect(() => {
    if (!list) return;
    const close = () => setList(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      list.opener.focus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [list]);

  const go = (index: number) => {
    const top = index < 0 ? 0 : (sections.current[index]?.getBoundingClientRect().top ?? 0) + window.scrollY - MASTHEAD;
    window.scrollTo({ top, behavior: scrollBehavior() });
  };

  const jump = (event: React.MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientY - box.top - 18) / (box.height - 36)));
    window.scrollTo({ top: share * (document.documentElement.scrollHeight - window.innerHeight), behavior: scrollBehavior() });
  };

  const percent = Math.round(pct * 100);
  const past = active >= 0 ? [{ label: copy.top, index: -1 }, ...labels.slice(0, active).map((label, index) => ({ label, index }))] : [];
  const now = active >= 0 ? { label: labels[active] ?? "", index: active } : { label: copy.top, index: -1 };
  const next = labels.map((label, index) => ({ label, index })).slice(active + 1);
  const total = String(labels.length).padStart(2, "0");
  const item = "text-right font-display uppercase leading-[1.02] tracking-[0.01em] text-fg-subtle transition-colors hover:text-accent-strong";
  // A long page lists more of what is next, in a smaller size.
  const nextSize = labels.length > 7 ? "text-[15px]" : "text-[18px]";

  return (
    <>
      {/* Below xl: how far through the page, under the masthead (at the very top while it is away, styles/globals.css). */}
      <div aria-hidden="true" data-site-progress="" className="pointer-events-none fixed inset-x-0 z-30 h-0.5 transition-[top] duration-200 xl:hidden">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>

      {/* Below xl: the page's sections, dropped from the bar whose count was tapped. */}
      {list ? (
        <>
          <button type="button" tabIndex={-1} aria-label={copy.close} onClick={() => setList(null)} className="fixed inset-x-0 bottom-0 z-30 bg-[rgb(15_20_26/0.28)] xl:hidden" style={{ top: list.top }} />
          <nav aria-label={copy.sections} data-testid="site-sections" className="fixed inset-x-0 z-30 border-b border-line-strong xl:hidden" style={{ top: list.top }}>
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/86 backdrop-blur-[16px] backdrop-saturate-[1.3]" />
            <p className="flex h-11 items-center justify-between border-b border-line-strong px-4 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg-subtle sm:px-6">
              <span>{copy.sections}</span>
              <span className="text-fg">{String(percent).padStart(3, "0")} %</span>
            </p>
            <ol className="max-h-[60dvh] overflow-y-auto overscroll-contain">
              {[{ label: copy.top, index: -1 }, ...labels.map((label, index) => ({ label, index }))].map((entry) => {
                const current = entry.index === active;
                return (
                  <li key={`${entry.index}-${entry.label}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setList(null);
                        go(entry.index);
                      }}
                      aria-current={current ? "location" : undefined}
                      className="grid min-h-14 w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center border-b border-line px-4 text-left transition-colors hover:bg-hover sm:px-6"
                    >
                      <span className={cn("grid h-6 min-w-7 place-items-center justify-self-start px-1.5 font-mono text-meta font-medium", current ? "bg-accent text-[#0b0d10]" : "bg-fg text-canvas")}>{String(entry.index + 1).padStart(2, "0")}</span>
                      <span className={cn("truncate font-display text-[1.625rem] uppercase leading-none tracking-[0.01em]", current ? "text-fg" : entry.index < active ? "text-fg-subtle" : "text-fg-muted")}>{entry.label}</span>
                      {current ? <span className="font-mono text-meta font-medium uppercase tracking-[0.12em] text-accent-strong">{copy.here}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </>
      ) : null}

      {/* From xl: the index rail. */}
      <nav
        aria-label={copy.sections}
        data-testid="site-index"
        className="fixed bottom-0 right-14 top-16 z-20 hidden w-[168px] flex-col justify-between border-l border-line-strong bg-canvas xl:flex"
      >
        <div className="flex flex-col items-end gap-0.5 px-5 pt-5 text-right">
          {past.map((entry) => (
            <button key={`${entry.index}-${entry.label}`} type="button" onClick={() => go(entry.index)} className={cn(item, "text-[14px]")}>
              {entry.label}
            </button>
          ))}
          <button type="button" onClick={() => go(now.index)} aria-current="location" className={cn(item, "mt-1.5 text-[30px] leading-[0.96] text-fg")}>
            {now.label}
          </button>
        </div>
        <div>
          <p className="mb-3 flex justify-between border-y border-line-strong px-5 py-2.5 font-mono text-[10px] max-md:text-meta font-medium uppercase tracking-[0.14em] text-fg-subtle">
            <span>{copy.sheet}</span>
            <span className="text-fg">{String(active + 1).padStart(2, "0")} / {total}</span>
          </p>
          <div className="flex flex-col items-end px-5 pb-6 text-right">
            {next.map((entry) => (
              <button key={`${entry.index}-${entry.label}`} type="button" onClick={() => go(entry.index)} className={cn(item, nextSize)}>
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* From xl: the 0–100 ruler. */}
      <button
        type="button"
        onClick={jump}
        aria-label={fill(copy.ruler, { n: percent })}
        data-testid="site-ruler"
        className="fixed bottom-0 right-0 top-16 z-20 hidden w-14 cursor-crosshair border-l border-line-strong bg-canvas xl:block"
      >
        <span aria-hidden="true" className="absolute inset-x-0 bottom-[18px] top-[18px]">
          {Array.from({ length: 101 }, (_, n) => (
            <span key={n} className={cn("absolute right-0 h-px", n % 5 === 0 ? "w-4 bg-fg" : "w-1.5 bg-line-strong")} style={{ top: `${n}%` }}>
              {n % 5 === 0 ? <b className="absolute -top-1.5 right-[22px] font-mono text-[9px] max-md:text-meta font-medium tracking-[0.06em] text-fg-subtle">{n}</b> : null}
            </span>
          ))}
          <span className="absolute inset-x-0 h-px bg-accent" style={{ top: `${pct * 100}%` }}>
            <b className={cn("absolute right-1 bg-canvas px-0.5 font-mono text-[9.5px] max-md:text-meta font-medium tracking-[0.06em] text-accent-strong", pct > 0.9 ? "-top-4" : "top-[3px]")}>
              {String(percent).padStart(3, "0")} %
            </b>
          </span>
        </span>
      </button>
    </>
  );
}
