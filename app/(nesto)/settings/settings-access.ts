import { redirect } from "next/navigation";

import { findSettingsSection } from "@/config/settings";
import { can, canAccessModule } from "@/lib/access/can";
import { requireUserContext } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";

/**
 * Settings authorisation (PRD #5 §39).
 *
 * Profile and Appearance belong to the person, not the company, so they open
 * for every authenticated user — the top-bar user menu offers Profile and
 * Settings to everyone, whatever the role's Settings access. Every other
 * section needs real Settings access, checked here as well as in navigation.
 */
export async function requireSettingsSection(slug: string): Promise<UserContext> {
  const section = findSettingsSection(slug);
  if (!section) redirect("/settings");

  const context = await requireUserContext();

  if (section.personal) return context;

  if (!canAccessModule(context, "settings") || !can(context, section.permission)) {
    redirect("/access-denied");
  }

  return context;
}
