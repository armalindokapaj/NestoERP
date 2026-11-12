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
 * you are, and each section's bar says which of how many it is (02 / 05).
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
  const sections = React.useRef<HTMLElement[]>([]);

  // The page's sections, after each navigation. The bars learn the total for their count.
  React.useEffect(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>("[data-site-section]"));
    sections.current = found;
    setLabels(found.map((element) => element.dataset.siteIndex || element.dataset.siteSection || ""));
    const sheet = document.querySelector<HTMLElement>(".site-sheet");
    if (!sheet) return;
    if (found.length > 0) {
      sheet.dataset.siteTotal = "";
      sheet.style.setProperty("--site-total", `"${String(found.length).padStart(2, "0")}"`);
    } else {
      delete sheet.dataset.siteTotal;
      sheet.style.removeProperty("--site-total");
    }
  }, [pathname]);

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
      {/* Below xl: how far through the page, under the masthead. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-16 z-30 h-0.5 xl:hidden">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>

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
            <b className={cn("absolute right-1 bg-canvas px-0.5 font-mono text-[9.5px] max-md:text-meta font-semibold tracking-[0.06em] text-accent-strong", pct > 0.9 ? "-top-4" : "top-[3px]")}>
              {String(percent).padStart(3, "0")} %
            </b>
          </span>
        </span>
      </button>
    </>
  );
}
