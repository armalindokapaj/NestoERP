import { NeutralPageSkeleton } from "@/components/layout/page-skeletons";

/**
 * The authenticated fallback (NAV-01 LOAD-01, §2.1).
 *
 * `layout.tsx` beside this file stays outside the boundary: sign-in, the
 * session's workspace and maintenance are settled before anything streams.
 * Below it a neutral, data-free surface may stream while module and record
 * guards run. Those guards run in parallel with the shell and usually refuse
 * before it flushes, as a real 307 or 404; when one resolves later, the refusal
 * arrives in the stream instead and the browser still lands on the login,
 * denied, unavailable or not-found screen. A 200 on a streamed document is
 * never evidence of access: every page, service and mutation checks its own,
 * and nothing protected is rendered before that check. API routes keep their
 * real status codes.
 *
 * This supersedes the older rule that the dashboard was the only loading
 * boundary in the app (PRD #5 §128). The route inventory lists every page's
 * nearest boundary and guard: docs/navigation/NAV-01-route-inventory.md.
 */
export default function Loading() {
  return <NeutralPageSkeleton />;
}
