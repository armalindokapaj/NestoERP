import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODULE_KEYS } from "@/config/modules";
import type { RoleKey } from "@/config/roles";
import { AccessError } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { buildModuleAccess } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";

/**
 * Deciding your own request (2026-11): a CEO, or a member holding CEO access,
 * may decide their own only when nobody else in the company could, and it is
 * recorded. Everybody else is refused as before. The database is replaced by
 * the colleagues each case names; who "could decide it" is the real
 * permission check against the real role matrix.
 */

const colleagues: UserContext[] = [];
const reach = new Map<string, boolean>();

vi.mock("@/lib/database/prisma", () => ({
  prisma: {
    companyMember: {
      findMany: vi.fn(async () =>
        colleagues.map((member) => {
          const [firstName = "", ...rest] = member.fullName.split(" ");
          return { id: member.membershipId, user: { firstName, lastName: rest.join(" ") } };
        }),
      ),
    },
  },
}));
vi.mock("@/lib/context/member-context", () => ({
  buildMemberContexts: vi.fn(async (_companyId: string, ids: string[]) => new Map(colleagues.filter((member) => ids.includes(member.membershipId)).map((member) => [member.membershipId, member]))),
}));
vi.mock("@/lib/core/records/record.registry", () => ({
  canReadRecord: vi.fn(async (member: UserContext) => reach.get(member.membershipId) ?? true),
  recordDefinition: () => ({ moduleKey: "finance", activityEntityType: "Invoice", noun: "Invoice" }),
}));
const recordActivity = vi.fn(async () => undefined);
const recordUserAction = vi.fn(async () => undefined);
vi.mock("@/lib/modules/shared/activity", () => ({ recordActivity: (...args: unknown[]) => recordActivity(...(args as [])) }));
vi.mock("@/lib/core/audit/audit.service", () => ({ recordUserAction: (...args: unknown[]) => recordUserAction(...(args as [])) }));

const { assertOwnDecisionAllowed, holdsCeoRights, mayDecideOwn, ownStepDecision } = await import("@/lib/core/approvals/self-approval");
const { stepEligibility } = await import("@/lib/core/approvals/approval-steps");

let next = 0;
function member(role: RoleKey, options: { ceoAccess?: boolean; name?: string } = {}): UserContext {
  next += 1;
  const moduleAccess = buildModuleAccess(role, MODULE_KEYS, "MEMBER", [], options.ceoAccess ? { role: "CEO", position: "MEMBER" } : undefined);
  const permissions = [...new Set(Object.values(moduleAccess).flatMap((access) => access.permissions))].sort();
  return {
    membershipId: `member_${next}`,
    companyId: "company_1",
    userId: `user_${next}`,
    fullName: options.name ?? `${role} ${next}`,
    role,
    ceoAccess: options.ceoAccess,
    permissions,
    moduleAccess,
  } as unknown as UserContext;
}

const tx = {} as never;
const invoice = (actor: UserContext, own = true) => ({
  own,
  selfPermission: "finance.approval.self" as const,
  record: { type: "invoice" as const, id: "invoice_1" },
  mayDecide: (candidate: UserContext) => can(candidate, "finance.invoice.approve"),
  refusal: () => new AccessError("FORBIDDEN", "You submitted this record, so somebody else has to decide it."),
  tx,
  label: "INV-1",
  decision: "APPROVED",
  actor,
});

beforeEach(() => {
  colleagues.length = 0;
  reach.clear();
  recordActivity.mockClear();
  recordUserAction.mockClear();
});

describe("who holds the CEO's rights", () => {
  it("is the CEO, and anybody holding CEO access on top of their role", () => {
    expect(holdsCeoRights(member("CEO"))).toBe(true);
    expect(holdsCeoRights(member("ARCHITECT", { ceoAccess: true }))).toBe(true);
    expect(holdsCeoRights(member("ARCHITECT"))).toBe(false);
    expect(holdsCeoRights(member("OWNER"))).toBe(false);
  });
});

describe("deciding your own request", () => {
  it("lets a CEO alone decide their own, and records it as self-approved", async () => {
    const ceo = member("CEO");
    // A colleague who cannot decide invoices is nobody else who could.
    colleagues.push(member("VIEWER"), member("ENGINEER"));
    const verdict = await assertOwnDecisionAllowed(ceo, invoice(ceo));
    expect(verdict).toEqual({ own: true, allowed: true, because: "NOBODY_ELSE" });
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity.mock.calls[0]).toEqual([tx, ceo, expect.objectContaining({ action: "APPROVAL_SELF_APPROVED", entityType: "Invoice", entityId: "invoice_1", metadata: expect.objectContaining({ selfApproved: true, reason: "NO_OTHER_APPROVER" }) })]);
    expect(recordUserAction).toHaveBeenCalledTimes(1);
    expect(recordUserAction.mock.calls[0]).toEqual([ceo, expect.objectContaining({ actionKey: "APPROVAL_SELF_APPROVED", metadata: expect.objectContaining({ selfApproved: true, reason: "NO_OTHER_APPROVER" }) }), { tx }]);
  });

  it("refuses a CEO when somebody else could decide it, and names them", async () => {
    const ceo = member("CEO");
    colleagues.push(member("OWNER", { name: "Ana Hoxha" }));
    const error = await assertOwnDecisionAllowed(ceo, invoice(ceo)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccessError);
    expect((error as AccessError).code).toBe("FORBIDDEN");
    expect((error as AccessError).message).toBe("You asked for this, so somebody else has to decide it. Ana Hoxha can.");
    expect((error as AccessError).details).toEqual({ code: "SELF_APPROVAL", approvers: ["Ana Hoxha"] });
    expect(recordActivity).not.toHaveBeenCalled();
    expect(recordUserAction).not.toHaveBeenCalled();
  });

  it("makes the CEO and a CEO-access holder each somebody else for the other", async () => {
    const ceo = member("CEO", { name: "Chief" });
    const holder = member("ARCHITECT", { ceoAccess: true, name: "Holder" });
    colleagues.push(holder);
    await expect(assertOwnDecisionAllowed(ceo, invoice(ceo))).rejects.toThrow("Holder can.");
    colleagues.length = 0;
    colleagues.push(ceo);
    await expect(assertOwnDecisionAllowed(holder, invoice(holder))).rejects.toThrow("Chief can.");
  });

  it("counts only somebody whose scope reaches the record", async () => {
    const ceo = member("CEO");
    const outOfReach = member("OWNER");
    colleagues.push(outOfReach);
    reach.set(outOfReach.membershipId, false);
    await expect(assertOwnDecisionAllowed(ceo, invoice(ceo))).resolves.toMatchObject({ allowed: true, because: "NOBODY_ELSE" });
  });

  it("does not count anybody the module bars from deciding it", async () => {
    const ceo = member("CEO");
    const inspector = member("OWNER");
    colleagues.push(inspector);
    await expect(assertOwnDecisionAllowed(ceo, { ...invoice(ceo), barred: [inspector.membershipId] })).resolves.toMatchObject({ allowed: true });
  });

  it("refuses everybody else with the module's own words, even when nobody else could decide it", async () => {
    // A Procurement buyer decides purchase requests and is no CEO: their own stays somebody else's.
    const buyer = member("PROCUREMENT");
    const error = await assertOwnDecisionAllowed(buyer, {
      ...invoice(buyer),
      selfPermission: "procurement.approval.self",
      mayDecide: (candidate: UserContext) => can(candidate, "procurement.request.approve"),
      refusal: () => new AccessError("FORBIDDEN", "You submitted this, so somebody else has to decide on it.", { code: "SELF_APPROVAL" }),
    }).catch((caught: unknown) => caught);
    expect((error as AccessError).message).toBe("You submitted this, so somebody else has to decide on it.");
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("leaves the Owner's own grant as it was, unconditional and unrecorded", async () => {
    const owner = member("OWNER");
    colleagues.push(member("CEO"));
    await expect(assertOwnDecisionAllowed(owner, invoice(owner))).resolves.toEqual({ own: true, allowed: true, because: "SELF_GRANT" });
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("is not asked about somebody else's request", async () => {
    const ceo = member("CEO");
    colleagues.push(member("OWNER"));
    await expect(assertOwnDecisionAllowed(ceo, invoice(ceo, false))).resolves.toEqual({ own: false });
    expect(await mayDecideOwn(ceo, invoice(ceo, false))).toBe(true);
  });

  it("answers a page's question the same way, without writing anything", async () => {
    const ceo = member("CEO");
    expect(await mayDecideOwn(ceo, invoice(ceo))).toBe(true);
    colleagues.push(member("OWNER"));
    // A new request is a new context: the colleagues are read once per request.
    expect(await mayDecideOwn(member("CEO"), invoice(ceo))).toBe(false);
    expect(await mayDecideOwn(member("FINANCE"), invoice(ceo))).toBe(false);
    expect(recordActivity).not.toHaveBeenCalled();
  });
});

describe("deciding a step of your own chain", () => {
  type Step = Parameters<typeof ownStepDecision>[1]["step"];
  const step = (stepNumber: number, approver: { approverPermission?: string; approverRoleKey?: string; approverMemberId?: string }): Step =>
    ({
      id: `step_${stepNumber}`,
      stepNumber,
      label: stepNumber === 1 ? "Procurement" : "Executive",
      approverMemberId: approver.approverMemberId ?? null,
      approverRoleKey: approver.approverRoleKey ?? null,
      approverPermission: approver.approverPermission ?? null,
      status: "PENDING",
      decidedByMemberId: null,
      onBehalfOfMemberId: null,
      decidedAt: null,
      decisionNote: null,
    }) as Step;
  // A purchase order above the executive limit: Procurement, then the CEO (approval.policy.ts).
  const procurement = step(1, { approverPermission: "procurement.order.approve" });
  const executive = step(2, { approverRoleKey: "CEO" });

  it("does not count the only CEO for the first step when the Executive step after it is theirs", async () => {
    const holder = member("ARCHITECT", { ceoAccess: true, name: "Hana Test" });
    const ceo = member("CEO", { name: "Chief Test" });
    colleagues.push(ceo);
    expect(can(ceo, "procurement.order.approve")).toBe(true);
    // The CEO may not take the Procurement step: the Executive one is kept for them.
    await expect(stepEligibility(ceo, procurement, { providerKey: "procurement", steps: [procurement, executive], submittedByMemberId: holder.membershipId })).resolves.toEqual({ eligible: false, reason: "RESERVED_FOR_LATER_STEP" });
    // So nobody else could take it, and the holder who asked may, rather than leaving the order stuck.
    await expect(ownStepDecision(holder, { submittedByMemberId: holder.membershipId, step: procurement, steps: [procurement, executive] })).resolves.toEqual({ own: true, allowed: true, because: "NOBODY_ELSE" });
    await expect(stepEligibility(holder, procurement, { providerKey: "procurement", steps: [procurement, executive], submittedByMemberId: holder.membershipId, allowSelf: true })).resolves.toEqual({ eligible: true, onBehalfOfMemberId: null });
  });

  it("still counts the CEO, and names them, when no later step is theirs", async () => {
    const holder = member("ARCHITECT", { ceoAccess: true, name: "Hana Test" });
    colleagues.push(member("CEO", { name: "Chief Test" }));
    const verdict = await ownStepDecision(holder, { submittedByMemberId: holder.membershipId, step: procurement, steps: [procurement] });
    expect(verdict).toMatchObject({ own: true, allowed: false, others: [expect.objectContaining({ name: "Chief Test" })] });
  });

  it("counts the CEO again once the Executive step is no longer pending", async () => {
    const holder = member("ARCHITECT", { ceoAccess: true, name: "Hana Test" });
    colleagues.push(member("CEO", { name: "Chief Test" }));
    const closed = { ...executive, status: "CANCELLED" } as Step;
    await expect(ownStepDecision(holder, { submittedByMemberId: holder.membershipId, step: procurement, steps: [procurement, closed] })).resolves.toMatchObject({ own: true, allowed: false });
  });
});
