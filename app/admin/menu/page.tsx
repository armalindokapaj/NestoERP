import type { Metadata } from "next";

import { AdminMenu } from "@/components/platform/admin-menu";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin"))("shell.menu") };
}

/**
 * /admin/menu — Menu, the last place in the console's phone bar
 * (docs/ui/UI-09-admin-console.md §Phone): you, every page this person may
 * open by area, and Day or Night, language, Help and Sign out. It opens at
 * any width; from lg the Ribbon and the logo's panel are the way round.
 */
export default async function AdminMenuPage() {
  const context = await requirePlatformContext();
  return (
    <AdminMenu
      user={{ id: context.userId, name: context.fullName, firstName: context.firstName, lastName: context.fullName.slice(context.firstName.length).trim(), email: context.email, username: context.username }}
      permissions={context.permissions}
    />
  );
}
