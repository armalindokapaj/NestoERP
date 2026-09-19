import { AuditTable } from "@/components/platform/audit-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformAudit } from "@/lib/modules/platform/platform-control.query";
export const metadata = { title: "Global Audit" };
export default async function GlobalAuditPage() { const context = await requirePlatformContext(); const rows = await platformAudit(context); return <div className="space-y-5"><PageHeader title="Global audit" description="Append-only evidence for platform, tenant, security and configuration events." /><section className="nesto-card p-5"><AuditTable rows={rows} label="Global audit" /></section></div>; }
