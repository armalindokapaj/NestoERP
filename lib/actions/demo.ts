"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";

import { signIn } from "@/lib/auth";
import { DEMO_ACCOUNT_REFUSALS, resolveDemoAccountTarget } from "@/lib/auth/demo-tenants";
import { isDevMode } from "@/lib/auth/dev-mode";

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

/** The request's headers, for the throttle's address; none outside a request (a test calling the action). */
async function requestHeaders(): Promise<Headers | null> {
  try {
    return new Headers(await headers());
  } catch {
    return null;
  }
}
