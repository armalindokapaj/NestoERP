import type { Metadata } from "next";

import { PhoneMenu } from "@/components/layout/phone-menu";
import { requireUserContext } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("shell"))("phone.menu") };
}

/**
 * /menu — Menu, the fifth place in the phone's bar (docs/ui/UI-04-navigation-layouts.md
 * §Phone): the workspace, you, every module this person may open by
 * department, and their settings. The same resolved navigation the desktop's
 * Ribbon and logo panel draw, so the phone can never offer more. It opens at
 * any width; from lg the Ribbon is the way round.
 */
export default async function MenuPage() {
  const context = await requireUserContext();
  const [navigation, roles] = await Promise.all([resolveWorkspaceNavigation(context), getTranslations("roles")]);
  return (
    <PhoneMenu
      navigation={navigation}
      account={{
        firstName: context.firstName,
        lastName: context.lastName,
        avatarUrl: context.avatarUrl,
        roleLabel: roles(`${context.role}.label`),
        workspaceName: context.workspace.scopeType === "GROUP" ? context.parentGroup.name : context.company.name,
      }}
    />
  );
}
