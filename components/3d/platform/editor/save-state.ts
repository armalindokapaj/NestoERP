import { isFailure } from "@/components/engineering/engineering-api";

/**
 * The Experience Editor's save state (3D Editor PRD §39, §226, §227).
 *
 * A failed save leaves the changes in the tab, so "failed" is only ever shown
 * while something is still unsaved; the next edit or save attempt moves on.
 */
export type EditorSaveStatus = "saved" | "unsaved" | "saving" | "failed";

export const SAVE_STATUS_LABEL: Record<EditorSaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Save failed",
};

export function editorSaveStatus(state: { dirty: boolean; saving: boolean; failed: boolean }): EditorSaveStatus {
  if (state.saving) return "saving";
  if (!state.dirty) return "saved";
  return state.failed ? "failed" : "unsaved";
}

/**
 * Why a save was refused, when the answer changes what the editor offers:
 * - conflict: another session saved first; reload the latest draft (§44, §233).
 * - session: the sign-in ended; sign in again, the changes are still here (§152).
 * - access: the Platform access behind this tab changed (§154, §155).
 */
export type SaveFailureKind = "conflict" | "session" | "access" | "other";

const RACE_CODES = new Set(["EXPERIENCE_RACED", "MODEL_RACED"]);

export function classifySaveFailure(failure: unknown): SaveFailureKind {
  if (!isFailure(failure)) return "other";
  if (failure.status === 401 || failure.code === "UNAUTHENTICATED") return "session";
  if (failure.status === 403 || failure.code === "FORBIDDEN") return "access";
  if (failure.code === "CONFLICT" && failure.detailCode && RACE_CODES.has(failure.detailCode)) return "conflict";
  return "other";
}

/** The notice shown under the top bar; each asks for one decision. */
export type EditorNotice =
  | { kind: "conflict"; revision: number | null }
  | { kind: "session" }
  | { kind: "access" };

/** A focus check's answer: the saved revision, or the refusal it met. */
export function noticeForStateCheck(
  result: { ok: true; revision: number } | { ok: false; status: number },
  localRevision: number,
): EditorNotice | null {
  if (result.ok) return result.revision > localRevision ? { kind: "conflict", revision: result.revision } : null;
  if (result.status === 401) return { kind: "session" };
  if (result.status === 403 || result.status === 404) return { kind: "access" };
  return null;
}

/** Panel widths stay inside their limits so the viewport keeps its working area (§188, §189). */
export const PANEL_LIMITS = {
  left: { min: 200, max: 420, initial: 256 },
  right: { min: 260, max: 480, initial: 320 },
} as const;

export function clampPanelWidth(side: keyof typeof PANEL_LIMITS, width: number): number {
  const { min, max, initial } = PANEL_LIMITS[side];
  if (!Number.isFinite(width)) return initial;
  return Math.round(Math.min(max, Math.max(min, width)));
}
