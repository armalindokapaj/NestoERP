import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { notificationHealth } from "@/lib/core/notifications/push.health";
import { Fact } from "../_parts";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Notification system health (MOB-10 §191, §192): counts and states for the
 * last 24 hours. Nothing about any person — no recipients, tokens, message text
 * or read times.
 */
export default async function NotificationHealthPage() {
  await requirePlatformContext();
  const health = await notificationHealth();
  const mode = { off: "Off — no push is queued", log: "Log only — nothing leaves the server", live: "Live" }[health.mode];
  return (
    <div className="space-y-5">
      <PageHeader title="Notifications" description={`System health, last ${health.windowHours} hours. Accepted by the provider is not delivered, and not read.`} />
      <section className="nesto-card p-5" data-testid="notification-health">
        <h2 className="mb-4 text-card font-semibold">Push</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Mode">{mode}</Fact>
          <Fact label="Apple (APNs) credentials">{health.credentials.apns ? "Configured" : "Not set"}</Fact>
          <Fact label="Google (FCM) credentials">{health.credentials.fcm ? "Configured" : "Not set"}</Fact>
          <Fact label="Registered devices">{health.registeredDevices.ios} iOS · {health.registeredDevices.android} Android</Fact>
          <Fact label="Push attempted">{health.pushAttempted}</Fact>
          <Fact label="Provider accepted">{health.pushAccepted}</Fact>
          <Fact label="Failed">{health.pushFailed}</Fact>
          <Fact label="Invalid tokens">{health.invalidTokens}</Fact>
          <Fact label="Not sent (device gone, already read, …)">{health.pushSuppressed}</Fact>
          <Fact label="Waiting to be sent now">{health.pushQueueDue}</Fact>
        </dl>
      </section>
      <section className="nesto-card p-5">
        <h2 className="mb-4 text-card font-semibold">Events and notifications</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Events processed">{health.eventsProcessed}</Fact>
          <Fact label="Notifications created">{health.notificationsCreated}</Fact>
          <Fact label="Outbox backlog">{health.outboxBacklog}</Fact>
          <Fact label="Outbox events failed">{health.outboxFailed}</Fact>
        </dl>
      </section>
    </div>
  );
}
