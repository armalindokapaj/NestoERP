import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import { listPreferences } from "@/lib/core/notifications/notification.preferences";
import { getTranslations } from "@/lib/i18n/server";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.notifications.label") };
}

/** Notification preferences — personal, so every role reaches them (PRD #38 §78). */
export default async function NotificationSettingsPage() {
  const context = await requireSettingsSection("notifications");
  const [t, preferences] = await Promise.all([getTranslations("settings"), listPreferences(context)]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.notifications.label")}
        description={t("sections.notifications.description")}
      />
      <section className="nesto-card p-6">
        <p className="mb-4 text-table text-fg-muted">{t("notifications.intro")}</p>
        <NotificationPreferences initial={preferences} />
      </section>
    </div>
  );
}
