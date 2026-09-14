import { execFileSync } from "node:child_process";

import { ENGINEERING_SEED, seedContractorEngineeringRecords } from "../../prisma/seed/engineering";
import { db, removeRecordTrail } from "./db";

/**
 * Contractor and engineering fixtures for E2E (PRD #46 §308-§313).
 *
 * Specs create contractors, RFIs, submittals and drawings, upload revision
 * files and move seeded records along. `restoreContractorsEngineering` puts
 * every contractor and engineering record back exactly as the seed leaves it,
 * and removes what the run made around them: uploaded files, follow-up tasks,
 * discussion threads, activity and recent-work rows.
 */

export { ENGINEERING_SEED };
export const PROJECT = "project_a";

const TYPES = ["contractor", "work_package", "contractor_compliance", "engineering_document", "rfi", "technical_submittal", "transmittal"] as const;

/** Seeded ids are readable (`rfi_riverside_001`); what the app creates is a cuid. */
const created = (id: string) => !id.includes("_");
/** An uploaded file's id is `doc_` and 32 hex digits (upload.service); seeded files are named. */
const uploaded = (id: string) => /^doc_[0-9a-f]{32}$/.test(id);

async function createdIds(): Promise<Record<(typeof TYPES)[number], string[]>> {
  const pick = (rows: Array<{ id: string }>) => rows.map((row) => row.id).filter(created);
  const [contractor, workPackage, compliance, document, rfi, submittal, transmittal] = await Promise.all([
    db.contractorProfile.findMany({ select: { id: true } }),
    db.workPackage.findMany({ select: { id: true } }),
    db.contractorComplianceItem.findMany({ select: { id: true } }),
    db.engineeringDocument.findMany({ select: { id: true } }),
    db.rfi.findMany({ select: { id: true } }),
    db.technicalSubmittal.findMany({ select: { id: true } }),
    db.documentTransmittal.findMany({ select: { id: true } }),
  ]);
  return {
    contractor: pick(contractor),
    work_package: pick(workPackage),
    contractor_compliance: pick(compliance),
    engineering_document: pick(document),
    rfi: pick(rfi),
    technical_submittal: pick(submittal),
    transmittal: pick(transmittal),
  };
}

export async function restoreContractorsEngineering(): Promise<void> {
  const ids = await createdIds();
  for (const type of TYPES) await removeRecordTrail(type, ids[type]);
  const everyCreated = TYPES.flatMap((type) => ids[type]);

  const tasks = await db.task.findMany({ where: { entityType: { in: [...TYPES] } }, select: { id: true } });
  const taskIds = tasks.map((row) => row.id);
  await removeRecordTrail("task", taskIds);
  await db.activity.deleteMany({ where: { entityId: { in: [...everyCreated, ...taskIds] } } });
  await db.task.deleteMany({ where: { id: { in: taskIds } } });

  const members = await db.companyMember.findMany({ select: { id: true, userId: true } });
  await seedContractorEngineeringRecords(db, new Map(members.map((row) => [row.userId, row.id])));

  // Files the run uploaded onto these records, once no revision or transmittal points at them.
  const uploads = (await db.document.findMany({ where: { entityType: { in: [...TYPES] } }, select: { id: true } })).map((row) => row.id).filter(uploaded);
  if (uploads.length) {
    await removeRecordTrail("document", uploads);
    await db.activity.deleteMany({ where: { entityId: { in: uploads } } });
    await db.documentUploadSession.deleteMany({ where: { documentId: { in: uploads } } });
    await db.documentVersion.deleteMany({ where: { documentId: { in: uploads } } });
    await db.document.deleteMany({ where: { id: { in: uploads } } });
  }
  await db.recentItem.deleteMany({ where: { entityId: { in: [...everyCreated, ...uploads] } } });
  await db.userFavorite.deleteMany({ where: { entityId: { in: [...everyCreated, ...uploads] } } });
}

function runWorker(args: string[]) {
  execFileSync("npx", ["tsx", ...args], { stdio: "pipe", env: process.env, timeout: 120_000 });
}

/** Delivers queued notification events, as the worker would. */
export const dispatchNotifications = () => runWorker(["scripts/notifications.ts", "--limit=500"]);

/** Runs one scheduled job now, whenever it last ran. */
export async function runJob(job: string): Promise<void> {
  await db.workerHeartbeat.updateMany({ where: { job }, data: { nextRunAt: null, leaseOwner: null, leaseExpiresAt: null } });
  runWorker(["scripts/worker.ts", "--once", `--job=${job}`]);
}

/** A small, real PDF — the upload pipeline reads the bytes, not the name. */
export function pdf(label: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`) };
}

/** YYYY-MM-DD, `days` from today. */
export function isoDay(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
