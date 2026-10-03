import { AccessInspector } from "@/components/platform/access-inspector";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listPlatformCompanies, listPlatformProjects, listPlatformUsers, listRolePermissionRegistry } from "@/lib/modules/platform/platform-control.query";
import { getTranslations } from "@/lib/i18n/server";
import { assignedCompany } from "@/lib/access/project-ownership";

export async function generateMetadata() { const t = await getTranslations("adminAccess"); return { title: t("users.inspector.metaTitle") }; }
export default async function InspectorPage() { const t = await getTranslations("adminAccess"); const context = await requirePlatformContext(); const [users, companies, projects, registry] = await Promise.all([listPlatformUsers(context), listPlatformCompanies(context), listPlatformProjects(context), listRolePermissionRegistry(context)]); return <div className="space-y-5"><PageHeader title={t("users.inspector.title")} description={t("users.inspector.description")} /><AccessInspector users={users.filter((row) => !row.platformAccess).map((row) => ({ value: row.id, label: `${row.firstName} ${row.lastName} (${row.username})` }))} companies={companies.map((row) => ({ value: row.id, label: `${row.parentGroup.name} · ${row.name}` }))} projects={projects.map((row) => ({ value: row.id, label: `${assignedCompany(row).name} · ${row.code} · ${row.name}`, companyId: assignedCompany(row).id }))} permissions={registry.permissions.map((row) => ({ value: row.key, label: `${row.module} · ${row.key}` }))} /></div>; }
