"use server";

import { AuthError } from "next-auth";

import { DEMO_PASSWORD, demoAccountByUsername } from "@/config/demo-accounts";
import { signIn } from "@/lib/auth";
import { isDemoTenantLogin } from "@/lib/auth/demo-tenants";
import { isDevMode } from "@/lib/auth/dev-role";

/**
 * One-click sign-in as a curated demo persona (spec §65, E-06 §48).
 *
 * The client sends only a username, and only a curated persona or an active
 * login of a demo tenant (D-01 §87) is accepted — the demo password is resolved
 * on the server, so it never reaches the browser bundle, and no fixture account
 * can be signed into this way.
 * Gated on isDevMode, so the action is inert in a production build even if it
 * were somehow invoked.
 */
export async function signInAsDemoAccountAction(
  username: string,
): Promise<{ error: string } | undefined> {
  if (!isDevMode) {
    return { error: "Demo sign-in is available in development only." };
  }

  const curated = demoAccountByUsername(username);
  if (!curated && !(await isDemoTenantLogin(username))) {
    return { error: "Unknown demo account." };
  }

  try {
    await signIn("credentials", {
      username,
      password: DEMO_PASSWORD,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: curated
          ? "Demo account not found. Run pnpm db:seed."
          : "The demo password was refused: a demo tenant seeded with a password of its own signs in through the form.",
      };
    }
    // Re-thrown so Next.js can act on the NEXT_REDIRECT signal signIn raises.
    throw error;
  }
}
