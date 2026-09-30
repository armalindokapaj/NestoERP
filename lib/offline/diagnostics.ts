import { SYNC_PROTOCOL_VERSION } from "@/lib/core/sync/protocol";

import { OFFLINE_SCHEMA_VERSION, type OfflineDatabase } from "./database";
import { describeQueue } from "./queue";

/**
 * What support may see (MOB-09 §87, §88): counts, versions and times — never a
 * payload, a name or a photo.
 */

export const SYNC_ENGINE_VERSION = "1.0.0";

export type SyncDiagnostics = {
  lastSuccessfulSyncAt: number | null;
  pendingOperations: number;
  failedOperations: number;
  needsReviewOperations: number;
  databaseVersion: number;
  syncProtocolVersion: number;
  syncEngineVersion: string;
  appVersion: string | null;
  platform: string;
};

export async function collectDiagnostics(db: OfflineDatabase, app: { platform: string; version: string | null }): Promise<SyncDiagnostics> {
  const queue = await describeQueue(db);
  return {
    lastSuccessfulSyncAt: await db.getMeta<number>("lastSyncAt"),
    pendingOperations: queue.pending + queue.syncing + queue.blocked,
    failedOperations: queue.failed,
    needsReviewOperations: queue.needsReview,
    databaseVersion: OFFLINE_SCHEMA_VERSION,
    syncProtocolVersion: SYNC_PROTOCOL_VERSION,
    syncEngineVersion: SYNC_ENGINE_VERSION,
    appVersion: app.version,
    platform: app.platform,
  };
}
