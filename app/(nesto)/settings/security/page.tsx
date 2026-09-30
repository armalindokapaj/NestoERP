import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { DeviceList, type OwnDeviceRow } from "@/components/security/device-list";
import { NativeDeviceCard } from "@/components/settings/native-device-card";
import { SessionList } from "@/components/settings/session-list";
import { requireSettingsSection } from "../settings-access";
import { getTranslations } from "@/lib/i18n/server";
import { prisma } from "@/lib/database/prisma";
import * as account from "@/lib/modules/account/account.service";
import { ownDevices, listOwnSecurityEvents } from "@/lib/modules/security/security.service";
import { formatDateTime } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.security.label") };
}

/**
 * Settings → Security (MOB-11 §15, §31, §117): the person's own devices and
 * sessions, and the way to end either. A personal page: every signed-in person
 * has it, in either workspace.
 */
export default async function SecuritySettingsPage() {
  const context = await requireSettingsSection("security");
  const [t, sessions, devices, events, revokedByMe] = await Promise.all([
    getTranslations("security"),
    account.listSessions(context),
    ownDevices(context),
    listOwnSecurityEvents(context, 10),
    prisma.deviceRegistration.findMany({ where: { userId: context.userId, status: "REVOKED", revokedById: context.userId }, select: { id: true } }),
  ]);
  const restorable = new Set(revokedByMe.map((row) => row.id));

  const rows: OwnDeviceRow[] = devices.map((device) => ({
    id: device.id,
    name: device.name,
    platform: device.platform,
    deviceClass: device.deviceClass,
    osVersion: device.osVersion,
    appVersion: device.appVersion,
    appBuild: device.appBuild,
    status: device.status,
    complianceState: device.complianceState,
    complianceReasons: device.complianceReasons,
    appLockEnabled: device.appLockEnabled,
    pushEnabled: device.pushEnabled,
    activeSessions: device.activeSessions,
    current: device.current,
    lastActiveLabel: formatDateTime(device.lastSeenAt),
    firstSeenLabel: formatDateTime(device.firstSeenAt),
    dataRemoval: device.dataRemoval ? { mode: device.dataRemoval.mode, confirmed: Boolean(device.dataRemoval.confirmedAt) } : null,
    canRestore: restorable.has(device.id),
  }));

  return (
    <div className="space-y-5">
      <SettingsPageHeader title={t("title")} description={t("description")} />

      <section className="nesto-card p-6" aria-labelledby="my-devices-title">
        <h2 id="my-devices-title" className="text-card font-semibold text-fg">{t("devices.title")}</h2>
        <p className="mt-1 text-table text-fg-muted">{t("devices.description")}</p>
        <div className="mt-4">
          <DeviceList devices={rows} />
        </div>
      </section>

      <NativeDeviceCard />

      <section className="nesto-card p-6" aria-labelledby="security-sessions-title">
        <h2 id="security-sessions-title" className="text-card font-semibold text-fg">{(await getTranslations("settings"))("profile.sessions.title")}</h2>
        <div className="mt-4">
          <SessionList
            sessions={sessions.map((session) => ({
              id: session.id,
              current: session.current,
              device: session.device,
              client: session.client,
              companyName: session.companyName,
              lastActiveLabel: formatDateTime(session.lastActiveAt),
              startedLabel: formatDateTime(session.createdAt),
              expiresLabel: formatDateTime(session.expiresAt),
            }))}
          />
        </div>
      </section>

      <section className="nesto-card p-6" aria-labelledby="security-events-title">
        <h2 id="security-events-title" className="text-card font-semibold text-fg">{t("events.title")}</h2>
        {events.length === 0 ? (
          <p className="mt-3 text-meta text-fg-subtle">{t("events.none")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line" data-testid="own-security-events">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-table">
                <span className="text-fg">{t(`events.types.${event.type}`)}</span>
                <span className="text-meta text-fg-subtle">{formatDateTime(event.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
