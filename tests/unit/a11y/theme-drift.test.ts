import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { theme } from "@/config/theme";
import { readTokenDeclarations } from "@/lib/a11y/contrast";
import { lookAttribute, readLook } from "@/lib/layout/look-state";
import { THEME_CHOICES, readThemeChoice, themeAttribute } from "@/lib/layout/theme-state";

/**
 * AUD-11 §2, §7; AV-13, AV-14: config/theme.ts is a typed view of the CSS, not
 * a second authority. Every value it states must be the value the stylesheet
 * declares, and the theme preference keeps "system" as the absence of a pin.
 */
const tokensCss = readFileSync(join(process.cwd(), "styles/tokens.css"), "utf8");
const globalsCss = readFileSync(join(process.cwd(), "styles/globals.css"), "utf8");
const tokens = readTokenDeclarations(tokensCss);

function cssVar(css: string, name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`--${name} is not declared`);
  return match[1].trim();
}

const px = (value: string) => (value.endsWith("rem") ? parseFloat(value) * 16 : parseFloat(value));

/**
 * A step of the type or radius scale. globals.css maps each Tailwind step onto
 * a --nesto-* variable (`@theme inline` would otherwise copy a literal into the
 * utilities and leave version 2 nothing to restate, UI-02 §6.2), so the value
 * is the one tokens.css declares for that variable: version 1's.
 */
function scaleStep(name: string): string {
  const reference = /^var\(--(nesto-[\w-]+)\)$/.exec(cssVar(globalsCss, name))?.[1];
  if (!reference) throw new Error(`--${name} does not point at a --nesto-* variable`);
  return cssVar(tokensCss, reference);
}

describe("config/theme.ts agrees with the stylesheets", () => {
  it("every colour names a declared token", () => {
    for (const [key, value] of Object.entries(theme.colors)) {
      const name = /^var\(--(nesto-[\w-]+)\)$/.exec(value)?.[1];
      expect(name, key).toBeDefined();
      expect(tokens.has(name!), `${key} → --${name}`).toBe(true);
    }
  });

  it("every shadow names a declared token", () => {
    for (const value of Object.values(theme.shadows)) {
      const name = /^var\(--(nesto-[\w-]+)\)$/.exec(value)![1];
      expect(tokens.has(name), name).toBe(true);
    }
  });

  it("typography equals the --text-* scale", () => {
    const map: Record<keyof typeof theme.typography, string> = {
      hero: "text-hero",
      headline: "text-headline",
      display: "text-display",
      pageTitle: "text-page",
      sectionTitle: "text-section",
      cardTitle: "text-card",
      body: "text-body",
      table: "text-table",
      metadata: "text-meta",
      micro: "text-micro",
    };
    for (const [key, name] of Object.entries(map)) {
      expect(px(scaleStep(name)), key).toBe(theme.typography[key as keyof typeof map]);
    }
  });

  it("radii equal the --radius-* scale", () => {
    const map: Record<keyof typeof theme.radius, string> = {
      small: "radius-sm",
      button: "radius-md",
      input: "radius-md",
      smallCard: "radius-lg",
      dashboardCard: "radius-xl",
      dialog: "radius-2xl",
      featureCard: "radius-3xl",
    };
    for (const [key, name] of Object.entries(map)) {
      expect(px(scaleStep(name)), key).toBe(theme.radius[key as keyof typeof map]);
    }
  });

  it("motion equals the --nesto-motion-* tokens", () => {
    expect(px(cssVar(tokensCss, "nesto-motion-fast"))).toBe(theme.motion.fast);
    expect(px(cssVar(tokensCss, "nesto-motion"))).toBe(theme.motion.base);
    expect(px(cssVar(tokensCss, "nesto-motion-slow"))).toBe(theme.motion.slow);
    expect(px(cssVar(tokensCss, "nesto-motion-rise"))).toBe(theme.motion.rise);
    expect(cssVar(tokensCss, "nesto-ease")).toBe(theme.motion.easing);
  });

  it("the z-index ladder equals the --nesto-z-* tokens", () => {
    const map: Record<keyof typeof theme.zIndex, string> = {
      topbar: "nesto-z-topbar",
      sidebar: "nesto-z-sidebar",
      drawer: "nesto-z-drawer",
      sheet: "nesto-z-sheet",
      dialog: "nesto-z-dialog",
      floating: "nesto-z-floating",
      tooltip: "nesto-z-tooltip",
      toast: "nesto-z-toast",
      unsavedPrompt: "nesto-z-unsaved-prompt",
    };
    for (const [key, name] of Object.entries(map)) {
      expect(Number(cssVar(tokensCss, name)), key).toBe(theme.zIndex[key as keyof typeof map]);
    }
  });

  it("breakpoints equal the --breakpoint-* the layout switches on", () => {
    expect(px(cssVar(globalsCss, "breakpoint-md"))).toBe(theme.breakpoints.tablet);
    expect(px(cssVar(globalsCss, "breakpoint-lg"))).toBe(theme.breakpoints.navRail);
    expect(px(cssVar(globalsCss, "breakpoint-xl"))).toBe(theme.breakpoints.desktop);
    expect(px(cssVar(globalsCss, "breakpoint-2xl"))).toBe(theme.breakpoints.largeDesktop);
  });

  it("nothing in the type scale goes below the 11px floor", () => {
    expect(Math.min(...Object.values(theme.typography))).toBeGreaterThanOrEqual(11);
  });
});

describe("Theme 2 is an overlay, never a second default", () => {
  const look2Css = readFileSync(join(process.cwd(), "styles/look-2.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("every rule of look-2.css is scoped to :root[data-look=\"2\"]", () => {
    // Selectors are what is left once declarations, at-rule preludes and braces are taken away.
    const selectors = look2Css
      .replace(/@(media|layer)[^{]*\{/g, "")
      .split("}")
      .map((rule) => rule.split("{")[0].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(/,\s*(?![^(]*\))/)) expect(part.trim(), part).toMatch(/^:root\[data-look="2"\]/);
    }
  });

  it("restates only variables Theme 1 declares", () => {
    const declared = new Set([...(tokensCss + globalsCss).matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    // next/font declares the font variables on <body> (lib/fonts).
    for (const name of ["--font-nesto-sans", "--font-geist-mono", "--font-nesto-serif"]) declared.add(name);
    for (const [, name] of look2Css.matchAll(/(--[\w-]+)\s*:/g)) expect(declared.has(name), name).toBe(true);
  });

  it("the stylesheet is loaded straight after tokens.css, and `look2:` matches only inside <html data-look=\"2\">", () => {
    expect(globalsCss).toMatch(/@import "\.\/tokens\.css";\s*@import "\.\/look-2\.css";/);
    expect(globalsCss).toMatch(/@custom-variant look2 \(&:where\(\[data-look="2"\], \[data-look="2"\] \*\)\);/);
  });

  it("the look is a cookie anyone may set, and anything but \"2\" is Theme 1", () => {
    expect(readLook(undefined)).toBe("1");
    expect(readLook("3")).toBe("1");
    expect(readLook("2")).toBe("2");
    expect(lookAttribute("1")).toBeUndefined();
    expect(lookAttribute("2")).toBe("2");
  });
});

describe("the shell's geometry", () => {
  it("the sidebar, header, breadcrumb bar and context tabs are the sizes the shell is built on", () => {
    expect(px(cssVar(tokensCss, "nesto-sidebar-width"))).toBe(240);
    expect(px(cssVar(tokensCss, "nesto-sidebar-width-collapsed"))).toBe(72);
    expect(px(cssVar(globalsCss, "nesto-shell-header-h"))).toBe(56);
    expect(globalsCss).toMatch(/@media \(min-width: 768px\) \{\s*:root \{\s*--nesto-shell-header-h: 4rem;/);
    expect(px(cssVar(globalsCss, "nesto-shell-breadcrumb-h"))).toBe(40);
    expect(px(cssVar(tokensCss, "nesto-shell-tab-row-h"))).toBe(46);
  });

  it("the sticky stack is one sum of the shell's heights", () => {
    expect(cssVar(globalsCss, "nesto-sticky-stack")).toBe("calc(var(--nesto-shell-header-h) + var(--nesto-shell-breadcrumb-h) + var(--nesto-shell-tabs-h))");
    expect(cssVar(globalsCss, "nesto-layer-pin")).toBe("sticky");
    expect(cssVar(globalsCss, "nesto-bottom-nav-pin")).toBe("fixed");
  });
});

describe("theme preference (AV-14)", () => {
  it("system pins nothing, so the OS decides; light and dark pin", () => {
    expect(THEME_CHOICES).toEqual(["system", "light", "dark"]);
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(readThemeChoice(undefined)).toBe("system");
    expect(readThemeChoice("sepia")).toBe("system");
  });

  it("the stylesheet follows the OS by default and an explicit choice overrides it both ways", () => {
    expect(/:root\s*\{\s*color-scheme:\s*light dark;/.test(tokensCss)).toBe(true);
    expect(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/.test(tokensCss)).toBe(true);
    expect(/:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/.test(tokensCss)).toBe(true);
  });

  it("no global image inversion", () => {
    expect(/filter:\s*invert/.test(globalsCss + tokensCss)).toBe(false);
  });
});

describe("reduced motion and forced colours (AV-15)", () => {
  it("reduced motion shortens every animation and transition, and makes loading static", () => {
    expect(globalsCss).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important/);
    expect(globalsCss).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.nesto-skeleton,[\s\S]*?animation: none/);
  });

  it("forced colours restore a system focus outline and selected-state marks", () => {
    const block = /@media \(forced-colors: active\) \{([\s\S]*)\}\s*$/.exec(globalsCss)?.[1] ?? "";
    expect(block).toMatch(/:focus-visible\s*\{\s*outline: 2px solid Highlight !important;/);
    expect(block).toMatch(/\[aria-current="page"\]/);
    expect(block).toMatch(/\.nesto-skeleton/);
  });

  it("a 2px focus outline is the global default", () => {
    expect(globalsCss).toMatch(/:focus-visible\s*\{\s*outline: 2px solid var\(--nesto-ring\);/);
  });
});
