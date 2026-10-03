import { adminModuleText } from "@/components/platform/admin-modules";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ENTITLABLE_MODULES, moduleLabel } from "@/lib/core/entitlements/entitlement.resolver";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";
import { listEntitlementPlans } from "@/lib/modules/entitlements/entitlement.service";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.plans") };
}

type Plan = Awaited<ReturnType<typeof listEntitlementPlans>>[number];

const fieldsFor = (t: Translate<"adminOrgs">, tm: Translate<"modules">) => [
  { name: "name", label: t("plans.planName"), type: "text" as const, required: true },
  { name: "description", label: t("common.description"), type: "textarea" as const, wide: true },
  ...ENTITLABLE_MODULES.map((key) => ({ name: `module:${key}`, label: adminModuleText(tm, key, "label", moduleLabel(key)), type: "checkbox" as const })),
  { name: "maxActiveUsers", label: t("entitlements.activeUsers"), type: "number" as const, hint: t("plans.emptyUnlimited") },
  { name: "maxProjects", label: t("common.projects"), type: "number" as const, hint: t("plans.emptyUnlimited") },
  { name: "maxStorageGb", label: t("entitlements.storageGb"), type: "number" as const, hint: t("plans.emptyUnlimited") },
  { name: "status", label: t("plans.availability"), type: "select" as const, required: true, options: [{ value: "ACTIVE", label: t("plans.offered") }, { value: "RETIRED", label: t("plans.retired") }] },
];

function initial(plan?: Plan) {
  return {
    name: plan?.name ?? "", description: plan?.description ?? "", status: plan?.status ?? "ACTIVE",
    maxActiveUsers: plan?.maxActiveUsers ?? "", maxProjects: plan?.maxProjects ?? "", maxStorageGb: plan?.maxStorageBytes ? Math.round(plan.maxStorageBytes / 1024 ** 3) : "",
    ...Object.fromEntries(ENTITLABLE_MODULES.map((key) => [`module:${key}`, plan ? plan.moduleKeys.includes(key) : false])),
  };
}

/**
 * Plans are reusable entitlement templates (Admin Modules PRD #4 §24-§26):
 * modules and limits, never a price. Core NESTO is in every plan. Editing a
 * plan changes what every company on it may use.
 */
export default async function PlansPage() {
  const t = await getTranslations("adminOrgs");
  const tm = await getTranslations("modules");
  const fields = fieldsFor(t, tm);
  const context = await requirePlatformContext();
  const plans = await listEntitlementPlans(context);
  const canManage = canPlatform(context, "platform.module.manage");
  return (
    <div className="space-y-5">
      <PageHeader title={t("plans.title")} description={t("plans.description")} actions={canManage ? <PlatformCommandButton label={t("plans.newPlan")} title={t("plans.newPlan")} action="plan.save" variant="primary" fields={fields} initial={initial()} submitLabel={t("plans.createSubmit")} success={t("plans.created")} /> : undefined} />
      <section className="nesto-card overflow-x-auto">
        <Table stack flush aria-label={t("plans.tableLabel")}>
          <TableHead><TableRow><TableHeaderCell>{t("plans.headers.plan")}</TableHeaderCell><TableHeaderCell>{t("plans.headers.modules")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("plans.headers.limits")}</TableHeaderCell><TableHeaderCell>{t("plans.headers.companies")}</TableHeaderCell><TableHeaderCell>{t("plans.headers.status")}</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell><span className="font-medium text-fg">{plan.name}</span>{plan.description ? <p className="max-w-xs text-meta text-fg-subtle">{plan.description}</p> : null}</TableCell>
                <TableCell className="max-w-md text-meta text-fg-muted">{t("plans.coreModules", { modules: plan.moduleKeys.map((key) => adminModuleText(tm, key, "label", moduleLabel(key))).join(", ") || t("plans.nothingElse") })}</TableCell>
                <TableCell className="text-meta text-fg-muted max-md:hidden">{t("plans.limits", { users: plan.maxActiveUsers ?? "∞", projects: plan.maxProjects ?? "∞", storage: plan.maxStorageBytes ? t("plans.storageGb", { count: Math.round(plan.maxStorageBytes / 1024 ** 3) }) : t("plans.unlimitedStorage") })}</TableCell>
                <TableCell className="tabular-nums">{plan.companies}</TableCell>
                <TableCell><AdminStatusBadge status={plan.status} /></TableCell>
                <TableCell>{canManage ? <PlatformCommandButton label={t("common.edit")} title={t("plans.editTitle", { name: plan.name })} description={plan.companies ? t("plans.editDescription", { count: plan.companies }) : undefined} action="plan.save" fixed={{ planId: plan.id }} fields={fields} initial={initial(plan)} submitLabel={t("plans.saveSubmit")} success={t("plans.saved")} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
