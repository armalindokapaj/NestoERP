"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/lib/auth";
import { credentialsSchema } from "@/lib/auth/schema";

export type SignInResult = { error: string } | undefined;

/**
 * Credentials sign-in (spec §7).
 * Returns a single generic message on failure — the reason is never disclosed.
 */
export async function signInAction(input: {
  email: string;
  password: string;
  callbackUrl?: string;
}): Promise<SignInResult> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Incorrect email or password." };
  }

  // Only same-origin paths are accepted as a redirect target.
  const callbackUrl =
    input.callbackUrl && input.callbackUrl.startsWith("/") && !input.callbackUrl.startsWith("//")
      ? input.callbackUrl
      : "/dashboard";

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    // Re-thrown so Next.js can act on the NEXT_REDIRECT signal signIn raises.
    throw error;
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
