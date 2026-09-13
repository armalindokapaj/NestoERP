import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MODULE_KEYS } from "@/config/modules";
import { isPermission } from "@/config/permissions";
import { recordDefinition, recordDefinitions, recordPath } from "@/lib/core/records/record.registry";
import { isRecordType, RECORD_TYPES } from "@/lib/core/records/record.types";

/**
 * Registry completeness (PRD #38 §28, §52-§54, §159).
 *
 * The registry is the one answer to "may this person see this record?" for
 * documents, discussion, task parents and notification links. These checks
 * keep that answer whole: every type is defined once, every permission it names
 * exists, and every record type the product writes into a notification, an
 * attention item or a task parent is one the registry can re-read.
 */
describe("record registry", () => {
  const definitions = recordDefinitions();

  it("defines every record type exactly once", () => {
    const types = definitions.map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...RECORD_TYPES].sort());
    for (const type of RECORD_TYPES) expect(recordDefinition(type)?.type).toBe(type);
  });

  it("names only real modules and real permissions", () => {
    const unknown: string[] = [];
    for (const definition of definitions) {
      if (!MODULE_KEYS.includes(definition.moduleKey)) unknown.push(`${definition.type}: module ${definition.moduleKey}`);
      const permissions = [
        ...definition.viewPermissions,
        ...(definition.documents?.view ?? []),
        ...(definition.documents?.upload ?? []),
        ...(definition.documents?.self ? [definition.documents.self.permission] : []),
        ...(definition.collaboration?.requires ?? []),
      ];
      for (const permission of permissions) {
        if (!isPermission(permission)) unknown.push(`${definition.type}: ${permission}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("gives every record a view permission and a noun, and a route where it has its own page", () => {
    for (const definition of definitions) {
      expect(definition.viewPermissions.length, definition.type).toBeGreaterThan(0);
      expect(definition.noun.trim(), definition.type).not.toBe("");
      // A record that lives under another (an amendment under its contract)
      // has no route of its own; its link comes from the loaded record.
      if (definition.route) expect(recordPath(definition.type, "abc"), definition.type).toMatch(/^\/[a-z]/);
    }
    expect(definitions.filter((definition) => definition.route).length).toBeGreaterThan(30);
  });

  it("refuses types it does not know", () => {
    expect(isRecordType("Task")).toBe(false);
    expect(recordDefinition("nope")).toBeNull();
    expect(recordPath("nope", "1")).toBeNull();
  });

  /**
   * The drift this registry replaced: an entity type string written by a
   * producer that no reader understands, so its notification links went
   * nowhere. Every literal `entityType: "…"` handed to the outbox, attention
   * and task parents from lib/ must be a registered type.
   */
  it("covers every record type the notification and attention producers write", () => {
    const roots = ["lib/core/notifications", "lib/modules"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    roots.forEach(walk);

    const unregistered: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("enqueueNotificationEvent") && !file.endsWith("attention.conditions.ts")) continue;
      const blocks = source.split("enqueueNotificationEvent(").slice(1);
      const literals = file.endsWith("attention.conditions.ts")
        ? [...source.matchAll(/entityType: "([a-z_]+)"/g)].map((match) => match[1])
        : blocks.flatMap((block) => [...block.slice(0, 600).matchAll(/entityType: "([a-z_]+)"/g)].slice(0, 1).map((match) => match[1]));
      for (const literal of literals) {
        if (!isRecordType(literal)) unregistered.push(`${file}: ${literal}`);
      }
    }
    expect(unregistered).toEqual([]);
  });
});
