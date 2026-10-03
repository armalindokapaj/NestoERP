import { PlatformDeviceActions } from "@/components/security/platform-device-actions";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listPlatformDevices } from "@/lib/modules/platform/platform-mobile-security.service";
import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { formatDate } from "@/lib/utils/format";

export async function generateMetadata() {
  const t = await getTranslations("adminAccess");
  return { title: t("users.devices.metaTitle") };
}

const TONE = { ACTIVE: "success", STALE: "default", REVOKED: "danger", BLOCKED: "danger" } as const;

/** Every installed app across tenants. A technical surface: status and version, never business data (MOB-11 §26, §186). */
export default async function PlatformDevicesPage() {
  const t = await getTranslations("adminAccess");
  const context = await requirePlatformContext();
  const devices = await listPlatformDevices(context);
  const canRevoke = canPlatform(context, "platform.device.revoke");
  return (
    <div className="space-y-5">
      <PageHeader title={t("users.devices.title")} description={t("users.devices.description")} />
      <section className="nesto-card p-5">
        <Table stack flush aria-label={t("users.devices.tableLabel")}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t("users.devices.cols.user")}</TableHeaderCell>
              <TableHeaderCell>{t("users.devices.cols.organization")}</TableHeaderCell>
              <TableHeaderCell>{t("users.devices.cols.device")}</TableHeaderCell>
              <TableHeaderCell>{t("users.devices.cols.app")}</TableHeaderCell>
              <TableHeaderCell>{t("users.devices.cols.status")}</TableHeaderCell>
              <TableHeaderCell>{t("users.devices.cols.lastSeen")}</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id} data-testid="platform-device-row">
                <TableCell><span className="font-medium text-fg">{device.user.fullName}</span><p className="font-mono text-micro text-fg-subtle">{device.user.username}</p></TableCell>
                <TableCell>{device.companies.join(", ") || "—"}</TableCell>
                <TableCell>{device.name} · {device.platform === "IOS" ? "iOS" : "Android"}{device.osVersion ? ` ${device.osVersion}` : ""}</TableCell>
                <TableCell>{device.appVersion}</TableCell>
                <TableCell><Badge tone={TONE[device.status]}>{enumLabel(t, "enums.deviceStatus", device.status)}</Badge></TableCell>
                <TableCell>{formatDate(device.lastSeenAt)}</TableCell>
                <TableCell>{canRevoke ? <PlatformDeviceActions deviceId={device.id} userName={device.user.fullName} status={device.status} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
