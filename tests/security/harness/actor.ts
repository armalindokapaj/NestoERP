import type { ContextResult, UserContext } from "@/lib/context/types";

/**
 * Stands in for the cookie half of the context resolver (PRD #47 §153).
 *
 * `resolveUserContext` reads the Auth.js cookie and hands the session id to
 * `resolveContextForSession`. A test has no cookie, so this replaces only that
 * first step: the context itself is still built by the real resolver, from a
 * real session row, against the real database (see `loginAs`). Everything a
 * route does after it has a context — module, permission, scope, record and
 * state checks — runs unmodified.
 *
 * Kept on `globalThis` so the mocked module and the test file share one
 * holder however Vitest instantiates them.
 */
const holder = globalThis as typeof globalThis & { __nestoSecurityActor?: UserContext | null };

export function actAs(context: UserContext | null): void {
  holder.__nestoSecurityActor = context;
}

export function currentActor(): UserContext | null {
  return holder.__nestoSecurityActor ?? null;
}

export async function resolveUserContext(): Promise<ContextResult> {
  const context = currentActor();
  return context ? { ok: true, context } : { ok: false, reason: "UNAUTHENTICATED" };
}
