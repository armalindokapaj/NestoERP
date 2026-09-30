import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { gridColumnClasses, ResponsiveGrid } from "@/components/ui/responsive-grid";
import { PageContainer } from "@/components/ui/page-container";
import { Stack } from "@/components/ui/stack";
import { stickyOffsetFor } from "@/components/ui/sticky";
import { BREAKPOINTS } from "@/components/ui/use-breakpoint";
import { inputModes, showOn } from "@/lib/ui/responsive";

const css = (file: string) => readFileSync(join(process.cwd(), "styles", file), "utf8");
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("MOB-01 tokens (§8)", () => {
  const tokens = css("tokens.css");
  it.each([
    "space-page-x", "space-page-y", "space-section", "space-card", "space-control",
    "height-control", "height-control-compact", "radius-control", "radius-card", "radius-sheet",
    "touch-target-min", "content-max-width", "safe-top", "safe-bottom", "safe-left", "safe-right",
    "z-content", "z-sticky", "z-critical",
  ])("declares --nesto-%s", (name) => {
    expect(tokens).toMatch(new RegExp(`--nesto-${name}:`));
  });

  it("the sticky offset is the shell's sticky stack", () => {
    expect(css("globals.css")).toMatch(/--nesto-sticky-top-offset:\s*var\(--nesto-sticky-stack\)/);
  });

  it("the touch target is at least 44px", () => {
    expect(Number(/--nesto-touch-target-min:\s*([\d.]+)rem/.exec(tokens)![1]) * 16).toBeGreaterThanOrEqual(44);
  });

  it("breakpoints in CSS and in TypeScript agree", () => {
    const globals = css("globals.css");
    for (const [name, px] of Object.entries(BREAKPOINTS)) {
      expect(globals, name).toMatch(new RegExp(`--breakpoint-${name}:\\s*${px}px`));
    }
  });
});

describe("PageContainer", () => {
  it("renders the shared page rule with its variant and gutter", () => {
    const out = html(React.createElement(PageContainer, { variant: "wide", gutter: "none", as: "main", id: "m" }, "x"));
    expect(out).toContain("<main");
    expect(out).toContain('class="nesto-page"');
    expect(out).toContain('data-variant="wide"');
    expect(out).toContain('data-gutter="none"');
  });
});

describe("Stack", () => {
  it("is a column by default and a row on request", () => {
    expect(html(React.createElement(Stack, {}))).toContain("flex-col");
    expect(html(React.createElement(Stack, { direction: "row" }))).toContain("flex-row");
  });

  it("stacks below a breakpoint, reversing so the primary action is first on a phone", () => {
    const out = html(React.createElement(Stack, { direction: "row", stackBelow: "sm", reverseWhenStacked: true, fillWhenStacked: true }));
    expect(out).toContain("flex-col-reverse sm:flex-row");
    expect(out).toContain("max-sm:[&amp;&gt;*]:w-full");
  });
});

describe("ResponsiveGrid", () => {
  it("maps a column spec to mobile-first classes", () => {
    expect(gridColumnClasses({ base: 1, md: 2, xl: 3 })).toEqual(["grid-cols-1", "md:grid-cols-2", "xl:grid-cols-3"]);
    expect(gridColumnClasses({})).toEqual(["grid-cols-1"]);
  });

  it("fits columns by container width without exceeding 100% at 320", () => {
    const out = html(React.createElement(ResponsiveGrid, { minItemWidth: "16rem" }));
    expect(out).toContain("minmax(min(100%, 16rem), 1fr)");
  });
});

describe("sticky offsets", () => {
  it("a level starts below the levels above it", () => {
    const heights = { header: 56, subheader: 40, tabs: 44 };
    expect(stickyOffsetFor("header", heights)).toBe(0);
    expect(stickyOffsetFor("subheader", heights)).toBe(56);
    expect(stickyOffsetFor("tabs", heights)).toBe(96);
  });

  it("a missing level takes no room", () => {
    expect(stickyOffsetFor("tabs", { tabs: 44 })).toBe(0);
  });
});

describe("visibility and input presets", () => {
  it("phone-only chrome is hidden from md", () => {
    expect(showOn.phone).toBe("md:hidden");
    expect(showOn.tabletUp).toBe("max-md:hidden");
  });

  it("money and counts request a numeric keyboard, email an email one", () => {
    expect(inputModes.decimal.inputMode).toBe("decimal");
    expect(inputModes.integer.inputMode).toBe("numeric");
    expect(inputModes.email.inputMode).toBe("email");
    expect(inputModes.search.enterKeyHint).toBe("search");
  });
});
