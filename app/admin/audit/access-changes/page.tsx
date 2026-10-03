import { AuditTable } from "@/components/platform/audit-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformSecurity } from "@/lib/modules/platform/platform-control.query";
import { getTranslations } from "@/lib/i18n/server";
export async function generateMetadata() { const t = await getTranslations("adminAccess"); return { title: t("audit.accessChanges.metaTitle") }; }
export default async function AccessChangesPage() { const t = await getTranslations("adminAccess"); const context = await requirePlatformContext(); const { accessChanges } = await platformSecurity(context); return <div className="space-y-5"><PageHeader title={t("audit.accessChanges.title")} description={t("audit.accessChanges.description")} /><section className="nesto-card p-5"><AuditTable rows={accessChanges} label={t("audit.accessChanges.label")} /></section></div>; }
