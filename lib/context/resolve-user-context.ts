import { cache } from "react";

import { auth } from "@/lib/auth";
import { resolveContextForSession } from "./build-context";
import type { ContextResult } from "./types";

/**
 * The one server-side context resolver (PRD #6 §86, §88).
 *
 * Session → user → membership → company → role → permissions → module access.
 * The role is the membership's own: nothing a browser sends can replace it
 * (C-01 §6, §30). Every check fails closed: an unreadable step denies rather than falling back
 * to open access (PRD #6 §126).
 *
 * Wrapped in React `cache` so one request resolves one context, however many
 * components ask for it (PRD #6 §123).
 */
export const resolveUserContext = cache(async (): Promise<ContextResult> => {
  const session = await auth();
  const sessionId = session?.user?.sessionId;

  if (!session?.user?.id || !sessionId) {
    return { ok: false, reason: "UNAUTHENTICATED" };
  }

  return resolveContextForSession(sessionId, { expectedUserId: session.user.id });
});
