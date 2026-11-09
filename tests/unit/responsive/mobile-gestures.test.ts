import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

import { MainAction, MobileActionBar, MobileActionBarProvider } from "@/components/ui/mobile-action-bar";
import { StickyActions } from "@/components/ui/sticky";
import { SwipeAction, SwipeActions } from "@/components/ui/swipe-actions";
import {
  FLICK_VELOCITY,
  keyboardInset,
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

describe("the keyboard inset", () => {
  it("is the keyboard's height where it overlays the page (iOS)", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336);
    expect(keyboardInset(844, { height: 508, offsetTop: 40, scale: 1 })).toBe(296);
  });

  it("is nothing where the keyboard resizes the page (Android, the native shell), for toolbar movement, or while zoomed", () => {
    expect(keyboardInset(508, { height: 508, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(844, { height: 790, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(844, { height: 422, offsetTop: 0, scale: 2 })).toBe(0);
  });
});

describe("the bottom action bar (5b)", () => {
  it("a form's bar is the shared bar, sticky above the bottom navigation on a phone and the footer row from md", () => {
    const out = html(React.createElement(StickyActions, { className: "justify-start", "data-form-actions": true } as React.ComponentProps<"div">, "Save"));
    expect(out).toContain('data-mobile-action-bar="flow"');
    expect(out).toContain("max-md:sticky");
    expect(out).toContain("max-md:bottom-[calc(var(--nesto-action-bar-bottom)+var(--nesto-action-bar-room))]");
    expect(out).toContain("md:py-3");
    expect(out).toContain("justify-start");
    // No longer a hand-made bar: the bottom navigation is not told to step aside.
    expect(out).not.toContain("data-sticky-action-bar");
    expect(html(React.createElement(MobileActionBar, null, "Save"))).toContain("justify-end");
  });

  it("a main action is drawn where it sits, with no box, outside the shell at every width", () => {
    const out = html(React.createElement(MainAction, null, React.createElement("button", null, "Complete")));
    expect(out).toBe('<div data-main-action="" class="contents"><button>Complete</button></div>');
  });

  it("in the shell, a main action waits hidden below md until it can move into the bar: drawn once, never copied", () => {
    const out = html(React.createElement(MobileActionBarProvider, null, React.createElement(MainAction, null, React.createElement("button", null, "Complete"))));
    expect(out).toBe('<div data-main-action="" class="contents max-md:hidden"><button>Complete</button></div>');
  });

  it("sits above the bottom navigation, rides above the keyboard, and the page keeps room for a pinned bar", () => {
    const globals = css("globals.css");
    expect(globals).toMatch(/--nesto-action-bar-bottom:\s*calc\(max\(calc\(var\(--nesto-safe-bottom\) \+ 0\.5rem\), calc\(var\(--nesto-bottom-nav-space\) - 0\.875rem\)\) \+ var\(--nesto-keyboard-inset\)\)/);
    expect(globals).toMatch(/html:has\(\[data-mobile-action-bar="pinned"\]:not\(:empty\)\) \{\s*--nesto-action-bar-room:/);
    expect(globals).toMatch(/padding-bottom: calc\([^;]*var\(--nesto-action-bar-room, 0px\)\)/);
    expect(globals).toMatch(/scroll-padding-bottom: calc\(var\(--nesto-bottom-reserve, 0px\) \+ var\(--nesto-action-bar-space, 0px\)\)/);
    // The shared bar never hides the bottom navigation; only a hand-made bar does.
    expect(globals).not.toMatch(/\[data-mobile-action-bar[^\]]*\]\) \[data-mobile-bottom-nav\]/);
    expect(globals).toMatch(/html:has\(\[data-sticky-action-bar\]\) \[data-mobile-bottom-nav\]/);
  });

  it("while typing, the pinned bar is hidden by a rule outside every layer, so its own flex cannot win", async () => {
    const out = await build(["flex"]);
    // Walk the built sheet: the rule's enclosing blocks, from the outside in.
    const stack: string[] = [];
    let start = 0;
    let enclosing: string[] | null = null;
    for (let index = 0; index < out.length && !enclosing; index += 1) {
      const char = out[index];
      if (char === "{") {
        const prelude = out.slice(start, index).trim();
        if (prelude.includes('[data-mobile-action-bar="pinned"]') && out.slice(index, out.indexOf("}", index)).includes("display: none")) enclosing = [...stack];
        stack.push(prelude);
        start = index + 1;
      } else if (char === "}") {
        stack.pop();
        start = index + 1;
      } else if (char === ";") {
        start = index + 1;
      }
    }
    expect(enclosing, "the typing rule is in the build").not.toBeNull();
    expect(enclosing!.some((prelude) => prelude.startsWith("@layer"))).toBe(false);
    expect(enclosing!.some((prelude) => prelude.includes("767.98px"))).toBe(true);
  });

  it("the classes the bar uses exist, and its phone slab only below md", async () => {
    const out = await build([
      "bottom-(--nesto-action-bar-bottom)",
      "z-(--nesto-z-shell-tabs)",
      "max-md:sticky",
      "max-md:bottom-[calc(var(--nesto-action-bar-bottom)+var(--nesto-action-bar-room))]",
      "max-md:[&>span:empty]:hidden",
      "md:py-3",
    ]);
    expect(out).toContain("bottom: var(--nesto-action-bar-bottom)");
    expect(out).toContain("z-index: var(--nesto-z-shell-tabs)");
    expect(out).toContain("bottom: calc(var(--nesto-action-bar-bottom) + var(--nesto-action-bar-room))");
    expect(out).toMatch(/@media \(width < 768px\) \{\s*\.max-md\\:sticky \{\s*position: sticky;/);
    expect(out).toMatch(/@media \(width < 768px\) \{\s*\.max-md\\:\\\[\\&\\>span\\:empty\\\]\\:hidden > span:empty \{\s*display: none;/);
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
