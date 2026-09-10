"use server";

import { AuthError } from "next-auth";

import { DEMO_PASSWORD, demoAccountForRole } from "@/config/demo-company";
import { isRoleKey } from "@/config/roles";
import { signIn } from "@/lib/auth";
import { isDevMode } from "@/lib/auth/dev-role";

/**
 * One-click sign-in as a seeded demo account (spec §65).
 *
 * The client sends only a role key — the demo password is resolved on the
 * server, so it never reaches the browser bundle. Gated on isDevMode, so the
 * action is inert in a production build even if it were somehow invoked.
 */
export async function signInAsDemoRoleAction(
  role: string,
): Promise<{ error: string } | undefined> {
  if (!isDevMode) {
    return { error: "Demo sign-in is available in development only." };
  }

  if (!isRoleKey(role)) {
    return { error: "Unknown role." };
  }

  const account = demoAccountForRole(role);
  if (!account) {
    return { error: "No demo account exists for that role. Run pnpm db:seed." };
  }

  try {
    await signIn("credentials", {
      email: account.email,
      password: DEMO_PASSWORD,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Demo account not found. Run pnpm db:seed." };
    }
    // Re-thrown so Next.js can act on the NEXT_REDIRECT signal signIn raises.
    throw error;
  }
}
