/**
 * Route classification for middleware (PRD #6 §4, §5, §44).
 *
 * Middleware answers one question only — *is there a session?* — because the
 * session cookie deliberately carries no role or permission data (PRD #6 §27).
 * Authorisation happens server-side, in the layout and page, before any
 * restricted markup is produced. That is what prevents permission flashing
 * (PRD #5 §128).
 *
 * Public routes are listed one by one rather than derived from the marketing
 * navigation: a footer link is a design decision, a public route is a security
 * one, and deriving the second from the first would mean a stray link could
 * open a product route to anonymous visitors.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/forgot-password",
  "/reset-password",
  /* Public site (app/(public)/(site)) */
  "/platform",
  "/pricing",
  "/security",
  "/about",
  "/contact",
  "/faq",
  "/privacy",
  "/terms",
] as const;

/**
 * Public routes whose path carries a secret rather than being a fixed page.
 *
 * An invitation link must work for somebody who has no account yet, so the
 * token segment cannot be enumerated in PUBLIC_ROUTES. Matching by prefix is
 * kept to this one list, and each entry is a deliberate decision — the page
 * itself still treats every invalid token identically (PRD #14 §73, §240).
 */
const PUBLIC_ROUTE_PREFIXES = ["/invite/"] as const;

/** Public routes an authenticated user should never sit on. */
const AUTHED_REDIRECT_ROUTES = ["/login", "/forgot-password", "/reset-password"] as const;

/**
 * Reasons the app itself sent a cookie-carrying visitor back to /login
 * (PRD #6 §50, §51).
 *
 * A session cookie can be perfectly valid and still name a session that no
 * longer exists: the row was revoked, it expired, or the database was reseeded
 * in development. Middleware cannot tell — it reads the cookie and never
 * touches the database (PRD #6 §44). The page can, and redirects to
 * /login?reason=...
 *
 * Middleware has to know that, or the two disagree forever: it bounces the
 * "signed in" visitor to /dashboard, the dashboard resolves no context and
 * sends them straight back, and the login page becomes unreachable behind
 * ERR_TOO_MANY_REDIRECTS — locking the person out of the only page that could
 * have fixed their session.
 */
const DEAD_SESSION_REASONS = ["session-expired", "account-unavailable"] as const;

/** Did a server-side context check already reject the cookie on this request? */
export function isDeadSessionReason(reason: string | null | undefined): boolean {
  return (DEAD_SESSION_REASONS as readonly string[]).includes(reason ?? "");
}

export function isPublicRoute(pathname: string): boolean {
  if ((PUBLIC_ROUTES as readonly string[]).includes(pathname)) return true;
  // An invitation stays reachable while signed in: somebody with an existing
  // account accepts it from their own session (PRD #14 §75).
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length,
  );
}

export function redirectsWhenAuthenticated(
  pathname: string,
  reason?: string | null,
): boolean {
  if (!(AUTHED_REDIRECT_ROUTES as readonly string[]).includes(pathname)) return false;
  // The page already rejected this session against the database. Sending them
  // back into the app would only produce the same rejection.
  return !isDeadSessionReason(reason);
}

/**
 * Signed in, but the workspace itself could not be resolved. These pages must
 * stay reachable while the context is failing, or the person is bounced in a
 * loop with nothing explaining why (PRD #6 §48, §49).
 */
const CONTEXTLESS_ROUTES = ["/workspace-unavailable"] as const;

export function isContextlessRoute(pathname: string): boolean {
  return (CONTEXTLESS_ROUTES as readonly string[]).includes(pathname);
}
