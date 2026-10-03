import { AuditTable } from "@/components/platform/audit-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformAuditPage } from "@/lib/modules/platform/platform-control.query";
import { getTranslations } from "@/lib/i18n/server";
export async function generateMetadata() { const t = await getTranslations("adminAccess"); return { title: t("audit.security.metaTitle") }; }
/** The newest security events, filtered in the query before the cap, with their total (AUD-08 §3, §4). */
export default async function SecurityAuditPage() { const t = await getTranslations("adminAccess"); const context = await requirePlatformContext(); const { rows, total } = await platformAuditPage(context, ["AUTHENTICATION", "ACCESS_CONTROL"]); return <div className="space-y-5"><PageHeader title={t("audit.security.title")} description={t("audit.security.description")} /><section className="nesto-card space-y-3 p-5"><p className="text-meta text-fg-subtle" data-testid="audit-scope">{rows.length < total ? t("audit.security.newest", { shown: rows.length, total }) : t("audit.security.total", { total })}</p><AuditTable rows={rows} label={t("audit.security.label")} /></section></div>; }
