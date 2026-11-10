import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

/**
 * The phone and tablet audit, items 4a and 4b: small targets grow under touch
 * and a phone reads nothing under 12px, while a desktop mouse keeps today's
 * look. Static checks on the stylesheets, plus one real Tailwind build of
 * globals.css to prove the hit-area utilities exist only under `touch:`.
 */

const ROOT = process.cwd();
const css = (file: string) => readFileSync(join(ROOT, "styles", file), "utf8");
const require = createRequire(import.meta.url);

/** Builds globals.css for `candidates` with Tailwind itself, resolving its @imports from disk. */
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

/** The rules a build emits for one class, with the at-rules they sit in. */
function rulesFor(output: string, selector: string): string[] {
  const found: string[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (char === "{") {
      stack.push(output.slice(start, index).trim());
      start = index + 1;
    } else if (char === "}") {
      const prelude = stack.pop() ?? "";
      if (prelude.includes(selector)) found.push(`${stack.filter((entry) => entry.startsWith("@media")).join(" ")} ${prelude} {${output.slice(start, index).trim()}}`);
      start = index + 1;
    } else if (char === ";" && stack.length > 0) {
      // A declaration ends; the next prelude starts after it.
      const next = output.indexOf("{", index);
      const close = output.indexOf("}", index);
      if (next !== -1 && next < close) start = index + 1;
    }
  }
  return found;
}

describe("a phone reads nothing under 12px (audit 4b)", () => {
  const tokens = css("tokens.css");

  it("below md the micro and tick steps take the metadata step's 12px", () => {
    const phone = /@media \(max-width: 767\.98px\) \{\s*:root \{([^}]*)\}/.exec(tokens)?.[1];
    expect(phone, "a :root block for phones in tokens.css").toBeDefined();
    expect(phone).toMatch(/--nesto-text-micro:\s*0\.75rem;/);
    expect(phone).toMatch(/--nesto-text-tick:\s*0\.75rem;/);
  });

  it("from md up the 11px micro and the 10px tick are kept", () => {
    expect(/--nesto-text-micro:\s*([\d.]+)rem/.exec(tokens)?.[1]).toBe("0.6875");
    expect(/--nesto-text-tick:\s*([\d.]+)rem/.exec(tokens)?.[1]).toBe("0.625");
  });

  it("the micro and tick utilities and the eyebrow read the variables, so the phone floor reaches them", () => {
    const globals = css("globals.css");
    expect(globals).toMatch(/--text-micro:\s*var\(--nesto-text-micro\);/);
    expect(globals).toMatch(/--text-tick:\s*var\(--nesto-text-tick\);/);
    expect(globals).toMatch(/\.nesto-eyebrow \{\s*font-size: var\(--text-micro\);/);
  });

  it("a literal size under 12px in app code has a phone floor beside it (the 3D viewer and editor aside)", () => {
    const skipped = ["components/3d/", "app/(experience-editor)/"];
    const files = ["app", "components"].flatMap((dir) =>
      (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
        .map((file) => `${dir}/${file.split("\\").join("/")}`)
        .filter((file) => file.endsWith(".tsx") && !skipped.some((prefix) => file.startsWith(prefix))),
    );
    const bare = files.flatMap((file) =>
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
        .filter(({ line }) => /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/.test(line) && !/max-md:text-(?:micro|meta|xs)\b/.test(line))
        .map(({ at }) => at),
    );
    expect(bare).toEqual([]);
  });
});

describe("small targets grow under touch (audit 4a)", () => {
  it("tap-target, tap-target-lg and tap-row are built only for touch — below lg or a coarse pointer", async () => {
    const output = await build(["tap-target", "tap-target-lg", "tap-row"]);
    for (const name of ["tap-target", "tap-target-lg", "tap-row"]) {
      const rules = rulesFor(output, `.${name}::after`);
      expect(rules, name).toHaveLength(2);
      expect(rules.some((rule) => rule.includes("@media (max-width: 1023.98px)")), name).toBe(true);
      expect(rules.some((rule) => rule.includes("@media (pointer: coarse)")), name).toBe(true);
      for (const rule of rules) expect(rule, name).toMatch(/content: "";[\s\S]*position: absolute;/);
      // Nothing outside the two touch queries: a desktop mouse keeps today's targets.
      expect(rulesFor(output, `.${name}`).every((rule) => rule.trimStart().startsWith("@media")), name).toBe(true);
    }
  });

  it("tap-target is at least 24px each way and tap-target-lg the 44px touch minimum, centred", () => {
    const globals = css("globals.css");
    const body = (name: string) => new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`).exec(globals)?.[1] ?? "";
    expect(body("tap-target")).toMatch(/inset-block: min\(0px, calc\(50% - 0\.75rem\)\);/);
    expect(body("tap-target")).toMatch(/inset-inline: min\(0px, calc\(50% - 0\.75rem\)\);/);
    expect(body("tap-target-lg")).toMatch(/inset-block: min\(0px, calc\(50% - var\(--nesto-touch-target-min\) \/ 2\)\);/);
    expect(body("tap-target-lg")).toMatch(/inset-inline: min\(0px, calc\(50% - var\(--nesto-touch-target-min\) \/ 2\)\);/);
    expect(body("tap-row")).toMatch(/inset-block: calc\(-1 \* var\(--tap-row-bleed, 0px\)\);/);
  });

  it("a person's name grows under touch, or makes its row the target when the row asks", () => {
    const personLink = readFileSync(join(ROOT, "components/people/person-link.tsx"), "utf8");
    expect(personLink).toMatch(/rowTarget \? "tap-row" : "tap-target"/);
  });

  it("a link in a phone record's facts grows too, above the record's own link", () => {
    const record = readFileSync(join(ROOT, "components/data/mobile-record.tsx"), "utf8");
    expect(record).toMatch(/\[&_button\]:z-10 \[&_a\]:tap-target/);
  });
});
