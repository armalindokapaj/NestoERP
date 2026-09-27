import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * Shared responsive geometry checks (AUD-04 §3, §9; MW-01, MW-19).
 *
 * One place for the measurements every AUD-04 spec makes, so "no sideways
 * scroll" and "44px touch target" mean the same thing in every module:
 *
 * - `expectNoPageOverflow` — the page itself never scrolls sideways. Deliberate
 *   two-dimensional regions (wide tables, drawings) scroll inside themselves.
 * - `expectTouchTargets` — every visible interactive element in a region can be
 *   hit anywhere inside a 44×44 CSS px square around its centre. It hit-tests
 *   rather than reading the box, because the primitives grow the hit area with
 *   padding or an invisible pseudo-element and keep the visible icon small
 *   (AUD-04 lead decision "touch-target rule").
 * - `expectInViewport` — the control is wholly on screen after scrolling to it.
 * - `VIEWPORTS` / `atViewport` — the PRD §3 size table by name.
 */

/** The PRD §3 test sizes, CSS pixels. */
export const VIEWPORTS = {
  /** Reflow and zoom stress. */
  phoneSmall: { width: 320, height: 568 },
  phone360: { width: 360, height: 800 },
  phone390: { width: 390, height: 844 },
  phone412: { width: 412, height: 915 },
  tabletPortrait: { width: 768, height: 1024 },
  tabletPortraitLarge: { width: 820, height: 1180 },
  /** A phone on its side: the short-viewport case (MW-10). */
  phoneLandscape: { width: 844, height: 390 },
  tabletLandscape: { width: 1024, height: 768 },
  desktop: { width: 1280, height: 800 },
  desktopLarge: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/** Phone and tablet sizes: below the shell's lg (1024) breakpoint, the navigation is a drawer. */
export const DRAWER_VIEWPORTS: ViewportName[] = ["phoneSmall", "phone360", "phone390", "phone412", "tabletPortrait", "tabletPortraitLarge", "phoneLandscape"];

export async function atViewport(page: Page, name: ViewportName) {
  await page.setViewportSize(VIEWPORTS[name]);
}

/**
 * True when the running Playwright project is not one of `names`, for
 * `test.skip(outsideProjects(testInfo, /phone/), "...")`. The AUD-04 matrix
 * projects each run every `responsive/aud04-*.spec.ts`; a spec that is about
 * one size family skips the rest rather than asserting the wrong layout.
 */
export function outsideProjects(testInfo: TestInfo, names: RegExp) {
  return !names.test(testInfo.project.name);
}

/** The page never scrolls sideways (PRD §3, MW-01). */
export async function expectNoPageOverflow(page: Page, context = "") {
  const measured = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
    // The widest offender, to make a failure actionable.
    culprit: (() => {
      const limit = document.documentElement.clientWidth;
      let worst: { selector: string; right: number } | null = null;
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= limit + 1) continue;
        // Content inside its own horizontal scroller is fine (a labelled 2D region).
        let clipped = false;
        for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        if (!worst || rect.right > worst.right) {
          const id = el.id ? `#${el.id}` : "";
          const testId = el.getAttribute("data-testid");
          worst = { selector: `${el.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ""}.${String(el.className).slice(0, 80)}`, right: Math.round(rect.right) };
        }
      }
      return worst;
    })(),
  }));
  const label = context ? `${context}: ` : "";
  expect(measured.document, `${label}document scrollWidth ${measured.document} > ${measured.inner}; widest: ${JSON.stringify(measured.culprit)}`).toBeLessThanOrEqual(measured.inner + 1);
  expect(measured.body, `${label}body scrollWidth ${measured.body} > ${measured.inner}; widest: ${JSON.stringify(measured.culprit)}`).toBeLessThanOrEqual(measured.inner + 1);
}

/** Scrolls `target` into view and requires it wholly inside the visible viewport. */
export async function expectInViewport(target: Locator, context = "") {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = target.page().viewportSize()!;
  const label = context ? `${context}: ` : "";
  expect(box, `${label}the control is rendered`).not.toBeNull();
  expect(box!.x, `${label}left edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label}right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y, `${label}top edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height, `${label}bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
}

const INTERACTIVE = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=combobox]",
].join(",");

export type TouchTargetOptions = {
  /** Minimum square side in CSS px (PRD §3: 44). */
  min?: number;
  /** CSS selector for elements to leave out (with a reason in the spec). */
  exclude?: string;
};

/**
 * Every visible interactive element inside `scope` can be hit anywhere in a
 * `min`×`min` square around its centre (PRD §3, MW-19).
 *
 * An element whose own box is big enough passes at once. A smaller one passes
 * when `elementFromPoint` at the centre and the four corners of that square
 * lands on the element itself (a padding or pseudo-element hit extension) or on
 * the label/wrapper that activates it. A neighbour answering instead means the
 * enlarged areas would overlap, which fails too.
 *
 * Left out, as WCAG 2.5.8 allows: links inline in running text, elements that
 * are not rendered, `sr-only` controls whose visible proxy is checked instead,
 * and disabled controls.
 */
export async function expectTouchTargets(page: Page, scope: Locator, options: TouchTargetOptions = {}) {
  const min = options.min ?? 44;
  const offenders = await scope.evaluateAll(
    (roots, { selector, exclude, min }) => {
      const found: string[] = [];
      const seen = new Set<Element>();
      const describe = (el: Element, rect: DOMRect) => {
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        const testId = el.getAttribute("data-testid");
        return `${el.tagName.toLowerCase()}${testId ? `[data-testid=${testId}]` : ""} "${name}" ${Math.round(rect.width)}×${Math.round(rect.height)}`;
      };
      const activates = (hit: Element | null, el: Element) => {
        if (!hit) return false;
        if (hit === el || el.contains(hit)) return true;
        // A label, or a wrapper whose only control is this one, activates it.
        const label = hit.closest("label");
        if (label && (label.control === el || label.contains(el))) return true;
        const owner = hit.closest(selector);
        return owner === el;
      };
      for (const root of roots) {
        const candidates = [root, ...Array.from(root.querySelectorAll(selector))].filter((el) => el.matches(selector));
        for (const el of candidates) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (exclude && el.matches(exclude)) continue;
          if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
          const style = getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
          let rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          // sr-only: 1px clipped controls (e.g. a file input behind its button).
          if (rect.width <= 1 && rect.height <= 1) continue;
          if (el.tagName === "A" && style.display === "inline" && el.parentElement?.closest("p, li, dd, td")) continue;
          if (rect.width >= min - 0.5 && rect.height >= min - 0.5) continue;
          el.scrollIntoView({ block: "center", inline: "center" });
          rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const half = min / 2 - 1;
          const points: Array<[number, number]> = [
            [cx, cy],
            [cx - half, cy - half],
            [cx + half, cy - half],
            [cx - half, cy + half],
            [cx + half, cy + half],
          ];
          const missed = points.filter(([x, y]) => !activates(document.elementFromPoint(x, y), el));
          if (missed.length > 0) found.push(describe(el, rect));
        }
      }
      return found;
    },
    { selector: INTERACTIVE, exclude: options.exclude ?? "", min },
  );
  expect(offenders, `${offenders.length} touch target(s) under ${min}×${min}px:\n${offenders.join("\n")}`).toEqual([]);
}

/** Text inputs are at least 16px below 768px, so iOS does not zoom on focus (PRD §3). */
export async function expectInputsAtLeast16px(page: Page, scope?: Locator) {
  const root = scope ?? page.locator("body");
  const small = await root.evaluateAll((roots) => {
    const found: string[] = [];
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), select, textarea"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) found.push(`${el.tagName.toLowerCase()}[name=${el.getAttribute("name") ?? ""}][aria-label=${el.getAttribute("aria-label") ?? ""}] ${size}px`);
      }
    }
    return found;
  });
  expect(small, `inputs under 16px:\n${small.join("\n")}`).toEqual([]);
}

/**
 * 200% text zoom (PRD §8, MW-19). Browser text-only zoom scales the root font
 * size; every rem-based size in the design system follows, the way it does
 * when a reader sets a larger default font.
 */
export async function emulateTextZoom(page: Page, factor = 2) {
  await page.evaluate((factor) => {
    document.documentElement.style.fontSize = `${factor * 100}%`;
  }, factor);
}

/** Nothing covers the element at its centre (a sticky bar, a stuck overlay). */
export async function expectNotCovered(target: Locator, context = "") {
  await target.scrollIntoViewIfNeeded();
  const covered = await target.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 10));
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return null;
    return `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 80)}`;
  });
  expect(covered, `${context ? `${context}: ` : ""}covered by ${covered}`).toBeNull();
}
