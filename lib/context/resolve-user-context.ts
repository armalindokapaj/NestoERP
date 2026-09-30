import { cache } from "react";

import { auth } from "@/lib/auth";
import { Metric, recordDuration } from "@/lib/core/observability/metrics";
import { resolveContextForSession } from "./build-context";
import { scoped } from "@/lib/core/observability/request-scope";
import type { ContextResult } from "./types";

/**
 * The one server-side context resolver (PRD #6 §86, §88).
 *
 * Session → user → membership → company → role → permissions → module access.
 * The role is the membership's own: nothing a browser sends can replace it
 * (C-01 §6, §30). Every check fails closed: an unreadable step denies rather than falling back
 * to open access (PRD #6 §126).
 *
 * One request resolves one context, however many components ask for it
 * (PRD #6 §123): React `cache` in a render, and the request scope in a route
 * handler, where `cache` holds nothing (NAV-02 CTX-01, C07). The next request
 * resolves the session again from the database.
 */
export const resolveUserContext = cache(
  (): Promise<ContextResult> =>
    scoped("user-context", async () => {
      const startedAt = performance.now();
      const session = await auth();
      const sessionId = session?.user?.sessionId;

      if (!session?.user?.id || !sessionId) {
        return { ok: false, reason: "UNAUTHENTICATED" } as const;
      }

      const result = await resolveContextForSession(sessionId, { expectedUserId: session.user.id });
      recordDuration(Metric.CONTEXT_RESOLVE_MS, Metric.CONTEXT_RESOLVE, startedAt);
      return result;
    }),
);

/**
 * The same resolver for the few endpoints that must still answer an app whose
 * device was revoked or is out of date: they tell it so (MOB-11 §20, §139).
 * Everything else about the session — expiry, user, membership, company — is
 * checked exactly as above.
 */
export const resolveUserContextIgnoringDevice = cache(
  (): Promise<ContextResult> =>
    scoped("user-context-ignoring-device", async () => {
      const session = await auth();
      const sessionId = session?.user?.sessionId;
      if (!session?.user?.id || !sessionId) return { ok: false, reason: "UNAUTHENTICATED" } as const;
      return resolveContextForSession(sessionId, { expectedUserId: session.user.id, ignoreDevice: true });
    }),
);
