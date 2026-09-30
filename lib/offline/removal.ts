import { databaseName, OfflineDatabase } from "./database";
import { destroyKey } from "./keys";
import { handleRevokedProject } from "./projects";
import { offlineRuntime } from "./runtime";
import { forgetOfflineUser, SECURITY_LOCK_KEY } from "./security";

/**
 * NESTO Data Removal (MOB-11 §19-§22, §58, §61, §151).
 *
 * What the app does, when it learns access was revoked, to NESTO's own data on
 * this device. It is not a device wipe and never claims to be: nothing outside
 * NESTO's storage is touched, and a device that never calls in again keeps
 * whatever it holds — which is what the offline authorization window and the
 * sealed, Keychain/Keystore-keyed database are for.
 *
 * - `CACHE_ONLY` (an ordinary revoke, or removed access): everything that came
 *   from the server goes — cached records, downloaded documents, the
 *   authorisation snapshot — and the workspace is locked. The person's unsynced
 *   work is *not* destroyed silently (principle 12), but it cannot be sent: the
 *   session is gone and the server refuses a revoked device, so nothing uploads
 *   under revoked authority (§22). It stays sealed until an administrator
 *   restores the device, or the person discards it.
 * - `FULL` (lost or blocked): the local database and its key are destroyed,
 *   unsynced work included. The person is told, before the data is gone, in the
 *   message the caller shows.
 */

async function deleteDatabase(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    // A connection somewhere still open: resolve; the delete completes as soon as it closes.
    request.onblocked = () => resolve();
  });
}

/** How many unsynced items a removal will leave locked (CACHE_ONLY) or destroy (FULL), for the message. */
export async function unsyncedForRemoval(userId: string): Promise<number> {
  try {
    const db = await OfflineDatabase.openFor(userId);
    try {
      return (await db.listMutationRecords()).length + (await db.listFiles()).length;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

export async function removeNestoData(userId: string, mode: "CACHE_ONLY" | "FULL", now: number = Date.now()): Promise<{ unsynced: number }> {
  const runtime = offlineRuntime();
  if (runtime.getState().userId === userId) runtime.stop();
  const unsynced = await unsyncedForRemoval(userId);

  if (mode === "FULL") {
    await deleteDatabase(databaseName(userId));
    await destroyKey(userId).catch(() => undefined);
    forgetOfflineUser(userId);
    return { unsynced };
  }

  const db = await OfflineDatabase.openFor(userId);
  try {
    for (const { record } of await db.listProjects()) await handleRevokedProject(db, record.projectId, now);
    // A project with no row still has cache under it if a pull was interrupted; clear by the ids the cache knows.
    await db.setMeta("authorization", null);
    await db.setMeta(SECURITY_LOCK_KEY, { at: now });
  } finally {
    db.close();
  }
  return { unsynced };
}

/** The server has confirmed the person on an active device again: the security lock comes off (MOB-11 §60). */
export async function clearSecurityLock(userId: string): Promise<void> {
  try {
    const db = await OfflineDatabase.openFor(userId);
    try {
      if (await db.getMeta(SECURITY_LOCK_KEY)) await db.setMeta(SECURITY_LOCK_KEY, null);
    } finally {
      db.close();
    }
  } catch {
    // No database for this person yet, or storage unavailable: nothing to unlock.
  }
}
