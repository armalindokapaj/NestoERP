import { PlatformDeviceActions } from "@/components/security/platform-device-actions";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listPlatformDevices } from "@/lib/modules/platform/platform-mobile-security.service";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Mobile devices" };

const TONE = { ACTIVE: "success", STALE: "default", REVOKED: "danger", BLOCKED: "danger" } as const;

/** Every installed app across tenants. A technical surface: status and version, never business data (MOB-11 §26, §186). */
export default async function PlatformDevicesPage() {
  const context = await requirePlatformContext();
  const devices = await listPlatformDevices(context);
  const canRevoke = canPlatform(context, "platform.device.revoke");
  return (
    <div className="space-y-5">
      <PageHeader title="Mobile devices" description="Installed NESTO apps across every organization. Revoking ends the device's sessions and queues NESTO Data Removal; it does not erase the phone." />
      <section className="nesto-card p-5">
        <Table stack flush aria-label="Mobile devices">
          <TableHead>
            <TableRow>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Organization</TableHeaderCell>
              <TableHeaderCell>Device</TableHeaderCell>
              <TableHeaderCell>App</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Last seen</TableHeaderCell>
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
                <TableCell><Badge tone={TONE[device.status]}>{device.status}</Badge></TableCell>
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
