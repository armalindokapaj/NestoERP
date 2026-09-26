import type { SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * Translating what an editor's save answered into the save-outcome contract
 * (AUD-03 §6).
 *
 * Only an explicit `{ ok: true }` is persistence. `undefined`, a finished
 * transition or a refresh prove nothing; a thrown request may or may not have
 * committed, so it is `unknown` — unless it is the context guard's refusal,
 * which is definite: the server refused before doing anything.
 */

/** The workspace a tab rendered, sent with its state-changing requests (lib/context/tab-workspace.ts). */
export const TAB_WORKSPACE_HEADER = "x-nesto-workspace";

/** The digest the server's stale-context refusal travels with (lib/context/tab-workspace.ts). */
export const STALE_WORKSPACE_DIGEST = "NESTO_WORKSPACE_CHANGED";

/** Business codes that mean a newer version exists: the module's conflict workflow takes over. */
const CONFLICT = /(^|_)CONFLICT$|^STALE_|VERSION_CONFLICT|_CHANGED$/;
/** Codes that mean this person may not make this change here now. */
const REFUSED = new Set([
  "UNAUTHENTICATED",
  "SESSION_EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "MEMBERSHIP_INACTIVE",
  "MODULE_UNAVAILABLE",
  "COMPANY_REQUIRED",
  "WORKSPACE_CHANGED",
]);

export type ActionLikeResult =
  | { ok: true; redirectTo?: string }
  | { ok: false; code?: string; error?: string; fieldErrors?: Record<string, string[] | undefined>; duplicates?: unknown[] }
  | undefined
  | null;

export function outcomeOf(result: ActionLikeResult): SaveOutcome {
  if (!result) return { kind: "unknown" };
  if (result.ok) return { kind: "committed", redirectTo: result.redirectTo };
  const code = result.code ?? "";
  if (code === "UNCONFIRMED") return { kind: "unknown" };
  if (result.duplicates && result.duplicates.length > 0) return { kind: "decision" };
  if (REFUSED.has(code)) return { kind: "refused" };
  if (CONFLICT.test(code)) return { kind: "conflict" };
  if (code === "TEMPORARILY_UNAVAILABLE" || code === "INTERNAL_ERROR") return { kind: "failed" };
  // Field errors, or a business refusal the action explained in words.
  return { kind: "invalid" };
}

/** Next's own control flow (a redirect, a not-found) travels as a thrown value with a NEXT_ digest. */
export function isNextControlFlow(thrown: unknown): boolean {
  return Boolean(thrown && typeof thrown === "object" && "digest" in thrown && String((thrown as { digest: unknown }).digest).startsWith("NEXT_"));
}

export function isStaleWorkspaceRefusal(thrown: unknown): boolean {
  return Boolean(thrown && typeof thrown === "object" && "digest" in thrown && String((thrown as { digest: unknown }).digest).startsWith(STALE_WORKSPACE_DIGEST));
}

/** The copy for an outcome that kept the draft (§6). */
export const OUTCOME_COPY = {
  notSaved: "Changes weren't saved. Your entries are still here.",
  unknown: "We couldn't confirm whether this saved. Check the record before trying again.",
  staleWorkspace: "Your workspace changed in another tab, so nothing was saved. Your entries are still here.",
} as const;
