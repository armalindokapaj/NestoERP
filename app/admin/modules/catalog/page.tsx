import { adminModuleText } from "@/components/platform/admin-modules";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getTranslations } from "@/lib/i18n/server";
import { moduleCatalog } from "@/lib/modules/entitlements/entitlement.service";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.catalog") };
}

/**
 * The module catalog (Admin Modules PRD #4 §4-§7, §37-§39): what NESTO
 * functionality exists, its stable key, scope and dependencies. Modules are
 * defined in code and never deleted from here; Required ones cannot be
 * withheld from any company.
 */
export default async function ModuleCatalogPage() {
  const tm = await getTranslations("modules");
  const t = await getTranslations("adminOrgs");
  const context = await requirePlatformContext();
  const catalog = await moduleCatalog(context);
  return (
    <div className="space-y-5">
      <PageHeader title={t("catalog.title")} description={t("catalog.description")} />
      <section className="nesto-card overflow-x-auto">
        <Table stack flush aria-label={t("catalog.title")}>
          <TableHead><TableRow><TableHeaderCell>{t("catalog.headers.module")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("catalog.headers.key")}</TableHeaderCell><TableHeaderCell>{t("catalog.headers.scope")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("catalog.headers.needs")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("catalog.headers.inUse")}</TableHeaderCell><TableHeaderCell>{t("catalog.headers.availability")}</TableHeaderCell></TableRow></TableHead>
          <TableBody>
            {catalog.modules.map((row) => (
              <TableRow key={row.key}>
                <TableCell><span className="font-medium text-fg">{adminModuleText(tm, row.key, "label", row.name)}</span><p className="max-w-md text-meta text-fg-subtle max-md:hidden">{adminModuleText(tm, row.key, "description", row.description)}</p></TableCell>
                <TableCell className="font-mono text-meta max-md:hidden">{row.key}</TableCell>
                <TableCell>{row.scope === "Required" ? <AdminStatusBadge status="Required" /> : row.scope === "Project" ? t("catalog.scope.Project") : row.scope === "Company" ? t("catalog.scope.Company") : row.scope}</TableCell>
                <TableCell className="text-meta text-fg-muted max-lg:hidden">{row.dependencies.join(", ") || "—"}</TableCell>
                <TableCell className="tabular-nums max-sm:hidden">{row.scope === "Required" ? t("catalog.all") : row.scope === "Project" ? t("catalog.projects", { count: row.enabled }) : `${row.enabled} / ${catalog.companies}`}</TableCell>
                <TableCell>{row.availability === "Available" ? t("catalog.availability.Available") : row.availability === "Not offered" ? t("catalog.availability.Not offered") : row.availability}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
