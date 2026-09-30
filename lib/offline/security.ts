import type { AuthorizationSnapshot } from "@/lib/core/sync/authorization.service";

import type { OfflineDatabase } from "./database";

/**
 * Offline authorisation (MOB-09 §56-§62, §97-§99).
 *
 * The device shows protected data only while the server's last confirmation is
 * inside the policy window (`NESTO_OFFLINE_AUTH_HOURS`, sent with every
 * snapshot). After that the data is locked until the server confirms the
 * person again — the pending work is untouched. The window is judged by a clock
 * that cannot be wound back: the latest time ever seen is kept, so setting the
 * phone's date earlier does not extend access (§73).
 */

export type AuthorizationState = {
  /** The server has confirmed this person on this device at least once. */
  known: boolean;
  validatedAt: number | null;
  expiresAt: number | null;
  expired: boolean;
  /** Protected cached data must not be shown. */
  locked: boolean;
  user: { userId: string; fullName: string } | null;
  permissions: string[];
  companyId: string | null;
};

const CLOCK_KEY = "clockHighWater";

export async function authorizationState(db: OfflineDatabase, now: number = Date.now()): Promise<AuthorizationState> {
  const snapshot = await db.getMeta<AuthorizationSnapshot>("authorization");
  if (!snapshot) return { known: false, validatedAt: null, expiresAt: null, expired: false, locked: false, user: null, permissions: [], companyId: null };
  const highWater = (await db.getMeta<number>(CLOCK_KEY)) ?? 0;
  const effectiveNow = Math.max(now, highWater);
  if (effectiveNow > highWater) await db.setMeta(CLOCK_KEY, effectiveNow);
  const expiresAt = new Date(snapshot.offlineAccessExpiresAt).getTime();
  const expired = effectiveNow > expiresAt;
  return {
    known: true,
    validatedAt: new Date(snapshot.validatedAt).getTime(),
    expiresAt,
    expired,
    locked: expired,
    user: { userId: snapshot.user.userId, fullName: snapshot.user.fullName },
    permissions: snapshot.permissions,
    companyId: snapshot.workspace.companyId,
  };
}

/* -------------------------------------------------------------------------- */
/* Who has unsynced work on this device                                        */
/* -------------------------------------------------------------------------- */

const ACCOUNTS_KEY = "nesto.offline.accounts";
const LAST_USER_KEY = "nesto.offline.lastUser";

type Accounts = Record<string, { pending: number; at: number }>;

function readAccounts(): Accounts {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "{}") as Accounts;
  } catch {
    return {};
  }
}

/**
 * A count per user id — no names, no content — so signing out can warn about
 * work that belongs to another account on the same device (§98, §99).
 */
export function recordPending(userId: string, pending: number): void {
  try {
    const accounts = readAccounts();
    if (pending > 0) accounts[userId] = { pending, at: Date.now() };
    else delete accounts[userId];
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Storage may be unavailable; the database itself remains the record.
  }
}

export function otherAccountsWithPending(currentUserId: string): number {
  return Object.entries(readAccounts()).filter(([id]) => id !== currentUserId).reduce((sum, [, value]) => sum + value.pending, 0);
}

export function rememberUser(userId: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    // Without it the offline page cannot know whose database to open after a cold start.
  }
}

export function lastKnownUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}
