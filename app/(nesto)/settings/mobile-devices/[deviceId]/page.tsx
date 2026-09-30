import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { AdminDeviceActions } from "@/components/security/admin-device-actions";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { getTranslations } from "@/lib/i18n/server";
import { getDevice } from "@/lib/modules/security/security.service";
import { formatDateTime } from "@/lib/utils/format";
import { requireSettingsSection } from "../../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.mobile-devices.label") };
}

type Params = { params: Promise<{ deviceId: string }> };

const STATUS_TONE = { ACTIVE: "success", STALE: "default", REVOKED: "danger", BLOCKED: "danger" } as const;

/**
 * One device, for an administrator (MOB-11 §28, §29). What the server knows
 * about the installed app — never anything it has read or written. A device out
 * of scope is a 404, like one that does not exist.
 */
export default async function MobileDevicePage({ params }: Params) {
  const context = await requireSettingsSection("mobile-devices");
  const { deviceId } = await params;
  const t = await getTranslations("security");
  const device = await getDevice(context, deviceId).catch((error) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const unknown = t("admin.devices.detail.unknown");

  const rows: Array<[string, React.ReactNode]> = [
    [t("admin.devices.detail.user"), <>{device.user.fullName} <span className="text-fg-subtle">· {device.user.username}</span></>],
    [t("admin.devices.detail.company"), device.companies.join(", ") || unknown],
    [t("admin.devices.detail.platform"), device.platform === "IOS" ? "iOS" : "Android"],
    [t("admin.devices.detail.os"), device.osVersion ?? unknown],
    [t("admin.devices.detail.app"), `${device.appVersion}${device.appBuild ? ` (${device.appBuild})` : ""}`],
    [t("admin.devices.detail.firstSeen"), formatDateTime(device.firstSeenAt)],
    [t("admin.devices.detail.lastSeen"), formatDateTime(device.lastSeenAt)],
    [t("admin.devices.detail.sessions"), String(device.activeSessions)],
    [t("admin.devices.detail.push"), t(`devices.push.${device.pushEnabled ? "ON" : "OFF"}`)],
    [t("admin.devices.detail.lock"), device.appLockEnabled === null ? unknown : t(`devices.appLock.${device.appLockEnabled ? "ON" : "OFF"}`)],
    [t("admin.devices.detail.compliance"), t(`devices.compliance.${device.complianceState as "COMPLIANT"}`)],
    // Reported by the app, never verified by an MDM (MOB-11 §10): shown as what it is.
    [t("admin.devices.detail.managed"), device.managedState === "UNKNOWN" ? unknown : device.managedState],
  ];

  return (
    <div className="space-y-5">
      <SettingsPageHeader title={device.name} description={device.user.fullName} />
      <section className="nesto-card p-6" aria-labelledby="device-detail-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="device-detail-title" className="text-card font-semibold text-fg">{device.name}</h2>
          <Badge tone={STATUS_TONE[device.status]}>{t(`devices.status.${device.status}`)}</Badge>
          {device.revokedAt ? <span className="text-meta text-fg-subtle">{t("admin.devices.detail.revokedBy", { date: formatDateTime(device.revokedAt) })}</span> : null}
        </div>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-table sm:grid-cols-2" data-testid="device-admin-detail">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-fg-subtle">{label}</dt>
              <dd className="text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        {device.complianceReasons.length ? (
          <ul className="mt-3 list-disc pl-5 text-meta text-fg-muted">
            {device.complianceReasons.map((reason) => <li key={reason}>{t(`devices.reasons.${reason as "DEVICE_RISK"}`)}</li>)}
          </ul>
        ) : null}
        {device.dataRemoval ? (
          <p className="mt-3 text-meta text-fg-muted" data-testid="device-removal">
            {device.dataRemoval.confirmedAt ? t("devices.removalDone") : t(device.dataRemoval.mode === "FULL" ? "devices.removalFullPending" : "devices.removalPending")}
          </p>
        ) : null}
      </section>

      <section className="nesto-card p-6" aria-labelledby="device-actions-title">
        <h2 id="device-actions-title" className="text-card font-semibold text-fg">{t("admin.devices.detail.actions")}</h2>
        <div className="mt-4">
          <AdminDeviceActions
            deviceId={device.id}
            userName={device.user.fullName}
            status={device.status}
            canSessions={can(context, "security.sessions.revoke")}
            canDevices={can(context, "security.devices.revoke")}
          />
        </div>
        <p className="mt-3 text-micro text-fg-subtle">{t("devices.note")}</p>
      </section>
    </div>
  );
}
