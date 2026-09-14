import { Prisma } from "@prisma/client";
import { z } from "zod";

import { canAccessModule, can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { ROLE_KEYS, roles, type RoleKey } from "@/config/roles";
import type { UserContext } from "@/lib/context/types";
import { eligibleMembersForStep, type StepPlan } from "@/lib/core/approvals/approval-steps";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { amountString } from "@/lib/modules/finance/finance.fields";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { buildOrderScopeWhere } from "../procurement.scope";

/**
 * When a purchase order needs more than one decision (PRD #41 §20, §21, §27,
 * §28, §158-§162).
 *
 * Procurement's own rule, in Procurement's own configuration — never in the
 * Approvals Center, which only shows the steps this writes:
 *
 *   total ≤ Finance limit     Procurement
 *   above the Finance limit   Procurement → Finance
 *   above the executive limit Procurement → Finance → Executive
 *
 * Limits are written in one currency. An order in another currency cannot be
 * compared with them without an exchange rate Procurement does not own, so it
 * takes every configured step: the safe reading of "we cannot tell" (§28).
 * With no limits set, every order is a single Procurement decision, exactly
 * as before the chain existed.
 */

export const PROVIDER_KEY = "procurement";

export type ProcurementApprovalPolicyDTO = {
  financeStepAbove: string | null;
  executiveStepAbove: string | null;
  executiveRoleKey: RoleKey;
  executiveRoleLabel: string;
  currency: string;
  updatedAt: string | null;
};

const optionalLimit = z
  .union([amountString("Limit"), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === undefined || value === null ? null : value));

export const approvalPolicySchema = z
  .object({
    financeStepAbove: optionalLimit,
    executiveStepAbove: optionalLimit,
    executiveRoleKey: z.enum(ROLE_KEYS).default("CEO"),
  })
  .refine(
    (value) =>
      value.financeStepAbove === null ||
      value.executiveStepAbove === null ||
      new Prisma.Decimal(value.executiveStepAbove).gte(value.financeStepAbove),
    { message: "The executive limit cannot be lower than the Finance limit.", path: ["executiveStepAbove"] },
  );

export type ApprovalPolicyInput = z.infer<typeof approvalPolicySchema>;

type PolicyRow = {
  financeStepAbove: Prisma.Decimal | null;
  executiveStepAbove: Prisma.Decimal | null;
  executiveRoleKey: string;
  currency: string;
  updatedAt: Date;
};

function toDTO(row: PolicyRow | null, fallbackCurrency: string): ProcurementApprovalPolicyDTO {
  const roleKey = (ROLE_KEYS as readonly string[]).includes(row?.executiveRoleKey ?? "") ? (row!.executiveRoleKey as RoleKey) : "CEO";
  return {
    financeStepAbove: row?.financeStepAbove?.toFixed(2) ?? null,
    executiveStepAbove: row?.executiveStepAbove?.toFixed(2) ?? null,
    executiveRoleKey: roleKey,
    executiveRoleLabel: roles[roleKey].label,
    currency: row?.currency ?? fallbackCurrency,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function resolveApprovalPolicy(companyId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<PolicyRow | null> {
  return client.procurementApprovalPolicy.findUnique({
    where: { companyId },
    select: { financeStepAbove: true, executiveStepAbove: true, executiveRoleKey: true, currency: true, updatedAt: true },
  });
}

export async function getApprovalPolicy(context: UserContext): Promise<ProcurementApprovalPolicyDTO> {
  assertModule(context, "procurement");
  assertPermission(context, "procurement.approval.view");
  const [row, settings] = await Promise.all([resolveApprovalPolicy(context.companyId), ensureCompanySettings(context.companyId)]);
  return toDTO(row, settings.baseCurrency);
}

export async function updateApprovalPolicy(context: UserContext, input: ApprovalPolicyInput): Promise<ProcurementApprovalPolicyDTO> {
  assertModule(context, "procurement");
  assertPermission(context, "procurement.manage");

  const settings = await ensureCompanySettings(context.companyId);
  const before = await resolveApprovalPolicy(context.companyId);

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.procurementApprovalPolicy.upsert({
      where: { companyId: context.companyId },
      create: {
        companyId: context.companyId,
        financeStepAbove: input.financeStepAbove,
        executiveStepAbove: input.executiveStepAbove,
        executiveRoleKey: input.executiveRoleKey,
        currency: settings.baseCurrency,
        updatedByMemberId: context.membershipId,
      },
      update: {
        financeStepAbove: input.financeStepAbove,
        executiveStepAbove: input.executiveStepAbove,
        executiveRoleKey: input.executiveRoleKey,
        currency: settings.baseCurrency,
        updatedByMemberId: context.membershipId,
      },
      select: { financeStepAbove: true, executiveStepAbove: true, executiveRoleKey: true, currency: true, updatedAt: true },
    });
    // Who changed the limits that decide who approves money is evidence (PRD #41 §158).
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.APPROVAL_POLICY_UPDATED,
        entity: { type: "ProcurementApprovalPolicy", id: context.companyId, label: "Purchase order approval limits" },
        before: before
          ? { financeStepAbove: before.financeStepAbove?.toFixed(2) ?? null, executiveStepAbove: before.executiveStepAbove?.toFixed(2) ?? null, executiveRoleKey: before.executiveRoleKey, currency: before.currency }
          : null,
        after: { financeStepAbove: input.financeStepAbove, executiveStepAbove: input.executiveStepAbove, executiveRoleKey: input.executiveRoleKey, currency: settings.baseCurrency },
      },
      { tx },
    );
    return saved;
  });
  return toDTO(row, settings.baseCurrency);
}

export type OrderChainPlan = {
  steps: StepPlan[];
  /** Why this order needs the steps it has, in words (PRD #41 §81 "Why approval is needed"). */
  reason: string | null;
  currencyMismatch: boolean;
};

function money(amount: Prisma.Decimal | string, currency: string): string {
  return `${currency} ${new Prisma.Decimal(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** The chain an order of this value needs under the company's policy. */
export function planOrderChain(policy: PolicyRow | null, order: { totalAmount: Prisma.Decimal; currency: string }): OrderChainPlan {
  if (!policy || (policy.financeStepAbove === null && policy.executiveStepAbove === null)) {
    return { steps: [], reason: null, currencyMismatch: false };
  }
  const mismatch = order.currency !== policy.currency;
  const above = (limit: Prisma.Decimal | null) => limit !== null && (mismatch || order.totalAmount.gt(limit));

  const extra: StepPlan[] = [];
  const reasons: string[] = [];
  if (above(policy.financeStepAbove)) {
    extra.push({ label: "Finance", approverPermission: "procurement.order.finance_approve" });
    reasons.push(`above ${money(policy.financeStepAbove!, policy.currency)} also need a Finance decision`);
  }
  if (above(policy.executiveStepAbove)) {
    const roleKey = (ROLE_KEYS as readonly string[]).includes(policy.executiveRoleKey) ? (policy.executiveRoleKey as RoleKey) : "CEO";
    extra.push({ label: "Executive", approverRoleKey: roleKey });
    reasons.push(`above ${money(policy.executiveStepAbove!, policy.currency)} also need a ${roles[roleKey].label} decision`);
  }
  if (extra.length === 0) return { steps: [], reason: null, currencyMismatch: false };

  const reason = mismatch
    ? `This order is in ${order.currency}, which the approval limits (${policy.currency}) cannot be compared with, so it takes every configured step.`
    : `Purchase orders ${reasons.join("; ")}.`;
  return { steps: [{ label: "Procurement", approverPermission: "procurement.order.approve" }, ...extra], reason, currencyMismatch: mismatch };
}

/** Whether a member, in their own context, could read and act on this order at all. */
export function orderReadableBy(orderId: string) {
  return async (memberContext: UserContext): Promise<boolean> => {
    if (!canAccessModule(memberContext, "procurement") || !can(memberContext, "procurement.order.view")) return false;
    return (await prisma.purchaseOrder.count({ where: { AND: [buildOrderScopeWhere(memberContext), { id: orderId }] } })) > 0;
  };
}

/**
 * Refuses a chain nobody could finish (PRD #41 §161, §162): every step needs
 * at least one active member, other than the requester, who could decide it
 * and read the order. Nothing falls back to the Owner silently.
 */
export async function assertChainHasApprovers(companyId: string, orderId: string, submittedByMemberId: string, steps: StepPlan[]): Promise<void> {
  for (const step of steps) {
    const found = await eligibleMembersForStep(
      companyId,
      { approverPermission: step.approverPermission ?? null, approverRoleKey: step.approverRoleKey ?? null, approverMemberId: step.approverMemberId ?? null },
      { exclude: [submittedByMemberId], canReadAs: orderReadableBy(orderId), limit: 1 },
    );
    if (found.length === 0) {
      throw new AccessError(
        "VALIDATION_ERROR",
        `Nobody can take the ${step.label} decision on this order. Ask an administrator to give someone that authority, or change the approval limits.`,
        { code: "APPROVAL_NO_ELIGIBLE_APPROVER", step: step.label },
      );
    }
  }
}
