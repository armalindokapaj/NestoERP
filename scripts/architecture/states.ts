import fs from "node:fs";

/**
 * Which columns hold a controlled state (PRD #49 §291 step 1).
 *
 * Read from the schema rather than listed by hand, so a new status column is
 * covered by the gate the moment it exists. A column counts when it is typed
 * by an enum *and* named like a state — `status`, `stage`, `result`,
 * `decision`. An enum column that is not a state (a severity, a currency, a
 * response type) is not something a transition moves a record between.
 */

const STATE_NAME = /(status|state|stage|decision|result|outcome)$/i;

export function controlledStateFields(schemaPath = "prisma/schema.prisma"): Record<string, string[]> {
  const source = fs.readFileSync(schemaPath, "utf8");
  const enums = new Set([...source.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((match) => match[1]));

  const models: Record<string, string[]> = {};
  for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    const fields: string[] = [];
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
      const [field, type] = trimmed.split(/\s+/);
      if (!field || !type) continue;
      if (enums.has(type.replace(/[?[\]]/g, "")) && STATE_NAME.test(field)) fields.push(field);
    }
    if (fields.length > 0) models[name] = fields;
  }
  return models;
}
