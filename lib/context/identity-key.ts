import { createHash } from "node:crypto";

import type { UserContext } from "@/lib/context/types";

/**
 * Opaque keys for who is signed in, for the browser's own tabs (AUD-03 §7).
 *
 * A tab holding unsaved input must know when the browser's session now
 * belongs to somebody else, or to nobody: `user` says whether it is the same
 * person, `session` whether it is the same sign-in. Both are digests — neither
 * id leaves the server — and they are compared, never trusted: the server
 * authorizes every request on its own.
 */
export type IdentityKeys = { user: string; session: string };

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 22);
}

export function identityKeys(context: Pick<UserContext, "userId" | "sessionId">): IdentityKeys {
  return { user: digest(`nesto-user:${context.userId}`), session: digest(`nesto-session:${context.sessionId}`) };
}
