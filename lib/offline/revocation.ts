"use client";

/**
 * Acting on a revocation on this device (MOB-11 §18-§22, §122, §126, §165, §170).
 * This is the offline store's half of security: it owns NESTO's local data, so
 * removing it lives here, and it uses the device layer only for the install id.
 */
import { installId } from "@/lib/device/security-client";
import { nativeSignOutCleanup } from "@/lib/device/device-client";
import { getPlatformServices } from "@/lib/device/registry";
import { clearSecurityLock, removeNestoData, unsyncedForRemoval } from "./removal";
import { knownOfflineUsers } from "./security";

type ProbeRow = { userId: string; status: "ACTIVE" | "REVOKED" | "BLOCKED"; dataRemoval: { mode: "CACHE_ONLY" | "FULL"; reason: "DEVICE" | "ACCOUNT" } | null };

const removedKey = (userId: string) => `nesto.removed.${userId}`;
const wasRemoved = (userId: string, signature: string) => {
  try {
    return localStorage.getItem(removedKey(userId)) === signature;
  } catch {
    return false;
  }
};
const markRemoved = (userId: string, signature: string) => {
  try {
    localStorage.setItem(removedKey(userId), signature);
  } catch {
    // Without it the removal simply runs again, which is harmless.
  }
};

export type RemovalReport = { userId: string; mode: "CACHE_ONLY" | "FULL"; unsynced: number };

/**
 * Asks the server — with no session, since there may be none — whether access
 * was revoked for anyone with data on this device, and removes NESTO's local
 * data where it says to (§20, §126, §165). Returns what was removed so the app
 * can tell the person, including how much unsynced work was affected (§170).
 */
export async function applyRevocations(options: { userIds?: string[] } = {}): Promise<RemovalReport[]> {
  const services = getPlatformServices();
  if (!services.platform.isNative) return [];
  const id = await installId();
  const userIds = (options.userIds ?? knownOfflineUsers()).slice(0, 10);
  if (!id || userIds.length === 0) return [];
  let rows: ProbeRow[];
  try {
    const response = await fetch("/api/app/device-state", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ installId: id, userIds }) });
    if (!response.ok) return [];
    rows = ((await response.json()) as { data: { devices: ProbeRow[] } }).data.devices;
  } catch {
    return [];
  }
  const done: RemovalReport[] = [];
  for (const row of rows) {
    if (!row.dataRemoval) continue;
    // Done already for this instruction: not repeated, and not announced again (a disabled account keeps being told).
    const signature = `${row.dataRemoval.reason}:${row.dataRemoval.mode}`;
    if (wasRemoved(row.userId, signature)) continue;
    const unsynced = await unsyncedForRemoval(row.userId);
    await removeNestoData(row.userId, row.dataRemoval.mode);
    markRemoved(row.userId, signature);
    done.push({ userId: row.userId, mode: row.dataRemoval.mode, unsynced });
    // Reported as what it is: the device saying it did it (§22, `docs/security/device-security.md`).
    await fetch("/api/app/device-state", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ installId: id, userIds: [row.userId], confirmRemovalFor: row.userId }) }).catch(() => undefined);
  }
  return done;
}

/** The session is gone and the device is revoked: what a signed-in app does when it learns that (§18, §20). */
export async function handleRevokedSession(userId: string | null): Promise<RemovalReport[]> {
  const reports = await applyRevocations(userId ? { userIds: [userId, ...knownOfflineUsers().filter((id) => id !== userId)] } : {});
  await nativeSignOutCleanup();
  return reports;
}

/** The server confirmed this person on an active device with nothing to remove: a lock left by an earlier removal lifts. */
export async function liftSecurityLock(userId: string): Promise<void> {
  try {
    localStorage.removeItem(removedKey(userId));
  } catch {
    // Nothing recorded, nothing to forget.
  }
  await clearSecurityLock(userId);
}
