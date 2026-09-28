import { AuditTable } from "@/components/platform/audit-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformAuditPage } from "@/lib/modules/platform/platform-control.query";
export const metadata = { title: "Security Audit" };
/** The newest security events, filtered in the query before the cap, with their total (AUD-08 §3, §4). */
export default async function SecurityAuditPage() { const context = await requirePlatformContext(); const { rows, total } = await platformAuditPage(context, ["AUTHENTICATION", "ACCESS_CONTROL"]); return <div className="space-y-5"><PageHeader title="Security audit" description="Authentication and access-control evidence across the platform." /><section className="nesto-card space-y-3 p-5"><p className="text-meta text-fg-subtle" data-testid="audit-scope">{rows.length < total ? `The newest ${rows.length} of ${total} events.` : `${total} events.`}</p><AuditTable rows={rows} label="Security audit" /></section></div>; }
