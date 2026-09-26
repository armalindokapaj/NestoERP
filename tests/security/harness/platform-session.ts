/**
 * Stands in for the Auth.js cookie read behind the platform context
 * (AUD-06 §6, RP-13), as `actor.ts` does for the company one.
 *
 * `resolvePlatformContext` asks `auth()` for the signed-in session and hands
 * its id to `resolvePlatformContextForSession`. A test has no cookie, so this
 * replaces only that read: whichever real session row is set here — a tenant's
 * or the Platform Admin's — is then resolved by the real platform resolver
 * against the real database, and every guard after it runs unmodified.
 *
 * Mock `@/lib/auth` with this module. Only `auth` is ever called on the paths
 * under test; the rest refuse loudly rather than pretend.
 */
const holder = globalThis as typeof globalThis & { __nestoCookieSession?: { userId: string; sessionId: string } | null };

export function signedInAs(session: { userId: string; sessionId: string } | null): void {
  holder.__nestoCookieSession = session;
}

export async function auth(): Promise<{ user: { id: string; sessionId: string } } | null> {
  const session = holder.__nestoCookieSession;
  return session ? { user: { id: session.userId, sessionId: session.sessionId } } : null;
}

const unavailable = () => {
  throw new Error("Not available in the security harness: only auth() is stood in for.");
};

export const signIn = unavailable;
export const signOut = unavailable;
export const handlers = { GET: unavailable, POST: unavailable };
