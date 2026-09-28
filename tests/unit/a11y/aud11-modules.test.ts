import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Module code keeps the AUD-11 semantics and visual-system rules
 * (AUD-11 §3, §5, §6; AV-06, AV-13).
 *
 * A static ratchet over the module partition — business modules under
 * components/<module>/, the (nesto) app routes and the Platform Admin routes.
 * Shared primitives, the shell, charts, the data/form kits and the 3D engine
 * are checked by their own suites, so they are excluded here. Each rule was
 * swept to zero (or to a named, justified exception) in AUD-11; a new
 * instance fails until it is fixed or deliberately added to the exception
 * list with its reason.
 *
 * Static: no database, no rendering. It proves the source, not the running
 * page — the axe scans in tests/e2e/a11y/aud11-modules.spec.ts do that.
 */

const ROOT = path.resolve(__dirname, "../../..");
const SCANNED = ["components", "app"];
const EXCLUDED = [
  "components/ui/",
  "components/layout/",
  "components/charts/",
  "components/data/",
  "components/forms/",
  "components/3d/",
  "components/navigation/",
  "components/marketing/",
  "components/i18n/",
  "components/unsaved/",
  "components/auth/",
  "components/help/",
  "components/workspace/",
  "app/(experience-editor)/",
  "app/(public)/",
  "app/api/",
];
const SHELL_FILES = new Set(["app/layout.tsx", "app/(nesto)/layout.tsx"]);

function moduleFiles(): string[] {
  return SCANNED.flatMap((dir) =>
    (readdirSync(path.join(ROOT, dir), { recursive: true }) as string[])
      .map((file) => `${dir}/${file.split(path.sep).join("/")}`)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => !EXCLUDED.some((prefix) => file.startsWith(prefix)) && !SHELL_FILES.has(file)),
  );
}

const FILES = moduleFiles();
const SOURCES = new Map(FILES.map((file) => [file, readFileSync(path.join(ROOT, file), "utf8")]));

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Every regex hit across the partition, as `file:line match`. */
function sweep(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const [file, source] of SOURCES) {
    for (const match of source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      hits.push(`${file}:${lineOf(source, match.index ?? 0)} ${match[0]}`);
    }
  }
  return hits;
}

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;

function walkJsx(visit: (node: Jsx, open: ts.JsxOpeningLikeElement, file: string, line: number, ancestors: string[]) => void) {
  for (const [file, source] of SOURCES) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const ancestors: string[] = [];
    const recurse = (node: ts.Node) => {
      let pushed = false;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const open = ts.isJsxElement(node) ? node.openingElement : node;
        visit(node, open, file, tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, ancestors);
        if (ts.isJsxElement(node)) {
          ancestors.push(open.tagName.getText() + (attribute(open, "asChild") ? "[asChild]" : ""));
          pushed = true;
        }
      }
      ts.forEachChild(node, recurse);
      if (pushed) ancestors.pop();
    };
    recurse(tree);
  }
}

function attribute(open: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return open.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText() === name);
}

function hasSpread(open: ts.JsxOpeningLikeElement): boolean {
  return open.attributes.properties.some((prop) => ts.isJsxSpreadAttribute(prop));
}

/** True when the element renders any text a screen reader would read as its name. */
function rendersText(children: ts.NodeArray<ts.JsxChild>): boolean {
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.getText().trim().length > 0;
    if (ts.isJsxExpression(child)) {
      const expression = child.expression;
      if (!expression) return false;
      if (ts.isJsxElement(expression)) return rendersText(expression.children);
      if (ts.isJsxSelfClosingElement(expression)) return TEXT_COMPONENT.test(expression.tagName.getText());
      return true; // a string, a translation, a conditional — treated as text
    }
    if (ts.isJsxElement(child)) return rendersText(child.children);
    if (ts.isJsxSelfClosingElement(child)) return TEXT_COMPONENT.test(child.tagName.getText());
    return false;
  });
}

/**
 * Components that render text, not icons: rich-text runs, and the translation
 * leaves (`StatusText`, `UiText`, `HseLabel`…) that print a dictionary string.
 */
const TEXT_COMPONENT = /^(InlineNodes|Trans|\w+Text|\w+Label)$/;

describe("AUD-11 module semantics (§3, AV-06)", () => {
  it("scans a meaningful partition", () => {
    expect(FILES.length).toBeGreaterThan(500);
    expect(FILES).toContain("components/calendar/event-card.tsx");
    expect(FILES.some((file) => file.startsWith("app/admin/"))).toBe(true);
  });

  it("uses no positive tabindex to patch the DOM order", () => {
    expect(sweep(/tabIndex=\{?["']?[1-9]/)).toEqual([]);
  });

  it("names every icon-only button and link", () => {
    const unnamed: string[] = [];
    const CONTROLS = new Set(["button", "a", "Button", "Link"]);
    const NAMES = ["aria-label", "aria-labelledby", "title"];
    walkJsx((node, open, file, line, ancestors) => {
      const tag = open.tagName.getText();
      if (!CONTROLS.has(tag) || attribute(open, "asChild") || hasSpread(open)) return;
      // <Button asChild aria-label=…><Link/></Button>: the name is on the Button.
      if (ancestors[ancestors.length - 1]?.endsWith("[asChild]")) return;
      // Removed from the accessibility tree and the tab order on purpose (a
      // chart mark with a named row button beside it).
      if (attribute(open, "aria-hidden") && attribute(open, "tabIndex")) return;
      if (NAMES.some((name) => attribute(open, name))) return;
      const children = ts.isJsxElement(node) ? node.children : undefined;
      if (children && rendersText(children)) return;
      if (!children && attribute(open, "children")) return;
      unnamed.push(`${file}:${line} <${tag}>`);
    });
    expect(unnamed).toEqual([]);
  });

  it("puts no aria-label on a role-less span or div, where it is not announced", () => {
    const bare: string[] = [];
    walkJsx((_node, open, file, line) => {
      const tag = open.tagName.getText();
      if (tag !== "span" && tag !== "div") return;
      if (attribute(open, "aria-label") && !attribute(open, "role")) bare.push(`${file}:${line} <${tag} aria-label>`);
    });
    expect(bare).toEqual([]);
  });

  it("never makes a non-interactive element the only way to act", () => {
    /*
     * The two remaining handlers are pointer conveniences with a native
     * control beside them:
     *   - the calendar time grid's day column: double-click (mouse) or tap
     *     (touch) creates at that slot; the keyboard uses the New menu, which
     *     opens the same event form.
     *   - a milestone table row: the click opens the milestone, and the row's
     *     name is a native <button> doing the same.
     */
    const allowed = new Set(["components/calendar/time-grid-view.tsx:div", "components/project-planning/milestone-list.tsx:tr"]);
    const clickable: string[] = [];
    walkJsx((_node, open, file, line) => {
      const tag = open.tagName.getText();
      if (!/^(div|span|li|tr|td|article|section)$/.test(tag)) return;
      if (!attribute(open, "onClick")) return;
      if (!allowed.has(`${file}:${tag}`)) clickable.push(`${file}:${line} <${tag} onClick>`);
    });
    expect(clickable).toEqual([]);
  });

  it("does not nest interactive controls", () => {
    const nested: string[] = [];
    const CONTROLS = /^(button|a|Button|Link)$/;
    walkJsx((_node, open, file, line, ancestors) => {
      const tag = open.tagName.getText();
      if (!CONTROLS.test(tag) || attribute(open, "asChild")) return;
      // <Button asChild><Link/></Button> is one control, so an asChild parent is not "outer".
      const outer = ancestors.filter((name) => CONTROLS.test(name));
      if (outer.length) nested.push(`${file}:${line} <${tag}> inside <${outer[outer.length - 1]}>`);
    });
    expect(nested).toEqual([]);
  });

  it("keeps hover-revealed controls visible on keyboard focus", () => {
    const hidden = sweep(/<button[^>]*className="[^"]*\bopacity-0\b[^"]*group-hover:opacity-100[^"]*"/).filter(
      (hit) => !/focus(-visible|-within)?:opacity-100|group-focus/.test(hit),
    );
    expect(hidden).toEqual([]);
  });
});

describe("AUD-11 module visual system (§6, AV-13)", () => {
  it("keeps text on the type scale — nothing below 11px", () => {
    expect(sweep(/text-\[(?:[0-9]|10)(?:\.\d+)?px\]/)).toEqual([]);
  });

  it("uses the scale tokens instead of arbitrary 11/12/13/20px sizes", () => {
    expect(sweep(/text-\[(?:11|12|13|20)px\]/)).toEqual([]);
  });

  it("renders status pills through the shared Badge, not ad hoc spans", () => {
    // A text pill: rounded-full with horizontal padding and a soft status fill.
    // Fixed-size step markers and icon discs (size-N) are not pills.
    const pills = sweep(/<span className="[^"]*\brounded-full\b[^"]*"/).filter(
      (hit) => /\bpx-/.test(hit) && /bg-(?:success|warning|danger|info)-soft/.test(hit) && !/\bsize-/.test(hit),
    );
    expect(pills).toEqual([]);
  });

  it("uses no raw hex, rgb or hsl colours in module code", () => {
    expect(sweep(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![-\w])|\brgba?\(|\bhsla?\(/).filter((hit) => !/href="#|#\{|&#/.test(hit))).toEqual([]);
  });

  it("uses Tailwind palette colours only on the justified media surfaces", () => {
    /*
     * Photographs, video and 3D covers keep their true colours on a dark
     * viewer surface with white overlay text (AUD-11 §7): the project hero and
     * its media tiles, the media gallery, daily-log evidence captions, the
     * project card cover scrim and the Platform Admin 3D cover placeholder.
     */
    const allowed = [
      "app/(nesto)/projects/[projectId]/page.tsx",
      "components/projects/project-media-gallery.tsx",
      "components/daily-logs/evidence-gallery.tsx",
      "components/projects/portfolio/project-card.tsx",
      "app/admin/3d/page.tsx",
    ];
    const palette = sweep(
      /\b(?:text|bg|border|ring|fill|stroke|from|via|to)-(?:red|green|blue|yellow|amber|emerald|orange|purple|sky|rose|slate|gray|zinc|neutral|indigo|violet|teal|cyan|lime|pink|fuchsia|stone|white|black)\b(?:-\d{2,3})?/,
    ).filter((hit) => !allowed.some((file) => hit.startsWith(`${file}:`)));
    expect(palette).toEqual([]);
  });

  it("gives Reject the same button variant wherever a decision is taken", () => {
    const ghostRejects = sweep(/<Button[^>]*variant="ghost"[^>]*>\s*Reject\s*</);
    expect(ghostRejects).toEqual([]);
  });
});

describe("AUD-11 module status and focus (§4, §5; AV-04, AV-06)", () => {
  it("says unread and billable state in text, not only a coloured dot", () => {
    expect(SOURCES.get("components/activity/activity-view.tsx")).toMatch(/sr-only">, \{t\("unread"\)\}/);
    expect(SOURCES.get("components/announcements/announcement-list.tsx")).toMatch(/<span className="sr-only">\{t\("list\.unread"\)\}<\/span>/);
    expect(SOURCES.get("components/timesheets/timesheet-grid.tsx")).toMatch(/sr-only">\{row\.billableMinutes > 0 \? t\("common\.billable"\) : t\("common\.notBillable"\)\}/);
  });

  it("places focus on a surviving row after an in-place delete", () => {
    const users = [
      "components/projects/project-types-manager.tsx",
      "components/projects/unit-types-manager.tsx",
      "components/workforce/trades-manager.tsx",
      "components/collaboration/collaboration-panel.tsx",
      "components/productivity/my-work-view.tsx",
      "components/daily-logs/daily-log-workspace.tsx",
    ];
    for (const file of users) expect(SOURCES.get(file), file).toMatch(/planFocusAfterRemoval\(event\.currentTarget\)/);
  });

  it("names repeated row actions after their record", () => {
    const generic = sweep(/aria-label="(?:Edit comment|Delete comment|Remove link|Unlink task|Payment actions|Edit assignment)"/);
    expect(generic).toEqual([]);
  });
});
