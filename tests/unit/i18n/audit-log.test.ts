import { describe, expect, it } from "vitest";

import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { auditLogEn } from "@/lib/i18n/modules/auditLog/en";
import { auditLogSq } from "@/lib/i18n/modules/auditLog/sq";

/** What the audit viewer printed before it had a dictionary (Settings → Audit). */
function humanise(actionKey: string): string {
  const words = actionKey.toLowerCase().split("_");
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + " " + words.slice(1).join(" ");
}

describe("audit action dictionary", () => {
  const actions = [...new Set<string>(Object.values(AuditAction))];

  it("has a key for every audit action, in both languages", () => {
    for (const action of actions) {
      expect(auditLogEn.actions, action).toHaveProperty(action);
      expect((auditLogSq.actions as Record<string, string>)[action], action).toBeTruthy();
    }
    // Events stored under a retired key stay readable, so the dictionaries may hold more keys than the registry.
    expect(Object.keys(auditLogSq.actions).sort()).toEqual(Object.keys(auditLogEn.actions).sort());
  });

  it("keeps the English the viewer has always printed", () => {
    for (const action of Object.keys(auditLogEn.actions)) {
      expect((auditLogEn.actions as Record<string, string>)[action], action).toBe(humanise(action));
    }
  });
});
