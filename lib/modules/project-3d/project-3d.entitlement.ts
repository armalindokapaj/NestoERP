import type { Project3DEntitlementStatus } from "@prisma/client";

export type Project3DEntitlementGate = {
  status: Project3DEntitlementStatus;
  viewerEnabled: boolean;
  activatedAt: Date | null;
  expiresAt: Date | null;
};

/** The single entitlement predicate used by Company navigation and bootstrap. */
export function isProject3DEntitlementActive(entitlement: Project3DEntitlementGate | null | undefined, now = new Date()): boolean {
  if (!entitlement || entitlement.status !== "ACTIVE" || !entitlement.viewerEnabled) return false;
  if (entitlement.activatedAt && entitlement.activatedAt > now) return false;
  if (entitlement.expiresAt && entitlement.expiresAt <= now) return false;
  return true;
}

