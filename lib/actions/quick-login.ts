"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";
import { isDevMode } from "@/lib/auth/dev-mode";
import { QUICK_LOGIN_PASSWORD, quickLoginSections } from "@/lib/auth/quick-login";

/**
 * UI/UX test branch only: one-click sign-in as a seeded demo person.
 *
 * The browser sends a username; the password is resolved here. Inert unless the
 * app is in development mode, and it accepts only usernames the roster lists —
 * so no fixture or real account can be reached this way.
 */
export async function quickLoginAction(username: string): Promise<{ error: string } | undefined> {
  if (!isDevMode) return { error: "Quick login is available in development only." };

  const listed = (await quickLoginSections()).some((section) => section.people.some((person) => person.username === username));
  if (!listed) return { error: "That account is not on the quick-login list." };

  try {
    await signIn("credentials", { username, password: QUICK_LOGIN_PASSWORD, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Could not sign in as that account." };
    // Re-thrown so Next.js can act on the NEXT_REDIRECT signal signIn raises.
    throw error;
  }
}
