/**
 * Contrast arithmetic for the design tokens (AUD-11 §6, AV-10).
 *
 * Pure functions, no DOM: the unit test reads styles/tokens.css, resolves each
 * token's light and dark value (following `var()` references and the
 * `light-dark()` pair), composites translucent colours over the ground they sit
 * on, and measures the WCAG 2 contrast ratio. docs/a11y/contrast.md is the
 * printed form of the same numbers.
 */

export type Scheme = "light" | "dark";

/** Straight (non-premultiplied) sRGB, 0–255 per channel, alpha 0–1. */
export type Rgba = { r: number; g: number; b: number; a: number };

/** The WCAG thresholds the project binds itself to (AUD-11 §6). */
export const THRESHOLD = {
  /** Normal text. */
  text: 4.5,
  /** Large text: 24px regular, or ~18.7px bold. */
  large: 3,
  /** Control boundaries, state indicators, focus rings, information-bearing graphics. */
  ui: 3,
} as const;

export type PairKind = keyof typeof THRESHOLD;

export function parseColor(value: string): Rgba {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 };
  }
  // rgb(0 0 0 / 0.4), rgb(0, 0, 0), rgba(0, 0, 0, 0.4)
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: alpha };
  }
  if (text === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (text === "black") return { r: 0, g: 0, b: 0, a: 1 };
  throw new Error(`Unsupported colour: ${value}`);
}

/** `top` drawn over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** A colour at a given opacity, as Tailwind's `bg-x/85` writes it. */
export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { ...color, a: color.a * alpha };
}

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgba): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2 contrast ratio; a translucent foreground is composited over the background first. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const bg = background.a < 1 ? composite(background, { r: 255, g: 255, b: 255, a: 1 }) : background;
  const fg = foreground.a < 1 ? composite(foreground, bg) : foreground;
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function toHex(color: Rgba): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(color.r)}${h(color.g)}${h(color.b)}`;
}

/** Raw declarations of `--nesto-*` custom properties in the first `:root` block. */
export function readTokenDeclarations(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(withoutComments);
  if (!root) throw new Error("tokens.css has no :root block");
  const declarations = new Map<string, string>();
  for (const match of root[1].matchAll(/--(nesto-[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

/** Splits `a, b` at the top-level comma (commas inside rgb(...) stay put). */
function splitPair(inner: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
  }
  throw new Error(`light-dark() needs two values: ${inner}`);
}

/** Resolves one token to a concrete colour in one scheme. */
export function resolveToken(declarations: Map<string, string>, name: string, scheme: Scheme, seen: string[] = []): Rgba {
  const key = name.replace(/^--/, "").replace(/^(?!nesto-)/, "nesto-");
  if (seen.includes(key)) throw new Error(`Circular token: ${[...seen, key].join(" -> ")}`);
  const raw = declarations.get(key);
  if (raw === undefined) throw new Error(`Unknown token --${key}`);
  return resolveValue(declarations, raw, scheme, [...seen, key]);
}

function resolveValue(declarations: Map<string, string>, raw: string, scheme: Scheme, seen: string[]): Rgba {
  const value = raw.trim();
  const pair = /^light-dark\(([\s\S]*)\)$/.exec(value);
  if (pair) {
    const [light, dark] = splitPair(pair[1]);
    return resolveValue(declarations, scheme === "light" ? light : dark, scheme, seen);
  }
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  if (reference) return resolveToken(declarations, reference[1], scheme, seen);
  return parseColor(value);
}

/**
 * A colour as a primitive paints it: a token, optionally at an opacity
 * (`surface/85`), optionally over another ground (`surface/85 on canvas`).
 */
export type Paint = { token: string; alpha?: number; over?: string } | { literal: string };

export function resolvePaint(declarations: Map<string, string>, paint: Paint, scheme: Scheme): Rgba {
  if ("literal" in paint) return parseColor(paint.literal);
  let color = resolveToken(declarations, paint.token, scheme);
  if (paint.alpha !== undefined) color = withAlpha(color, paint.alpha);
  if (color.a < 1 && paint.over) color = composite(color, resolveToken(declarations, paint.over, scheme));
  return color;
}

export function paintName(paint: Paint): string {
  if ("literal" in paint) return paint.literal;
  return `${paint.token}${paint.alpha !== undefined ? `/${Math.round(paint.alpha * 100)}` : ""}${paint.over ? ` on ${paint.over}` : ""}`;
}
