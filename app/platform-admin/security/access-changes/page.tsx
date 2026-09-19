import { AuditTable } from "@/components/platform/audit-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformSecurity } from "@/lib/modules/platform/platform-control.query";
export const metadata = { title: "Access Changes" };
export default async function AccessChangesPage() { const context = await requirePlatformContext(); const { accessChanges } = await platformSecurity(context); return <div className="space-y-5"><PageHeader title="Access changes" description="Role, membership, grant and permission-sensitive events across NESTO." /><section className="nesto-card p-5"><AuditTable rows={accessChanges} label="Access changes" /></section></div>; }
