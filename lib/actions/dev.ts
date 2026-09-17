"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { isMembershipRoleKey } from "@/config/roles";
import { DEV_ROLE_COOKIE, isDevMode, RESET_DEV_ROLE } from "@/lib/auth/dev-role";

/**
 * Development role switcher (spec §66).
 *
 * Guarded on isDevMode so a production build cannot change role, even if the
 * action were somehow invoked.
 */
export async function setDevRoleAction(role: string): Promise<void> {
  if (!isDevMode) return;

  const cookieStore = await cookies();

  if (role === RESET_DEV_ROLE) {
    cookieStore.delete(DEV_ROLE_COOKIE);
  } else if (isMembershipRoleKey(role)) {
    cookieStore.set(DEV_ROLE_COOKIE, role, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
    });
  } else {
    return;
  }

  revalidatePath("/", "layout");
  // The previous page may not exist for the new role, so always land on the
  // one page every role can open.
  redirect("/dashboard");
}
