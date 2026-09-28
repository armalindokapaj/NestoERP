import { incrementCounter, Metric } from "@/lib/core/observability/metrics";

/**
 * What a 3D audit event did, in words the audit reader knows (Experience
 * Editor no-reason PRD §7-§11). No 3D authoring action asks the admin for a
 * reason any more, so every event carries a system-written operation and, where
 * the change can be counted, a summary such as "3 model properties changed".
 * The summary is never phrased as if the admin wrote it (§11).
 *
 * The action keys stay the registered PLATFORM_THREE_D_* ones; the operation is
 * metadata, so older events and their policies read exactly as before.
 */
export type Project3DOperation =
  | "EXPERIENCE_CONFIGURATION_SAVED"
  | "EXPERIENCE_DEFAULTS_RESET"
  | "EXPERIENCE_CREATED"
  | "EXPERIENCE_DETAILS_UPDATED"
  | "MODEL_ATTACHED"
  | "MODEL_DETACHED"
  | "MODEL_REPLACED"
  | "MODEL_UPLOAD_STARTED"
  | "MODEL_UPLOAD_COMPLETED"
  | "MODEL_PREPARATION_RETRIED"
  | "MODEL_SETTINGS_UPDATED"
  | "MODEL_FILE_DELETED"
  | "UNIT_BINDINGS_UPDATED"
  | "RELEASE_PUBLISHED"
  | "RELEASE_ACTIVATED"
  | "STRUCTURE_CREATED"
  | "STRUCTURE_UPDATED"
  | "STRUCTURE_DELETED"
  | "VISIBILITY_CHANGED"
  | "PUBLIC_PROJECTION_PREPARED"
  | "PUBLIC_PROJECTION_APPROVED"
  | "PUBLIC_LINK_ROTATED"
  | "EXPERIENCE_DELETED"
  | "EXPERIENCE_RESTORED"
  | "EXPERIENCE_PURGED";

export function project3DAuditMetadata(operation: Project3DOperation, summary: string | null = null, extra: Record<string, unknown> = {}) {
  return { operation, summary, ...extra };
}

/** Top-level Experience settings that differ between two saved configurations. */
export function changedConfigKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete("updatedAt");
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

export function countSummary(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural} changed`;
}

/** Bindings added, changed and removed between two sets keyed by mesh name. */
export function bindingChangeSummary(
  before: ReadonlyArray<{ meshName: string; projectUnitId: string }>,
  after: ReadonlyArray<{ meshName: string; projectUnitId: string }>,
): { created: number; updated: number; removed: number; summary: string } {
  const old = new Map(before.map((binding) => [binding.meshName, binding.projectUnitId]));
  const next = new Map(after.map((binding) => [binding.meshName, binding.projectUnitId]));
  let created = 0;
  let updated = 0;
  let removed = 0;
  for (const [mesh, unit] of next) {
    if (!old.has(mesh)) created += 1;
    else if (old.get(mesh) !== unit) updated += 1;
  }
  for (const mesh of old.keys()) if (!next.has(mesh)) removed += 1;
  const parts = [created ? `${created} bound` : null, updated ? `${updated} rebound` : null, removed ? `${removed} unbound` : null].filter(Boolean);
  return { created, updated, removed, summary: parts.length ? `Units: ${parts.join(", ")}` : "Unit bindings saved unchanged" };
}

/** The counters §36 asks for; low-cardinality, never an id. */
const COUNTERS = {
  save: Metric.EXPERIENCE_SAVE,
  save_failure: Metric.EXPERIENCE_SAVE_FAILURE,
  detach: Metric.MODEL_DETACH,
  delete: Metric.MODEL_DELETE,
  delete_blocked: Metric.MODEL_DELETE_BLOCKED_DEPENDENCY,
} as const;

export function countProject3DOperation(operation: keyof typeof COUNTERS): void {
  incrementCounter(COUNTERS[operation]);
}

/** A save counted as a success or a failure, whatever the reason it failed. */
export async function countedSave<T>(work: Promise<T>): Promise<T> {
  try {
    const result = await work;
    countProject3DOperation("save");
    return result;
  } catch (error) {
    countProject3DOperation("save_failure");
    throw error;
  }
}
