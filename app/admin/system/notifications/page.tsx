import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { notificationHealth } from "@/lib/core/notifications/push.health";
import { Fact } from "../_parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPlatform");
  return { title: t("system.notifications.metaTitle") };
}

/**
 * Notification system health (MOB-10 §191, §192): counts and states for the
 * last 24 hours. Nothing about any person — no recipients, tokens, message text
 * or read times.
 */
export default async function NotificationHealthPage() {
  const t = await getTranslations("adminPlatform");
  await requirePlatformContext();
  const health = await notificationHealth();
  const mode = t(`system.notifications.modes.${health.mode}` as never);
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.notifications.title")} description={t("system.notifications.description", { hours: health.windowHours })} />
      <section className="nesto-card p-5" data-testid="notification-health">
        <h2 className="mb-4 text-card font-semibold">{t("system.notifications.push")}</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t("system.notifications.mode")}>{mode}</Fact>
          <Fact label={t("system.notifications.apns")}>{health.credentials.apns ? t("system.notifications.configured") : t("system.notifications.notSet")}</Fact>
          <Fact label={t("system.notifications.fcm")}>{health.credentials.fcm ? t("system.notifications.configured") : t("system.notifications.notSet")}</Fact>
          <Fact label={t("system.notifications.registered")}>{t("system.notifications.registeredValue", { ios: health.registeredDevices.ios, android: health.registeredDevices.android })}</Fact>
          <Fact label={t("system.notifications.attempted")}>{health.pushAttempted}</Fact>
          <Fact label={t("system.notifications.accepted")}>{health.pushAccepted}</Fact>
          <Fact label={t("system.notifications.failed")}>{health.pushFailed}</Fact>
          <Fact label={t("system.notifications.invalid")}>{health.invalidTokens}</Fact>
          <Fact label={t("system.notifications.suppressed")}>{health.pushSuppressed}</Fact>
          <Fact label={t("system.notifications.queueDue")}>{health.pushQueueDue}</Fact>
        </dl>
      </section>
      <section className="nesto-card p-5">
        <h2 className="mb-4 text-card font-semibold">{t("system.notifications.events")}</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t("system.notifications.processed")}>{health.eventsProcessed}</Fact>
          <Fact label={t("system.notifications.created")}>{health.notificationsCreated}</Fact>
          <Fact label={t("system.notifications.backlog")}>{health.outboxBacklog}</Fact>
          <Fact label={t("system.notifications.outboxFailed")}>{health.outboxFailed}</Fact>
        </dl>
      </section>
    </div>
  );
}
