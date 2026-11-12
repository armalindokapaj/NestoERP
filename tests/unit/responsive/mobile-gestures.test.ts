import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

import { MainAction, MobileActionBar } from "@/components/ui/mobile-action-bar";
import { StickyActions } from "@/components/ui/sticky";
import { SwipeAction, SwipeActions } from "@/components/ui/swipe-actions";
import {
  FLICK_VELOCITY,
  lockAxis,
  pullDistance,
  pullProgress,
  PULL_MAX,
  PULL_THRESHOLD,
  swipeOffset,
  swipeSettlesOpen,
} from "@/lib/ui/gestures";

/**
 * The phone and tablet audit, stage 5: swipe to reveal a card's actions (5a),
 * the bottom action bar (5b) and pull to refresh (5c). The gesture arithmetic
 * is pure and tested here; the markup is rendered as the server sends it; the
 * stylesheet rules are read, and one real Tailwind build proves the classes
 * the components use exist and sit where they should.
 */

const ROOT = process.cwd();
const css = (file: string) => readFileSync(join(ROOT, "styles", file), "utf8");
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const require = createRequire(import.meta.url);

async function build(candidates: string[]): Promise<string> {
  const compiler = await compile(css("globals.css"), {
    base: join(ROOT, "styles"),
    async loadStylesheet(id: string, base: string) {
      const path = id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

describe("axis lock", () => {
  it("decides nothing inside the slop", () => {
    expect(lockAxis(3, 4)).toBeNull();
    expect(lockAxis(-7, 7)).toBeNull();
  });

  it("is a swipe only when clearly sideways; a diagonal is a scroll", () => {
    expect(lockAxis(-30, 4)).toBe("x");
    expect(lockAxis(20, 19)).toBe("y");
    expect(lockAxis(2, 40)).toBe("y");
  });
});

describe("a swiped card", () => {
  const width = 152;

  it("follows the finger between closed and open", () => {
    expect(swipeOffset(0, -60, width)).toBe(-60);
    expect(swipeOffset(-width, 40, width)).toBe(-112);
  });

  it("resists past either end instead of running on", () => {
    expect(swipeOffset(0, 50, width)).toBeCloseTo(10);
    expect(swipeOffset(0, -width - 100, width)).toBeCloseTo(-width - 20);
  });

  it("stays open past half its actions, or on a flick left; a flick right closes it", () => {
    expect(swipeSettlesOpen(-80, 0, width)).toBe(true);
    expect(swipeSettlesOpen(-70, 0, width)).toBe(false);
    expect(swipeSettlesOpen(-20, -FLICK_VELOCITY, width)).toBe(true);
    expect(swipeSettlesOpen(-140, FLICK_VELOCITY, width)).toBe(false);
  });

  it("never opens with nothing to reveal", () => {
    expect(swipeSettlesOpen(-80, -1, 0)).toBe(false);
  });
});

describe("pull to refresh", () => {
  it("does nothing for a push up", () => {
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(0)).toBe(0);
  });

  it("moves at half the finger's pace, then eases towards its cap without passing it", () => {
    expect(pullDistance(60)).toBe(30);
    const far = pullDistance(2000);
    expect(far).toBeLessThanOrEqual(PULL_MAX);
    expect(far).toBeGreaterThan(PULL_MAX * 0.95);
    expect(pullDistance(400)).toBeGreaterThan(pullDistance(300));
  });

  it("is armed once the indicator reaches the threshold, which a deliberate pull reaches", () => {
    expect(pullProgress(PULL_THRESHOLD / 2)).toBe(0.5);
    expect(pullProgress(PULL_THRESHOLD * 3)).toBe(1);
    expect(pullDistance(PULL_THRESHOLD * 2)).toBeGreaterThanOrEqual(PULL_THRESHOLD);
    expect(pullDistance(PULL_THRESHOLD)).toBeLessThan(PULL_THRESHOLD);
  });
});

describe("a page's actions on a phone (5b, docs/ui/UI-04-navigation-layouts.md §Phone)", () => {
  it("a form's actions are its last row at every width, the buttons sharing it on a phone: nothing floats over the bar", () => {
    const out = html(React.createElement(StickyActions, { className: "justify-start" }, "Save"));
    expect(out).toContain('data-form-actions=""');
    expect(out).toContain("py-3");
    expect(out).toContain("justify-start");
    expect(out).toContain("max-md:[&amp;&gt;button]:flex-1");
    expect(out).not.toContain("sticky");
    expect(out).not.toContain("data-mobile-action-bar");
    expect(out).not.toContain("data-sticky-action-bar");
    expect(html(React.createElement(MobileActionBar, null, "Save"))).toContain("justify-end");
  });

  it("a main action is drawn where it sits, beside the page's title, at every width", () => {
    const out = html(React.createElement(MainAction, null, React.createElement("button", null, "Complete")));
    expect(out).toBe('<div data-main-action="" class="contents"><button>Complete</button></div>');
  });

  it("the page keeps room for the phone's bar, and from lg the Create dial; only a hand-made bar sends the bar away", () => {
    const globals = css("globals.css");
    expect(globals).not.toContain("--nesto-action-bar");
    expect(globals).not.toContain("--nesto-keyboard-inset");
    expect(globals).toMatch(/padding-bottom: calc\(max\(var\(--nesto-space-page-y-end\), var\(--nesto-safe-bottom\)\) \+ var\(--nesto-bottom-nav-space, 0px\) \+ var\(--nesto-dial-space, 0px\)\);/);
    expect(globals).toContain("scroll-padding-bottom: calc(var(--nesto-bottom-reserve, 0px) + var(--nesto-dial-space, 0px));");
    expect(globals).toMatch(/@media \(min-width: 1024px\) \{\s*html:has\(\[data-create-dial\]\) \{\s*--nesto-dial-space: 6\.5rem;/);
    expect(globals).toMatch(/html:has\(\[data-mobile-bottom-nav\]\) \{\s*\/\*[^*]*\*\/\s*--nesto-bottom-nav-space: calc\(4rem \+ var\(--nesto-safe-bottom\)\);/);
    expect(globals).toMatch(/html:has\(\[data-sticky-action-bar\]\) \[data-mobile-bottom-nav\]/);
  });

  it("the classes the form's row uses exist, only below md", async () => {
    const out = await build(["max-md:[&>button]:flex-1", "max-md:[&>span:empty]:hidden", "py-3"]);
    expect(out).toMatch(/@media \(width < 768px\) \{\s*\.max-md\\:\\\[\\&\\>button\\\]\\:flex-1 > button \{\s*flex: 1;/);
    expect(out).toMatch(/\.max-md\\:\\\[\\&\\>span\\:empty\\\]\\:hidden > span:empty \{\s*display: none;/);
  });
});

describe("swipe to reveal (5a)", () => {
  it("sends the card as it is: no actions in the page until a phone has said so", () => {
    const action = React.createElement(SwipeAction, { label: "Complete", icon: null, onAction: () => undefined });
    // Children go in as createElement's third argument; the cast only lets TypeScript see them there.
    const Swipe = SwipeActions as unknown as React.FC<{ actions?: React.ReactNode; contentClassName?: string; children?: React.ReactNode }>;
    const out = html(React.createElement(Swipe, { actions: action, contentClassName: "p-4" }, "Card"));
    expect(out).not.toContain("data-swipe-panel");
    expect(out).not.toContain("Complete");
    expect(out).toContain("Card");
    // The browser keeps vertical panning on the card only once the swipe is live.
    expect(out).not.toContain("touch-pan-y");
  });

  it("lets the browser keep vertical panning and pinch zoom on a swipeable card", async () => {
    const out = await build(["touch-pan-y", "touch-pinch-zoom"]);
    expect(out).toContain("--tw-pan-y: pan-y");
    expect(out).toContain("--tw-pinch-zoom: pinch-zoom");
  });
});

describe("pull to refresh replaces the browser's (5c)", () => {
  it("turns the browser's own off on a phone, and in the native shell", () => {
    const globals = css("globals.css");
    expect(globals).toMatch(/@media \(max-width: 767\.98px\) \{\s*html,\s*body \{\s*overscroll-behavior-y: none;/);
    expect(globals).toMatch(/html\[data-pull-refresh\],\s*html\[data-pull-refresh\] body \{\s*overscroll-behavior-y: none;/);
  });
});
