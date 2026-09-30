import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { compareVersions } from "./app-version";
import {
  mobilePolicySettingsSchema,
  resolveMobilePolicy,
  type EffectiveMobilePolicy,
  type MobilePolicySettings,
  type PolicyLevel,
} from "./mobile-policy.schema";

/**
 * Loading and storing the mobile security policy (MOB-11 §73-§82, §179).
 *
 * This file owns `MobileSecurityPolicy`. Who may change which level, and the
 * audit row that records it, belong to the caller (`lib/modules/security`):
 * this layer only knows levels, versions and the merge.
 */

const VERSION = /^\d+\.\d+\.\d+$/;

/** `NESTO_MIN_APP_VERSION` and `NESTO_RECOMMENDED_APP_VERSION`, as `compatibilityPolicy` reads them (MOB-08 §63). */
function environmentVersionPolicy(env: Readonly<Record<string, string | undefined>>): { minimum: string; recommended: string } {
  const minimum = env.NESTO_MIN_APP_VERSION && VERSION.test(env.NESTO_MIN_APP_VERSION) ? env.NESTO_MIN_APP_VERSION : "1.0.0";
  const recommended = env.NESTO_RECOMMENDED_APP_VERSION && VERSION.test(env.NESTO_RECOMMENDED_APP_VERSION) ? env.NESTO_RECOMMENDED_APP_VERSION : minimum;
  return { minimum, recommended: compareVersions(recommended, minimum) < 0 ? minimum : recommended };
}

/** The platform floor that has always come from the environment (MOB-08 §63, MOB-09 §57). */
export function environmentPolicyLevel(env: Readonly<Record<string, string | undefined>> = process.env): PolicyLevel {
  const versions = environmentVersionPolicy(env);
  const hours = Number(env.NESTO_OFFLINE_AUTH_HOURS);
  return {
    scope: "PLATFORM",
    id: "environment",
    version: 0,
    settings: {
      minimumAppVersion: versions.minimum,
      recommendedAppVersion: versions.recommended,
      ...(Number.isFinite(hours) && hours > 0 ? { offlineAuthorizationHours: Math.min(336, Math.max(1, Math.round(hours))) } : {}),
    },
  };
}

type PolicyRow = { scope: "PLATFORM" | "PARENT_GROUP" | "COMPANY"; parentGroupId: string | null; companyId: string | null; version: number; settings: Prisma.JsonValue };

function toLevel(row: PolicyRow, companyGroup?: Map<string, string>): PolicyLevel | null {
  // A row that no longer validates is ignored, never half-applied: a corrupt policy must not loosen or crash anything.
  const parsed = mobilePolicySettingsSchema.safeParse(row.settings);
  if (!parsed.success) return null;
  const id = row.scope === "PLATFORM" ? null : row.scope === "PARENT_GROUP" ? row.parentGroupId : row.companyId;
  return {
    scope: row.scope,
    id,
    parentGroupId: row.scope === "COMPANY" ? (row.companyId ? (companyGroup?.get(row.companyId) ?? null) : null) : row.parentGroupId,
    version: row.version,
    settings: parsed.data,
  };
}

/** Every level that can apply to these companies: platform, their groups, themselves. */
export async function loadPolicyLevels(companies: readonly { id: string; parentGroupId: string }[]): Promise<PolicyLevel[]> {
  const groupIds = [...new Set(companies.map((c) => c.parentGroupId))];
  const companyIds = companies.map((c) => c.id);
  const rows = await prisma.mobileSecurityPolicy.findMany({
    where: { OR: [{ scope: "PLATFORM" }, ...(groupIds.length ? [{ parentGroupId: { in: groupIds } }] : []), ...(companyIds.length ? [{ companyId: { in: companyIds } }] : [])] },
    select: { scope: true, parentGroupId: true, companyId: true, version: true, settings: true },
  });
  const companyGroup = new Map(companies.map((c) => [c.id, c.parentGroupId]));
  return [environmentPolicyLevel(), ...rows.map((row) => toLevel(row, companyGroup)).filter((level): level is PolicyLevel => level !== null)];
}

/**
 * What one device is held to: the platform, the group(s) and every Company the
 * person actively belongs to, strictest value wins. A control that applies to
 * the whole device (app lock, offline window, version) cannot vary per screen,
 * so a person in a strict Company and a lax one is held to the strict one
 * everywhere (MOB-11 §77, §78) — documented in `docs/security/mobile-policy.md`.
 */
export async function effectivePolicyForUser(userId: string): Promise<EffectiveMobilePolicy> {
  const memberships = await prisma.companyMember.findMany({
    where: { userId, status: "ACTIVE", company: { status: "ACTIVE" } },
    select: { company: { select: { id: true, parentGroupId: true } } },
  });
  return resolveMobilePolicy(await loadPolicyLevels(memberships.map((m) => m.company)));
}

/** What a Company's own people are held to, for the administrator's "effective policy" view. */
export async function effectivePolicyForCompany(companyId: string): Promise<EffectiveMobilePolicy | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, parentGroupId: true } });
  return company ? resolveMobilePolicy(await loadPolicyLevels([company])) : null;
}

export type PolicyTarget = { scope: "PLATFORM" } | { scope: "PARENT_GROUP"; id: string } | { scope: "COMPANY"; id: string };

const scopeKey = (target: PolicyTarget) => (target.scope === "PLATFORM" ? "PLATFORM" : `${target.scope === "PARENT_GROUP" ? "GROUP" : "COMPANY"}:${target.id}`);

export async function readPolicyLevel(target: PolicyTarget): Promise<{ settings: MobilePolicySettings; version: number; updatedAt: Date } | null> {
  const row = await prisma.mobileSecurityPolicy.findUnique({ where: { scopeKey: scopeKey(target) }, select: { settings: true, version: true, updatedAt: true } });
  if (!row) return null;
  const parsed = mobilePolicySettingsSchema.safeParse(row.settings);
  return parsed.success ? { settings: parsed.data, version: row.version, updatedAt: row.updatedAt } : null;
}

/** Replaces one level's settings and raises its version. The caller has authorised and will audit it. */
export async function writePolicyLevel(target: PolicyTarget, settings: MobilePolicySettings, updatedById: string | null): Promise<{ version: number; before: MobilePolicySettings | null }> {
  const clean = mobilePolicySettingsSchema.parse(settings);
  const key = scopeKey(target);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.mobileSecurityPolicy.findUnique({ where: { scopeKey: key }, select: { settings: true, version: true } });
    const before = existing ? (mobilePolicySettingsSchema.safeParse(existing.settings).data ?? null) : null;
    const row = existing
      ? await tx.mobileSecurityPolicy.update({ where: { scopeKey: key }, data: { settings: clean as Prisma.InputJsonValue, version: { increment: 1 }, updatedById }, select: { version: true } })
      : await tx.mobileSecurityPolicy.create({
          data: {
            scopeKey: key,
            scope: target.scope,
            parentGroupId: target.scope === "PARENT_GROUP" ? target.id : null,
            companyId: target.scope === "COMPANY" ? target.id : null,
            settings: clean as Prisma.InputJsonValue,
            updatedById,
          },
          select: { version: true },
        });
    return { version: row.version, before };
  });
}
