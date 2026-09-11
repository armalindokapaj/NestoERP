import { describe, expect, it } from "vitest";

import { AuditAction, auditPolicies, findAuditPolicy } from "@/lib/core/audit/audit-policy.registry";
import { diffFields } from "@/lib/core/audit/audit.service";

/** Policy is code-authoritative: the browser never chooses severity (PRD #28 §216). */
describe("audit policy registry", () => {
  it("registers every action key exactly once", () => {
    const keys = auditPolicies().map((p) => p.actionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes a policy for every declared action constant", () => {
    for (const actionKey of Object.values(AuditAction)) {
      expect(findAuditPolicy(actionKey), `${actionKey} has no policy`).toBeDefined();
    }
  });

  it("marks access-control and money actions as required", () => {
    for (const actionKey of [
      AuditAction.TEAM_MEMBER_ROLE_CHANGED,
      AuditAction.COMPANY_MODULE_DISABLED,
      AuditAction.FINANCE_PAYMENT_REVERSED,
      AuditAction.FINANCE_INVOICE_APPROVED,
    ]) {
      expect(findAuditPolicy(actionKey)?.required, `${actionKey} is not required`).toBe(true);
    }
  });

  it("treats role change, module disable and currency change as CRITICAL", () => {
    for (const actionKey of [
      AuditAction.TEAM_MEMBER_ROLE_CHANGED,
      AuditAction.COMPANY_MODULE_DISABLED,
      AuditAction.COMPANY_BASE_CURRENCY_CHANGED,
    ]) {
      expect(findAuditPolicy(actionKey)?.severity, actionKey).toBe("CRITICAL");
    }
  });

  it("records that compensation changed without recording the amount", () => {
    const policy = findAuditPolicy(AuditAction.HR_COMPENSATION_CHANGED);
    expect(policy?.redactFields).toContain("amount");
  });
});

describe("diffFields", () => {
  it("omits unchanged fields", () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: { before: 2, after: 3 } });
  });

  it("captures null to value and value to null", () => {
    expect(diffFields({ a: null }, { a: "x" })).toEqual({ a: { before: null, after: "x" } });
    expect(diffFields({ a: "x" }, { a: null })).toEqual({ a: { before: "x", after: null } });
  });

  it("returns null when nothing changed", () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toBeNull();
    expect(diffFields(null, null)).toBeNull();
  });
});
