import type { Metadata } from "next";

import { MyDayView } from "@/components/productivity/my-day-view";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireUserContext } from "@/lib/context/current-user";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { getMyDay } from "@/lib/modules/productivity/my-day.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("misc"))("myDay.title") };
}

/**
 * My Day (MOB-06 §7): the person's own attention list, read through one
 * aggregate that asks Tasks, Approvals and Calendar in their own scope.
 * Workspace-neutral like My Work: it follows the active workspace, and in the
 * Group workspace reads across the companies the person works in.
 */
export default async function MyDayPage() {
  const context = await requireUserContext();
  const [day, locale] = await Promise.all([getMyDay(context), getLocale()]);
  return <MyDayView day={day} locale={locale} canCreateTask={!inGroupWorkspace(context) && can(context, "task.create")} canComplete={can(context, "task.complete")} />;
}
