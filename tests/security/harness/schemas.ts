import { readFileSync } from "node:fs";

/**
 * The request schemas behind a handler, found in its source (PRD #47 §60-§62).
 *
 * A validation error only names the fields a request *lacks*. The fields an
 * attacker most wants to set — the optional links such as `incidentId`,
 * `sourceDefectId` or `assigneeMemberId` — never appear in one. So the schema
 * objects a handler parses with are imported and their shapes read, to reach
 * every id-shaped field whether the schema requires it or not.
 */

type ZodLike = { shape?: Record<string, unknown>; _zod?: { def?: Record<string, unknown> } };

export function schemaKeys(schema: unknown, depth = 0): string[] {
  if (!schema || typeof schema !== "object" || depth > 6) return [];
  const zod = schema as ZodLike;
  if (zod.shape && typeof zod.shape === "object") return Object.keys(zod.shape);
  const def = zod._zod?.def ?? {};
  for (const key of ["in", "innerType", "schema", "left"]) {
    const keys = schemaKeys(def[key], depth + 1);
    if (keys.length > 0) return keys;
  }
  if (Array.isArray(def.options)) return [...new Set((def.options as unknown[]).flatMap((option) => schemaKeys(option, depth + 1)))];
  return [];
}

/** Id-shaped fields of every schema `text` parses with, resolved through the imports of `file`. */
export async function idFieldsParsedIn(file: string, text: string): Promise<string[]> {
  const source = readFileSync(file, "utf8");
  const names = new Set([...text.matchAll(/\b(\w*[Ss]chemas?\w*)(?:\[[^\]]+\])?\.(?:safeParse|parse)\(/g)].map((match) => match[1]));
  const fields = new Set<string>();
  for (const name of names) {
    const imported = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)].find((match) => match[1].split(",").map((part) => part.trim().split(/\s+as\s+/).pop()).includes(name));
    const from = imported ? imported[2] : `@/${file.replace(/\.tsx?$/, "")}`;
    try {
      const exports = (await import(/* @vite-ignore */ from)) as Record<string, unknown>;
      const value = exports[name];
      const schemas = value && typeof value === "object" && !("_zod" in value) && !("shape" in value) ? Object.values(value as Record<string, unknown>) : [value];
      for (const schema of schemas) for (const key of schemaKeys(schema)) if (/Ids?$/.test(key)) fields.add(key);
    } catch {
      // A schema that cannot be imported on its own is simply not introspected.
    }
  }
  return [...fields];
}
