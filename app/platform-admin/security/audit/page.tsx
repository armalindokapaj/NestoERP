import { AuditTable } from "@/components/platform/audit-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformAudit } from "@/lib/modules/platform/platform-control.query";
export const metadata = { title: "Security Audit" };
export default async function SecurityAuditPage() { const context = await requirePlatformContext(); const rows = (await platformAudit(context)).filter((row) => ["AUTHENTICATION", "ACCESS_CONTROL"].includes(row.category)); return <div className="space-y-5"><PageHeader title="Security audit" description="Authentication and access-control evidence across the platform." /><section className="nesto-card p-5"><AuditTable rows={rows} label="Security audit" /></section></div>; }
