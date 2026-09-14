import { DAILY_LOG_SEED } from "../../prisma/seed/daily-logs";
import { db, removeRecordTrail } from "./db";

/**
 * Daily log fixtures for E2E (PRD #43 §269-§272).
 *
 * Specs start today's logs on Riverside and the Logistics Hub. Afterwards every
 * log they created goes — with its uploaded photos, the tasks raised from it
 * and the trail it left — while the seeded logs stay exactly as seeded.
 */

const SEEDED = Object.values(DAILY_LOG_SEED) as string[];

export async function removeCreatedDailyLogs(projectIds: string[]): Promise<void> {
  const logs = await db.dailyLog.findMany({ where: { projectId: { in: projectIds }, id: { notIn: SEEDED } }, select: { id: true } });
  const ids = logs.map((row) => row.id);
  if (ids.length === 0) return;
  const tasks = await db.task.findMany({ where: { entityType: "daily_log", entityId: { in: ids } }, select: { id: true } });
  const taskIds = tasks.map((row) => row.id);
  const documents = await db.document.findMany({ where: { entityType: "daily_log", entityId: { in: ids } }, select: { id: true } });
  const documentIds = documents.map((row) => row.id);

  await removeRecordTrail("daily_log", ids);
  await removeRecordTrail("task", taskIds);
  await removeRecordTrail("document", documentIds);
  await db.integrationLink.deleteMany({ where: { integrationType: "DAILY_LOG_RECORD", sourceEntityId: { in: ids } } });
  await db.activity.deleteMany({ where: { entityId: { in: [...ids, ...taskIds, ...documentIds] } } });
  await db.documentUploadSession.deleteMany({ where: { documentId: { in: documentIds } } });
  await db.document.deleteMany({ where: { id: { in: documentIds } } });
  await db.task.deleteMany({ where: { id: { in: taskIds } } });
  await db.dailyLog.deleteMany({ where: { id: { in: ids } } });
}

/** A one-pixel JPEG with an EXIF block, as a phone would send it. */
export function photoWithExif(): Buffer {
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53, 0x20, 0x34, 0x31, 0x2e, 0x33];
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xe1, 0x00, exif.length + 2, ...exif,
    0xff, 0xd9,
  ]);
}
