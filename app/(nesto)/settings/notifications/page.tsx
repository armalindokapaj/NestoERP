import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { NativeDeviceCard } from "@/components/settings/native-device-card";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import { ProjectNotificationPreferences } from "@/components/settings/project-notification-preferences";
import { QuietHoursCard } from "@/components/settings/quiet-hours-card";
import { listPreferences } from "@/lib/core/notifications/notification.preferences";
import { getQuietHours, listProjectPreferences } from "@/lib/core/notifications/notification.settings";
import { getTranslations } from "@/lib/i18n/server";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.notifications.label") };
}

/** Notification preferences — personal, so every role reaches them (PRD #38 §78). */
export default async function NotificationSettingsPage() {
  const context = await requireSettingsSection("notifications");
  const [t, preferences, quietHours, projects] = await Promise.all([
    getTranslations("settings"),
    listPreferences(context),
    getQuietHours(context),
    listProjectPreferences(context),
  ]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.notifications.label")}
        description={t("sections.notifications.description")}
      />
      <NativeDeviceCard />
      <section className="nesto-card p-6">
        <p className="mb-4 text-table text-fg-muted">{t("notifications.intro")}</p>
        <NotificationPreferences initial={preferences} />
      </section>
      <QuietHoursCard initial={quietHours} />
      <ProjectNotificationPreferences initial={projects} />
    </div>
  );
}
