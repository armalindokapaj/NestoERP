import { createHash } from "node:crypto";

import { can } from "@/lib/access/can";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";

import { minimumSyncProtocolVersion, SYNC_PROTOCOL_VERSION } from "./protocol";

/**
 * The authorisation snapshot a device keeps while offline (MOB-09 §56, §57, §61, §62).
 *
 * It lets the device decide what to *show*. It is never what lets a change in:
 * every queued operation is authorised again, live, when it is sent.
 */

/** The permissions the offline screens decide with. Nothing the offline layer does not use is sent. */
export const OFFLINE_PERMISSIONS = [
  "project.view",
  "task.view",
  "task.status.update",
  "task.complete",
  "collaboration.comment.create",
  "daily_log.view",
  "daily_log.create",
  "daily_log.edit",
  "daily_log.submit",
  "hse.incident.view",
  "hse.incident.create",
  "document.view",
  "document.download",
] as const satisfies readonly Permission[];

/** How long a device may keep showing protected data without the server confirming it (§62). Product/security decision; this is the default to confirm. */
export const DEFAULT_OFFLINE_AUTH_HOURS = 72;

export function offlineAuthorizationHours(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const parsed = Number(env.NESTO_OFFLINE_AUTH_HOURS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OFFLINE_AUTH_HOURS;
  return Math.min(336, Math.max(1, Math.round(parsed)));
}

export type AuthorizationSnapshot = {
  protocolVersion: number;
  minimumProtocolVersion: number;
  validatedAt: string;
  offlineAccessExpiresAt: string;
  user: { userId: string; membershipId: string; fullName: string };
  workspace: { parentGroupId: string; companyId: string; companyName: string; scope: string };
  permissions: string[];
  /** A fingerprint of the above, so a device can tell whether its snapshot changed without comparing it. */
  fingerprint: string;
};

export function buildAuthorizationSnapshot(context: UserContext, now: Date = new Date()): AuthorizationSnapshot {
  const permissions = OFFLINE_PERMISSIONS.filter((permission) => can(context, permission)).map(String);
  const expires = new Date(now.getTime() + offlineAuthorizationHours() * 3_600_000);
  const base = {
    user: { userId: context.userId, membershipId: context.membershipId, fullName: context.fullName },
    workspace: { parentGroupId: context.parentGroupId, companyId: context.companyId, companyName: context.company.name, scope: context.workspace.scopeType },
    permissions,
  };
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    minimumProtocolVersion: minimumSyncProtocolVersion(),
    validatedAt: now.toISOString(),
    offlineAccessExpiresAt: expires.toISOString(),
    ...base,
    fingerprint: createHash("sha256").update(JSON.stringify(base)).digest("hex").slice(0, 32),
  };
}
