import { AuditTable } from "@/components/platform/audit-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformAuditPage } from "@/lib/modules/platform/platform-control.query";
export const metadata = { title: "Global Audit" };
/** The newest audit events with their total, so the cap is stated rather than passed off as everything (AUD-08 §4). */
export default async function GlobalAuditPage() { const context = await requirePlatformContext(); const { rows, total } = await platformAuditPage(context); return <div className="space-y-5"><PageHeader title="Global audit" description="Append-only evidence for platform, tenant, security and configuration events." /><section className="nesto-card space-y-3 p-5"><p className="text-meta text-fg-subtle" data-testid="audit-scope">{rows.length < total ? `The newest ${rows.length} of ${total} events.` : `${total} events.`}</p><AuditTable rows={rows} label="Global audit" /></section></div>; }
