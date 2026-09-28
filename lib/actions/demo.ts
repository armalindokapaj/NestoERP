"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

import { auth, signIn, signOut } from "@/lib/auth";
import { DEMO_ACCOUNT_REFUSALS, resolveDemoAccountTarget } from "@/lib/auth/demo-tenants";
import { isDevMode } from "@/lib/auth/dev-mode";
import { recordAuthEvent } from "@/lib/auth/events";
import { endOwnSession } from "@/lib/auth/session-store";

/**
 * The development role override's cookie. Nothing reads it any more; the
 * switch deletes it so a stale one on a developer's browser is gone (C-01 §28).
 */
const LEGACY_DEV_ROLE_COOKIE = "nesto.dev-role";

/**
 * One-click sign-in as a demo account (spec §65, E-06 §48, D-01 §87).
 *
 * The client sends only a username. Only a curated persona or an active login
 * of a demo tenant is accepted — the demo password is resolved on the server,
 * so it never reaches the browser bundle, and no fixture account can be signed
 * into this way. Gated on isDevMode, so the action is inert in a production
 * build even if it were somehow invoked.
 */
export async function signInAsDemoAccountAction(
  username: string,
): Promise<{ error: string } | undefined> {
  if (!isDevMode) {
    return { error: "Demo sign-in is available in development only." };
  }

  const target = await resolveDemoAccountTarget(String(username), await requestHeaders());
  if (!target.allowed) return { error: DEMO_ACCOUNT_REFUSALS[target.reason] };

  try {
    await signIn("credentials", {
      username: target.username,
      password: target.password,
      via: "DEMO_SIGN_IN",
      redirectTo: target.landing,
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Could not sign in as that demo account." };
    // Re-thrown so Next.js can act on the NEXT_REDIRECT signal signIn raises.
    throw error;
  }
}

export type DemoUserSwitchResult =
  /** `landing` null: the account chosen is the one already signed in, and nothing changed (C-01 §42). */
  | { ok: true; landing: string | null }
  /** `landing` set: the old session had already ended, so the browser goes to sign in (C-01 §46). */
  | { ok: false; error: string; landing?: string };

const SWITCH_FAILED = "Could not switch demo user.";

/** The request's headers, for the throttle's address; none outside a request (a test calling the action). */
async function requestHeaders(): Promise<Headers | null> {
  try {
    return new Headers(await headers());
  } catch {
    return null;
  }
}

/**
 * Becomes another demo user: signing out and signing in as them, without
 * typing (C-01 §1, §11, §19-§24).
 *
 * The browser sends a username and nothing else. The target is validated
 * first, by the rules the credentials check applies, and only then is the
 * current identity replaced: this session's row is deleted and the sign-out
 * recorded, the Auth.js cookie cleared, and the target signed in through the
 * credentials provider — the same pipeline as the form, so its session, its
 * company and its sign-in record are what a normal login makes. The browser
 * then loads the target's landing page from scratch (§47, §48): no page, no
 * client state and no cached route of the previous user comes with it.
 *
 * Development only. Anywhere else it answers as if there were nothing here
 * (§59).
 */
export async function switchDemoUserAction(username: string): Promise<DemoUserSwitchResult> {
  if (!isDevMode) return { ok: false, error: "Not found." };

  // Every refusal the sign-in would give is asked first, while this session
  // still stands: a refused target leaves the current person signed in (RP-03).
  const target = await resolveDemoAccountTarget(String(username), await requestHeaders());
  if (!target.allowed) return { ok: false, error: `${SWITCH_FAILED} ${DEMO_ACCOUNT_REFUSALS[target.reason]}` };

  const current = (await auth())?.user;
  if (current?.id === target.userId) return { ok: true, landing: null };

  // Logout first (§21, §23): the server session ends, not only this browser's cookie.
  if (current?.id && current.sessionId) {
    const ended = await endOwnSession({ sessionId: current.sessionId, userId: current.id });
    if (ended.ended) {
      await recordAuthEvent({
        type: "LOGOUT",
        userId: current.id,
        companyId: ended.companyId,
        sessionId: current.sessionId,
        metadata: { switchType: "DEMO_USER_SWITCH", toUserId: target.userId },
      });
    }
  }
  (await cookies()).delete(LEGACY_DEV_ROLE_COOKIE);
  await signOut({ redirect: false });

  try {
    await signIn("credentials", { username: target.username, password: target.password, via: "DEMO_USER_SWITCH", redirect: false });
  } catch (error) {
    // Signed out already, whatever went wrong: the browser goes to sign in,
    // never back to the previous person's page (§46, AUD-06 RP-03).
    if (!(error instanceof AuthError)) console.error("demo user switch: sign-in failed after sign-out", error instanceof Error ? error.name : "unknown");
    return { ok: false, error: SWITCH_FAILED, landing: "/login?reason=demo-switch-failed" };
  }

  await recordAuthEvent({
    type: "USER_SWITCHED", userId: target.userId,
    metadata: { fromUserId: current?.id ?? null, switchType: "DEMO_USER_SWITCH" },
  });
  revalidatePath("/", "layout");
  return { ok: true, landing: target.landing };
}
