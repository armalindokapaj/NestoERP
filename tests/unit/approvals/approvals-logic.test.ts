import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { stepEligibility, type StepRow } from "@/lib/core/approvals/approval-steps";
import { findNotificationEvent } from "@/lib/core/notifications/notification.events";
import { findAuditPolicy } from "@/lib/core/audit/audit-policy.registry";
import { afterCursor, compareKeys, decodeCursor, dueStateOf, encodeCursor, sortItems, sortKey, urgencyOf } from "@/lib/modules/approvals/approvals.order";
import { keysetWhere, translateSourceError } from "@/lib/modules/approvals/approvals.provider";
import { approvalQuerySchema, parseApprovalRef, parseIdempotencyKey, reasonInputSchema } from "@/lib/modules/approvals/approvals.schema";
import type { UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import { planOrderChain } from "@/lib/modules/procurement/approvals/approval.policy";
import { canTransitionAmendmentStatus } from "@/lib/modules/contracts/amendments/amendment.status";
import { canTransitionInvoice } from "@/lib/modules/finance/invoices/invoice.status";

/**
 * The Approvals Center's pure rules (PRD #41 §94-§96, §120, §197, §240, §253),
 * and Procurement's chain plan (§27, §28).
 */

const NOW = new Date("2026-09-14T10:00:00.000Z");

function item(overrides: Partial<UnifiedApprovalItem>): UnifiedApprovalItem {
  const base: UnifiedApprovalItem = {
    id: "finance:a",
    providerKey: "finance",
    sourceType: "invoice",
    sourceId: "i",
    approvalId: "a",
    sourceLabel: "Invoice",
    title: "INV",
    subtitle: null,
    reference: null,
    status: "PENDING",
    priority: "NORMAL",
    amount: null,
    project: null,
    requester: { memberId: "m", name: "M" },
    requestedAt: "2026-09-10T10:00:00.000Z",
    dueAt: null,
    decidedAt: null,
    decidedBy: null,
    currentStep: null,
    totalSteps: null,
    stepLabel: null,
    href: "/",
    canApprove: true,
    canReject: true,
    canReturn: false,
    requiresStrongConfirmation: false,
    blockedReason: null,
    onBehalfOf: null,
    version: 1,
    dueState: "none",
    urgency: 0,
    sortAt: "2026-09-10T10:00:00.000Z",
  };
  const merged = { ...base, ...overrides };
  return { ...merged, dueState: dueStateOf(merged.dueAt, NOW), urgency: urgencyOf(merged, NOW) };
}

describe("due state and urgency (§95, §216)", () => {
  it("reads a business date as a calendar day", () => {
    expect(dueStateOf(null, NOW)).toBe("none");
    expect(dueStateOf("2026-09-13T12:00:00.000Z", NOW)).toBe("overdue");
    expect(dueStateOf("2026-09-14T23:00:00.000Z", NOW)).toBe("due_today");
    expect(dueStateOf("2026-09-17T12:00:00.000Z", NOW)).toBe("due_soon");
    expect(dueStateOf("2026-09-30T12:00:00.000Z", NOW)).toBe("later");
  });

  it("puts overdue before critical, critical before due soon, due soon before high, then the oldest", () => {
    const overdue = item({ id: "a:1", approvalId: "1", dueAt: "2026-09-12T12:00:00.000Z" });
    const critical = item({ id: "a:2", approvalId: "2", priority: "CRITICAL" });
    const soon = item({ id: "a:3", approvalId: "3", dueAt: "2026-09-16T12:00:00.000Z" });
    const high = item({ id: "a:4", approvalId: "4", priority: "HIGH" });
    const old = item({ id: "a:5", approvalId: "5", requestedAt: "2026-08-01T10:00:00.000Z" });
    const fresh = item({ id: "a:6", approvalId: "6", requestedAt: "2026-09-14T09:00:00.000Z" });
    expect(sortItems([fresh, old, high, soon, critical, overdue], "urgency").map((row) => row.approvalId)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("scores a decided item as not urgent at all", () => {
    expect(item({ status: "APPROVED", priority: "CRITICAL", dueAt: "2026-09-01T12:00:00.000Z" }).urgency).toBe(0);
  });
});

describe("merged ordering and cursors (§253)", () => {
  const rows = [
    item({ id: "finance:b", approvalId: "b", providerKey: "finance", sortAt: "2026-09-10T10:00:00.000Z" }),
    item({ id: "finance:a", approvalId: "a", providerKey: "finance", sortAt: "2026-09-10T10:00:00.000Z" }),
    item({ id: "hr:z", approvalId: "z", providerKey: "hr", sortAt: "2026-09-10T10:00:00.000Z" }),
    item({ id: "legal:c", approvalId: "c", providerKey: "legal", sortAt: "2026-09-11T10:00:00.000Z" }),
  ];

  it("is total: ties at the same instant break on provider then id, so no two items compare equal", () => {
    expect(sortItems(rows, "newest").map((row) => row.id)).toEqual(["legal:c", "hr:z", "finance:b", "finance:a"]);
    expect(sortItems(rows, "oldest").map((row) => row.id)).toEqual(["finance:a", "finance:b", "hr:z", "legal:c"]);
    for (const a of rows) for (const b of rows) if (a !== b) expect(compareKeys(sortKey(a, "newest"), sortKey(b, "newest"), "newest")).not.toBe(0);
  });

  it("resumes strictly after the last item, page after page", () => {
    const ordered = sortItems(rows, "newest");
    const cursor = decodeCursor(encodeCursor("history", "newest", sortKey(ordered[1], "newest")), "history", "newest");
    expect(afterCursor(ordered, "newest", cursor).map((row) => row.id)).toEqual(["finance:b", "finance:a"]);
  });

  it("ignores a cursor from another tab, another sort, or one that was edited", () => {
    const token = encodeCursor("history", "newest", sortKey(rows[0], "newest"));
    expect(decodeCursor(token, "waiting", "newest")).toBeNull();
    expect(decodeCursor(token, "history", "oldest")).toBeNull();
    expect(decodeCursor("not-a-cursor", "history", "newest")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 1, tab: "history", sort: "newest", key: [{}, "x", "y"] })).toString("base64url"), "history", "newest")).toBeNull();
  });

  it("builds a keyset clause each provider can resume from exactly", () => {
    const after = { at: new Date("2026-09-10T10:00:00.000Z"), providerKey: "hr", approvalId: "z" };
    expect(keysetWhere("submittedAt", "hr", { after, order: "desc" })).toEqual({ OR: [{ submittedAt: { lt: after.at } }, { submittedAt: after.at, id: { lt: "z" } }] });
    // A provider that sorts after the cursor's provider still has its rows at the same instant to come.
    expect(keysetWhere("submittedAt", "finance", { after, order: "desc" })).toEqual({ submittedAt: { lte: after.at } });
    expect(keysetWhere("submittedAt", "legal", { after, order: "desc" })).toEqual({ submittedAt: { lt: after.at } });
    expect(keysetWhere("decidedAt", "legal", { after, order: "asc" }, "approvalId")).toEqual({ decidedAt: { gte: after.at } });
    expect(keysetWhere("submittedAt", "hr", { after: null, order: "desc" })).toBeNull();
  });
});

describe("validation (§114, §120, §193, §240, §241)", () => {
  it("defaults the sort to the tab, and drops filters it does not recognise", () => {
    expect(approvalQuerySchema.parse({}).sort).toBe("urgency");
    expect(approvalQuerySchema.parse({ tab: "history" }).sort).toBe("newest");
    const parsed = approvalQuerySchema.parse({ tab: "nonsense", provider: ["finance,workflow", "hr"], status: "PENDING,DELETED", priority: "HIGH", projectId: "'; drop", from: "2026-13-40", limit: "1000" });
    expect(parsed).toMatchObject({ tab: "waiting", provider: ["finance", "hr"], status: ["PENDING"], priority: ["HIGH"], projectId: undefined, from: undefined, limit: 25 });
  });

  it("reads an approval reference only as a registered provider and a plain id", () => {
    expect(parseApprovalRef("procurement:abc_123")).toEqual({ providerKey: "procurement", approvalId: "abc_123" });
    expect(parseApprovalRef("workflow:abc")).toBeNull();
    expect(parseApprovalRef("finance:../../etc")).toBeNull();
    expect(parseApprovalRef("finance:a:b")).toBeNull();
  });

  it("requires a reason to reject or return, up to 5,000 characters", () => {
    expect(reasonInputSchema.safeParse({ note: "" }).success).toBe(false);
    expect(reasonInputSchema.safeParse({ note: "x".repeat(5001) }).success).toBe(false);
    expect(reasonInputSchema.safeParse({ note: "Wrong supplier" }).success).toBe(true);
  });

  it("accepts only a well-formed idempotency key", () => {
    expect(parseIdempotencyKey("apr_0f3c2c5e-5f7b")).toBe("apr_0f3c2c5e-5f7b");
    expect(parseIdempotencyKey("short")).toBeNull();
    expect(parseIdempotencyKey("has spaces in it")).toBeNull();
  });

  it("speaks the Center's error vocabulary for what a module refused", () => {
    const code = (fn: () => never) => {
      try {
        fn();
      } catch (error) {
        return (error as AccessError).details as { code: string };
      }
    };
    expect(code(() => translateSourceError(new AccessError("FORBIDDEN", "You submitted this, so somebody else has to decide on it.", { code: "SELF_APPROVAL" })))).toEqual({ code: "APPROVAL_SELF_APPROVAL_BLOCKED" });
    expect(code(() => translateSourceError(new AccessError("CONFLICT", "That decision has already been made.", { code: "APPROVAL_DECIDED" })))).toEqual({ code: "APPROVAL_ALREADY_DECIDED" });
    expect(code(() => translateSourceError(new AccessError("NOT_FOUND")))).toEqual({ code: "APPROVAL_NOT_FOUND" });
    expect(code(() => translateSourceError(new AccessError("MODULE_UNAVAILABLE")))).toEqual({ code: "APPROVAL_PROVIDER_UNAVAILABLE" });
  });
});

describe("purchase order chain plan (§27, §28)", () => {
  const policy = { financeStepAbove: new Prisma.Decimal(25_000), executiveStepAbove: new Prisma.Decimal(75_000), executiveRoleKey: "CEO", currency: "EUR", updatedAt: NOW };
  const plan = (amount: number, currency = "EUR", rules = policy) => planOrderChain(rules, { totalAmount: new Prisma.Decimal(amount), currency });

  it("is a single decision without a policy, and at or under the Finance limit", () => {
    expect(planOrderChain(null, { totalAmount: new Prisma.Decimal(1_000_000), currency: "EUR" }).steps).toEqual([]);
    expect(plan(25_000).steps).toEqual([]);
  });

  it("adds Finance above its limit, and the executive above theirs", () => {
    expect(plan(25_000.01).steps.map((step) => step.label)).toEqual(["Procurement", "Finance"]);
    const full = plan(82_400);
    expect(full.steps).toEqual([
      { label: "Procurement", approverPermission: "procurement.order.approve" },
      { label: "Finance", approverPermission: "procurement.order.finance_approve" },
      { label: "Executive", approverRoleKey: "CEO" },
    ]);
    expect(full.reason).toContain("EUR 25,000.00");
    expect(full.reason).toContain("CEO / Director");
  });

  it("takes every configured step when the order's currency cannot be compared with the limits", () => {
    const other = plan(10, "USD");
    expect(other.steps.map((step) => step.label)).toEqual(["Procurement", "Finance", "Executive"]);
    expect(other.currencyMismatch).toBe(true);
    expect(plan(10, "USD", { ...policy, executiveStepAbove: null as unknown as Prisma.Decimal }).steps.map((step) => step.label)).toEqual(["Procurement", "Finance"]);
  });
});

describe("step eligibility (§21, §29)", () => {
  const context = (overrides: Partial<UserContext>) => ({ membershipId: "me", companyId: "c", role: "PROCUREMENT", permissions: ["procurement.order.approve"], ...overrides }) as UserContext;
  const step = (overrides: Partial<StepRow>): StepRow => ({
    id: overrides.id ?? `s${overrides.stepNumber ?? 1}`,
    stepNumber: 1,
    label: "Procurement",
    approverMemberId: null,
    approverRoleKey: null,
    approverPermission: "procurement.order.approve",
    status: "PENDING",
    decidedByMemberId: null,
    onBehalfOfMemberId: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  });
  const chain = [step({}), step({ stepNumber: 2, label: "Finance", approverPermission: "procurement.order.finance_approve" }), step({ stepNumber: 3, label: "Executive", approverPermission: null, approverRoleKey: "CEO" })];
  const ask = (who: UserContext, target: StepRow, steps = chain, submittedBy = "pm") => stepEligibility(who, target, { providerKey: "procurement", steps, submittedByMemberId: submittedBy, delegations: [] });

  it("lets the permission holder take the current step, never the requester", async () => {
    expect(await ask(context({}), chain[0])).toEqual({ eligible: true, onBehalfOfMemberId: null });
    expect(await ask(context({}), chain[0], chain, "me")).toEqual({ eligible: false, reason: "SELF_APPROVAL" });
    expect(await ask(context({ permissions: [] }), chain[0])).toEqual({ eligible: false, reason: "NOT_APPROVER" });
  });

  it("refuses a second step to anyone who decided the first", async () => {
    const decided = [step({ status: "APPROVED", decidedByMemberId: "me" }), chain[1], chain[2]];
    expect(await ask(context({ permissions: ["procurement.order.finance_approve"] }), decided[1], decided)).toEqual({ eligible: false, reason: "ALREADY_DECIDED_STEP" });
  });

  it("keeps the executive for the executive step", async () => {
    const ceo = context({ role: "CEO", permissions: ["procurement.order.approve", "procurement.order.finance_approve"] });
    expect(await ask(ceo, chain[0])).toEqual({ eligible: false, reason: "RESERVED_FOR_LATER_STEP" });
    expect(await ask(ceo, chain[2])).toEqual({ eligible: true, onBehalfOfMemberId: null });
  });
});

describe("registries (§40, §56)", () => {
  it("registers the approval notifications under the approvals preference", () => {
    for (const key of ["APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_RETURNED", "APPROVAL_REASSIGNED", "APPROVAL_DELEGATED", "APPROVAL_OVERDUE"]) {
      expect(findNotificationEvent(key)?.category, key).toBe("approvals");
    }
  });

  it("makes every decision's audit required, so a decision cannot happen unaudited (§248)", () => {
    for (const key of ["APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_RETURNED", "APPROVAL_STEP_APPROVED", "APPROVAL_DELEGATION_CREATED", "APPROVAL_REASSIGNED"]) {
      expect(findAuditPolicy(key)?.required, key).toBe(true);
    }
  });

  it("lets a returned record go back to draft in the modules that return", () => {
    expect(canTransitionInvoice("PENDING_APPROVAL", "DRAFT")).toBe(true);
    expect(canTransitionAmendmentStatus("PENDING_APPROVAL", "DRAFT")).toBe(true);
  });
});
