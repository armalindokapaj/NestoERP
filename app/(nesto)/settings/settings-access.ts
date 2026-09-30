import { redirect } from "next/navigation";

import { findSettingsSection } from "@/config/settings";
import { can, canAccessModule } from "@/lib/access/can";
import { companyRequiredHref, requireUserContext } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";

/**
 * Settings authorisation (PRD #5 §39).
 *
 * Profile and Appearance belong to the person, not the company, so they open
 * for every authenticated user — the top-bar user menu offers Settings to
 * everyone, whatever the role's Settings access, and both open from there. Every other
 * section needs real Settings access, checked here as well as in navigation.
 */
export async function requireSettingsSection(slug: string): Promise<UserContext> {
  const section = findSettingsSection(slug);
  if (!section) redirect("/settings");

  const context = await requireUserContext();

  if (section.personal) return context;

  // Every other section is one company's own — its details, its modules, its
  // numbering, its people. The Group workspace has no company to settle them
  // for, so it asks which (Workspace Context §25, §29). Personal settings are
  // above this: they belong to the person and open in either workspace.
  if (context.workspace.scopeType === "GROUP" && !section.groupCapable) {
    redirect(companyRequiredHref("settings", `/settings/${slug}`));
  }

  if (!canAccessModule(context, "settings") || !can(context, section.permission)) {
    redirect("/access-denied");
  }

  return context;
}
