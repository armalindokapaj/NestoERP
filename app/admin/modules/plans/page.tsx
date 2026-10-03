import type { Metadata } from "next";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ENTITLABLE_MODULES, moduleLabel } from "@/lib/core/entitlements/entitlement.resolver";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listEntitlementPlans } from "@/lib/modules/entitlements/entitlement.service";

export const metadata: Metadata = { title: "Plans" };

type Plan = Awaited<ReturnType<typeof listEntitlementPlans>>[number];

const fields = [
  { name: "name", label: "Plan name", type: "text" as const, required: true },
  { name: "description", label: "Description", type: "textarea" as const, wide: true },
  ...ENTITLABLE_MODULES.map((key) => ({ name: `module:${key}`, label: moduleLabel(key), type: "checkbox" as const })),
  { name: "maxActiveUsers", label: "Active users", type: "number" as const, hint: "Empty for Unlimited." },
  { name: "maxProjects", label: "Projects", type: "number" as const, hint: "Empty for Unlimited." },
  { name: "maxStorageGb", label: "Storage (GB)", type: "number" as const, hint: "Empty for Unlimited." },
  { name: "status", label: "Availability", type: "select" as const, required: true, options: [{ value: "ACTIVE", label: "Offered" }, { value: "RETIRED", label: "Retired (kept for companies on it)" }] },
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
  const context = await requirePlatformContext();
  const plans = await listEntitlementPlans(context);
  const canManage = canPlatform(context, "platform.module.manage");
  return (
    <div className="space-y-5">
      <PageHeader title="Plans" description="Reusable module and limit templates. A company can also be Custom, with exceptions only." actions={canManage ? <PlatformCommandButton label="New plan" title="New plan" action="plan.save" variant="primary" fields={fields} initial={initial()} submitLabel="Create plan" success="Plan created." /> : undefined} />
      <section className="nesto-card overflow-x-auto">
        <Table stack flush aria-label="Plans">
          <TableHead><TableRow><TableHeaderCell>Plan</TableHeaderCell><TableHeaderCell>Modules</TableHeaderCell><TableHeaderCell className="max-md:hidden">Limits</TableHeaderCell><TableHeaderCell>Companies</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell><span className="font-medium text-fg">{plan.name}</span>{plan.description ? <p className="max-w-xs text-meta text-fg-subtle">{plan.description}</p> : null}</TableCell>
                <TableCell className="max-w-md text-meta text-fg-muted">Core · {plan.moduleKeys.map(moduleLabel).join(", ") || "nothing else"}</TableCell>
                <TableCell className="text-meta text-fg-muted max-md:hidden">{plan.maxActiveUsers ?? "∞"} users · {plan.maxProjects ?? "∞"} projects · {plan.maxStorageBytes ? `${Math.round(plan.maxStorageBytes / 1024 ** 3)} GB` : "∞ storage"}</TableCell>
                <TableCell className="tabular-nums">{plan.companies}</TableCell>
                <TableCell><AdminStatusBadge status={plan.status} /></TableCell>
                <TableCell>{canManage ? <PlatformCommandButton label="Edit" title={`Edit ${plan.name}`} description={plan.companies ? `${plan.companies} ${plan.companies === 1 ? "company is" : "companies are"} on this plan; they gain or lose its modules at once. No data is deleted.` : undefined} action="plan.save" fixed={{ planId: plan.id }} fields={fields} initial={initial(plan)} submitLabel="Save plan" success="Plan saved." /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
